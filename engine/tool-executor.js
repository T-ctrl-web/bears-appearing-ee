/**
 * 熊出没集团 · 工具执行器（沙箱）
 *
 * 给 Worker/Verifier 提供「真实的手」：在任务专属工作区内读写文件。
 * 安全设计（P1/P2 仅文件工具，无命令执行）：
 *   - 路径禁闭：所有路径 resolve 后必须落在工作区根内，.. 穿越/绝对路径直接拒绝
 *   - 单文件写入上限（默认 1MB），防止工具滥用撑爆磁盘
 *   - 工作区放用户数据目录（MAVIS_USER_DATA），不进仓库、不进只读 asar
 */

const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 1024 * 1024; // 1MB
const MAX_LIST_ENTRIES = 500;

class ToolExecutor {
  /**
   * @param {string} workspaceDir 工作区根目录（绝对路径）
   */
  constructor(workspaceDir) {
    this.root = path.resolve(workspaceDir);
  }

  /** 路径禁闭校验：返回工作区内的绝对路径；越界抛错 */
  _resolve(relPath) {
    const p = String(relPath || '').trim();
    if (!p) throw new Error('路径为空');
    if (path.isAbsolute(p)) throw new Error(`禁止绝对路径：${p}`);
    const abs = path.resolve(this.root, p);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`路径越界（禁止 .. 逃逸工作区）：${relPath}`);
    }
    return abs;
  }

  /** 写文件（自动建父目录），受单文件大小上限约束 */
  writeFile(relPath, content) {
    const abs = this._resolve(relPath);
    const text = String(content == null ? '' : content);
    const bytes = Buffer.byteLength(text, 'utf-8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`文件过大：${bytes} > ${MAX_FILE_BYTES} 字节`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf-8');
    return { path: relPath, bytes };
  }

  /** 读文件（文本），不存在抛错 */
  readFile(relPath) {
    const abs = this._resolve(relPath);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在：${relPath}`);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) throw new Error(`目标是目录不是文件：${relPath}`);
    return fs.readFileSync(abs, 'utf-8');
  }

  /** 列目录（相对工作区根的相对路径），默认根目录 */
  listDir(relPath = '.') {
    const abs = this._resolve(relPath);
    if (!fs.existsSync(abs)) throw new Error(`目录不存在：${relPath}`);
    const out = [];
    const walk = (dir, prefix) => {
      for (const name of fs.readdirSync(dir).sort()) {
        if (out.length >= MAX_LIST_ENTRIES) return;
        const full = path.join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        const st = fs.statSync(full);
        out.push(st.isDirectory() ? `${rel}/` : rel);
        if (st.isDirectory()) walk(full, rel);
      }
    };
    walk(abs, relPath && relPath !== '.' ? relPath : '');
    return out;
  }

  /**
   * 统一执行一次工具调用（来自 LLM 的 tool_calls）
   * @returns {{ok: boolean, result?: string, error?: string}}
   */
  executeToolCall(name, args) {
    try {
      const a = (typeof args === 'string' ? JSON.parse(args || '{}') : args) || {};
      switch (String(name)) {
        case 'write_file':
          return { ok: true, result: JSON.stringify(this.writeFile(a.path, a.content)) };
        case 'read_file':
          return { ok: true, result: this.readFile(a.path) };
        case 'list_dir':
          return { ok: true, result: JSON.stringify(this.listDir(a.path || '.')) };
        default:
          return { ok: false, error: `未知工具：${name}` };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** 工作区是否为空（无任何文件） */
  isEmpty() {
    try { return this.listDir('.').length === 0; } catch { return true; }
  }
}

/** OpenAI/DeepSeek function-calling 风格的工具定义 */
const WORKER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在工作区内写入/覆盖一个文件（自动创建父目录）。你的产出物应通过该工具落成真实文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区内相对路径，如 src/index.js 或 docs/readme.md' },
          content: { type: 'string', description: '文件完整内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区内一个文件的内容（可读队友已产出的文件）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '工作区内相对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '递归列出工作区目录树，了解当前已有文件。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对路径，默认根目录' } },
      },
    },
  },
];

/** Verifier 只读工具（客观验证：看真实文件而非自述文本） */
const VERIFIER_TOOLS = WORKER_TOOLS.filter(t => t.function.name !== 'write_file');

/** 工具使用规范（注入 system prompt） */
const WORKSPACE_RULES_WORKER = `## 工作区与工具使用（重要）
- 本任务有真实工作区，你拥有 write_file / read_file / list_dir 三个工具。
- 凡属"产出物"（代码、文档、配置、原型 HTML 等）必须用 write_file 写成真实文件，而不是只写在回复里。
- 回复文本只用于说明你做了什么、设计要点与文件清单，不要在回复里整段粘贴文件内容。
- 路径是工作区内相对路径，禁止绝对路径与 .. 逃逸。
- 最多 8 轮工具调用，先用 list_dir 看清现状再动手，最后给出简短总结。`;

const WORKSPACE_RULES_VERIFIER = `## 工作区与工具使用（重要）
- 你拥有只读工具 read_file / list_dir，可直接查看工作区中的真实产出文件。
- 审查必须基于真实文件内容，而不是仅凭 Worker 的自述文本。
- 需要引用证据时，请给出具体文件路径与问题位置。`;

module.exports = {
  ToolExecutor,
  WORKER_TOOLS,
  VERIFIER_TOOLS,
  WORKSPACE_RULES_WORKER,
  WORKSPACE_RULES_VERIFIER,
  MAX_TOOL_ROUNDS: 8,
};