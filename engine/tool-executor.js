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
const { execFile } = require('child_process');

const MAX_FILE_BYTES = 1024 * 1024; // 1MB
const MAX_LIST_ENTRIES = 500;
const DEFAULT_CMD_TIMEOUT_MS = 30000;
const MAX_CMD_OUTPUT = 8000;
// node 标志位黑名单：强制"文件式"执行，保证命令内容可审计（禁止 -e/--eval 内联代码）
const NODE_FLAG_BLOCKLIST = /^(-e|--eval|-p|--print|--input-type|--require|--import)$/i;

class ToolExecutor {
  /**
   * @param {string} workspaceDir 工作区根目录（绝对路径）
   * @param {object} options - { allowCommands?: boolean }（P3 命令执行开关，默认关）
   */
  constructor(workspaceDir, options = {}) {
    this.root = path.resolve(workspaceDir);
    this.allowCommands = options.allowCommands === true;
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
   * 统一执行一次工具调用（来自 LLM 的 tool_calls；run_command 为异步）
   * @returns {Promise<{ok: boolean, result?: string, error?: string}>}
   */
  async executeToolCall(name, args) {
    try {
      const a = (typeof args === 'string' ? JSON.parse(args || '{}') : args) || {};
      switch (String(name)) {
        case 'write_file':
          return { ok: true, result: JSON.stringify(this.writeFile(a.path, a.content)) };
        case 'read_file':
          return { ok: true, result: this.readFile(a.path) };
        case 'list_dir':
          return { ok: true, result: JSON.stringify(this.listDir(a.path || '.')) };
        case 'run_command': {
          if (!this.allowCommands) return { ok: false, error: '命令执行未启用（allow_commands=false）' };
          const r = await this.runCommand(a.command, { timeout_ms: a.timeout_ms });
          return { ok: true, result: `exitCode=${r.exitCode}${r.timedOut ? ' (timedOut)' : ''}\n${r.output}` };
        }
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

  /**
   * P3 命令执行（白名单：仅 node，且只能跑工作区内脚本文件）。
   * 安全约束：execFile 直跑（无 shell 注入面）/ 标志位黑名单强制文件式执行 /
   * 路径参数必须落在工作区内 / 超时强杀 / 输出截断。
   * 默认关闭：须显式 allowCommands（config/env/用户设置）才会暴露该工具。
   */
  runCommand(command, opts = {}) {
    if (!this.allowCommands) throw new Error('命令执行未启用（allow_commands=false）');
    const tokens = String(command || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error('命令为空');
    if (tokens[0] !== 'node') throw new Error(`命令不在白名单（仅允许 node）：${tokens[0]}`);
    const args = tokens.slice(1);
    for (const a of args) {
      if (NODE_FLAG_BLOCKLIST.test(a)) throw new Error(`禁止 node 标志位 ${a}（强制文件式执行）`);
      if (/[\\/]|\.(js|mjs|cjs|json)$/i.test(a)) {
        // 形似路径的参数必须落在工作区内
        this._resolve(a.replace(/^\.?\//, ''));
      }
    }
    const timeoutMs = Math.min(Number(opts.timeout_ms) || DEFAULT_CMD_TIMEOUT_MS, DEFAULT_CMD_TIMEOUT_MS);
    return new Promise((resolve) => {
      execFile('node', args, {
        cwd: this.root,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      }, (err, stdout, stderr) => {
        const out = String(stdout || '');
        const errOut = String(stderr || '');
        const clipped = (out + (errOut ? `\n[stderr]\n${errOut}` : '')).slice(0, MAX_CMD_OUTPUT);
        if (err) {
          const killed = err.killed || err.signal === 'SIGTERM';
          resolve({
            exitCode: err.code ?? -1,
            timedOut: !!killed,
            output: clipped + (killed ? `\n[超时 ${timeoutMs}ms 强制终止]` : `\n[执行错误: ${err.message}]`),
          });
          return;
        }
        resolve({ exitCode: 0, timedOut: false, output: clipped });
      });
    });
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

/** P3 命令执行工具定义（仅 allow_commands=true 时暴露） */
const COMMAND_TOOL = {
  type: 'function',
  function: {
    name: 'run_command',
    description: '在工作区内运行 node 脚本（仅允许 node，且脚本必须在工作区内）。用于运行测试/自检脚本，输出会回传给你。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '如 "node test.js"（禁止 -e 内联，先写文件再跑）' },
        timeout_ms: { type: 'number', description: '超时毫秒（默认 30000，上限 30000）' },
      },
      required: ['command'],
    },
  },
};

/** Verifier 只读工具（客观验证：看真实文件而非自述文本）；启用命令时加 run_command */
const VERIFIER_TOOLS = WORKER_TOOLS.filter(t => t.function.name !== 'write_file');

/** 按开关构建工具集 */
function buildWorkerTools({ allowCommands } = {}) {
  return allowCommands ? [...WORKER_TOOLS, COMMAND_TOOL] : [...WORKER_TOOLS];
}
function buildVerifierTools({ allowCommands } = {}) {
  return allowCommands ? [...VERIFIER_TOOLS, COMMAND_TOOL] : [...VERIFIER_TOOLS];
}

/** 工具使用规范（注入 system prompt，按开关动态生成） */
function workspaceRulesWorker({ allowCommands } = {}) {
  const cmd = allowCommands
    ? `\n- 你还拥有 run_command：可运行工作区内的 node 脚本（如 node test.js）做自检/测试，输出会回传；禁止 -e 内联代码，先写文件再跑。`
    : '';
  return `## 工作区与工具使用（重要）
- 本任务有真实工作区，你拥有 write_file / read_file / list_dir 三个工具。
- 凡属"产出物"（代码、文档、配置、原型 HTML 等）必须用 write_file 写成真实文件，而不是只写在回复里。
- 回复文本只用于说明你做了什么、设计要点与文件清单，不要在回复里整段粘贴文件内容。
- 路径是工作区内相对路径，禁止绝对路径与 .. 逃逸。${cmd}
- 最多 8 轮工具调用，先用 list_dir 看清现状再动手，最后给出简短总结。`;
}

function workspaceRulesVerifier({ allowCommands } = {}) {
  const cmd = allowCommands ? `\n- 你还拥有 run_command：可真实运行工作区内的 node 测试脚本，用实际运行结果作为客观证据。` : '';
  return `## 工作区与工具使用（重要）
- 你拥有只读工具 read_file / list_dir，可直接查看工作区中的真实产出文件。
- 审查必须基于真实文件内容，而不是仅凭 Worker 的自述文本。
- 需要引用证据时，请给出具体文件路径与问题位置。${cmd}`;
}

// 兼容旧导出（测试引用）
const WORKSPACE_RULES_WORKER = workspaceRulesWorker();
const WORKSPACE_RULES_VERIFIER = workspaceRulesVerifier();

module.exports = {
  ToolExecutor,
  WORKER_TOOLS,
  VERIFIER_TOOLS,
  COMMAND_TOOL,
  buildWorkerTools,
  buildVerifierTools,
  workspaceRulesWorker,
  workspaceRulesVerifier,
  WORKSPACE_RULES_WORKER,
  WORKSPACE_RULES_VERIFIER,
  MAX_TOOL_ROUNDS: 8,
};