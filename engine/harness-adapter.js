/**
 * 熊出没集团 · Harness 适配器
 * 设计文档：engine/harness-adapter.md
 *
 * Worker 真实执行闭环：TeamRunner 派发波次后，通过本适配器调用 LLM 执行任务，
 * 完成后由 TeamRunner 回调 completeWorker 进入验证流程。
 *
 * 引擎选择：
 *   deepseek — 远程推理（真实 LLM 调用，需 API Key）
 *   mock     — 演示模式（未配置 Key 时自动降级，不发真实请求，产出确定性文本）
 *   注：TRAE Agent 为平台原生能力，无法在本进程内编程调用，路由占位见设计文档。
 *
 * 配置来源（优先级从高到低）：
 *   1. 构造参数 overrides（测试用）
 *   2. 环境变量 DEEPSEEK_API_KEY
 *   3. config/harness-config.json（真实配置，已 gitignore）
 */

const fs = require('fs');
const path = require('path');
const {
  ToolExecutor, buildWorkerTools, buildVerifierTools,
  workspaceRulesWorker, workspaceRulesVerifier, MAX_TOOL_ROUNDS,
} = require('./tool-executor');

const ROOT = path.resolve(__dirname, '..');
const REAL_CONFIG_PATH = path.join(ROOT, 'config', 'harness-config.json');
const TEAM_CONFIG_PATH = path.join(ROOT, 'config', 'team-engine.json');
const VERIFICATION_RULES_PATH = path.join(ROOT, 'config', 'verification-rules.json');

const PLACEHOLDER_KEYS = new Set(['', 'YOUR_DEEPSEEK_API_KEY']);

// 用户设置（desktop 看板界面填写的 API Key/模型）持久化在用户数据目录，
// 优先级：用户设置 > 环境变量 > config/harness-config.json > 默认
function loadUserSettings() {
  try {
    const p = path.join(
      process.env.MAVIS_USER_DATA || require('os').homedir() + '/.mavis',
      'user-settings.json'
    );
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch { /* 忽略 */ }
  return {};
}

function loadBaseConfig() {
  let dsConfig = {};
  try {
    const cfg = JSON.parse(fs.readFileSync(REAL_CONFIG_PATH, 'utf-8'));
    dsConfig = (cfg.engines && cfg.engines.deepseek && cfg.engines.deepseek.config) || {};
  } catch { /* 无真实配置文件，走环境变量/mock */ }

  const user = loadUserSettings();
  const apiKey = String(user.api_key || process.env.DEEPSEEK_API_KEY || dsConfig.api_key || '');
  const configured = !PLACEHOLDER_KEYS.has(apiKey.trim());
  // P3 命令执行开关：用户设置 > 环境变量 > 配置文件；默认关闭
  const allowCommands = user.allow_commands === true
    || ['1', 'true'].includes(String(process.env.MAVIS_ALLOW_COMMANDS || '').toLowerCase())
    || dsConfig.tools?.allow_commands === true;

  return {
    engine: configured ? 'deepseek' : 'mock',
    configured,
    apiKey: configured ? apiKey : null,
    keySource: user.api_key ? 'user-settings' : process.env.DEEPSEEK_API_KEY ? 'env' : configured ? 'config' : 'none',
    endpoint: dsConfig.endpoint || 'https://api.deepseek.com/v1/chat/completions',
    model: user.model || dsConfig.model || 'deepseek-chat',
    maxTokens: dsConfig.max_tokens || 8192,
    temperature: user.temperature ?? dsConfig.temperature ?? 0.7,
    timeoutMs: dsConfig.timeout_ms || 120000,
    allowCommands,
  };
}

function loadRoleMap() {
  try {
    const team = JSON.parse(fs.readFileSync(TEAM_CONFIG_PATH, 'utf-8'));
    const map = {};
    for (const r of [team.leader, ...(team.workers || []), ...(team.verifiers || [])]) {
      if (r && r.id) map[r.id] = r;
    }
    return map;
  } catch {
    return {};
  }
}

function loadVerificationRules() {
  try {
    return JSON.parse(fs.readFileSync(VERIFICATION_RULES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// 角色定义（roles/*.md 全文）作为 system prompt，让 LLM 以该角色身份执行
function buildSystemPrompt(roleInfo) {
  try {
    return fs.readFileSync(path.join(ROOT, roleInfo.file), 'utf-8');
  } catch {
    return `你是熊出没集团的${roleInfo.name || roleInfo.id}，担任${roleInfo.role || 'Worker'}。按角色职责完成任务。`;
  }
}

function buildUserPrompt({ roleInfo, task, context }) {
  const parts = [`## 任务\n${task || '（未提供任务描述）'}`];
  if (context) parts.push(`## 上下文\n${context}`);
  parts.push(`## 输出要求\n以 ${roleInfo.name || roleInfo.id}（${roleInfo.role || 'Worker'}）的身份完成上述任务，直接给出你的产出内容，不要解释你将要做什么。
产出必须严格贴合本任务主题，只交付任务明确要求的内容；严禁擅自展开与任务无关的其它功能、模块或业务，也不要编造任务未要求的领域。凡与任务无关的内容一律不要出现。`);
  return parts.join('\n\n');
}

// Verifier system prompt：角色 MD 全文（人设+审查清单）+ 本次级别规则（来自 verification-rules.json）
function buildVerifierSystemPrompt(roleInfo, levelRules) {
  let prompt;
  try {
    prompt = fs.readFileSync(path.join(ROOT, roleInfo.file), 'utf-8');
  } catch {
    prompt = `你是熊出没集团的${roleInfo.name || roleInfo.id}，担任${roleInfo.role || 'Verifier'}。以对抗心态审查产出。`;
  }
  if (levelRules) {
    const checklist = (levelRules.checklist || []).map((c, i) => `${i + 1}. ${c}`).join('\n');
    prompt += `\n\n## 本次审查级别规则\n- 级别：${levelRules.name}\n- 说明：${levelRules.description}\n- 审查清单：\n${checklist}\n- 不通过时：${levelRules.on_fail}`;
  }
  return prompt;
}

function buildVerifierUserPrompt({ task, outputs, iteration, maxIterations }) {
  const outputsText = Object.entries(outputs || {})
    .map(([rid, out]) => `### 角色 ${rid}\n${out == null ? '（执行失败，无产出）' : out}`)
    .join('\n\n') || '（无产出）';
  return [
    `## 待审查任务\n${task || '（未提供任务描述）'}`,
    `## Worker 产出\n${outputsText}`,
    `## 迭代轮次\n第 ${iteration} 轮（最多 ${maxIterations} 轮，超限终审失败）`,
    '## 输出要求\n先简要给出审查意见（按你的角色风格），最后必须单独一行输出合法 JSON 作为最终结论：\n{"passed": false, "issues": ["问题1", "问题2"], "verdict": "一句话结论"}\npassed=true 表示通过放行；passed=false 表示驳回重跑。issues 为发现的问题列表（通过时可为空数组）。\n贴合性是硬性条件：只要产出与任务无关、明显跑题、或未覆盖任务的核心要求，passed 就必须为 false，且 issues 里第一个问题必须以\u201c跑题\u201d标注。',
  ].join('\n\n');
}

function normalizeVerdict(o) {
  return {
    passed: o.passed === true || o.passed === 'true',
    issues: Array.isArray(o.issues) ? o.issues.map(String) : [],
    verdict: o.verdict != null ? String(o.verdict) : '',
    parsed: true,
  };
}

/**
 * 从 LLM 审查回复中稳健解析结论：
 *   1) 逐个尝试文本中的扁平 JSON 对象（取最后一个含 passed 的）
 *   2) 宽松截取首个 { 到末尾 } 的片段（允许 issues 含嵌套）
 *   3) 关键词回退（驳回/不通过 → false；通过/放行 → true）
 * 4) 均失败 → 默认拒绝并标记 parsed:false（宁可误杀不可放行）
 */
function parseVerdict(text) {
  const s = String(text || '');
  const flats = s.match(/\{[^{}]*\}/g) || [];
  for (let i = flats.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(flats[i]);
      if ('passed' in o) return normalizeVerdict(o);
    } catch { /* 尝试下一个 */ }
  }
  const m = s.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (m) {
    try { return normalizeVerdict(JSON.parse(m[0])); } catch { /* 落入关键词回退 */ }
  }
  if (/(驳回|不通过|不予放行|不达标|failed)/i.test(s)) {
    return { passed: false, issues: ['（关键词判定：驳回）'], verdict: '关键词判定：驳回', parsed: false };
  }
  if (/(通过|放行|passed)/i.test(s)) {
    return { passed: true, issues: [], verdict: '关键词判定：通过', parsed: false };
  }
  return { passed: false, issues: ['无法解析审查结论，默认拒绝（需人工确认）'], verdict: '无法解析审查结论，默认拒绝', parsed: false };
}

/**
 * 并发受限的映射执行（设计文档：并行最多 3 个 Worker）
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, runner);
  await Promise.all(workers);
  return results;
}

const COST_CONTROL_PATH = path.join(ROOT, 'config', 'cost-control.json');

function loadCostConfig() {
  try {
    return JSON.parse(fs.readFileSync(COST_CONTROL_PATH, 'utf-8'));
  } catch {
    return { token_budget: { per_task: 500000, per_session: 2000000, on_exceed: 'pause' } };
  }
}

class HarnessAdapter {
  constructor(overrides = {}) {
    this.config = { ...loadBaseConfig(), ...overrides };
    // 显式覆盖 apiKey 时需重新推导引擎状态（apiKey: null → 强制 mock）
    if ('apiKey' in overrides) {
      const key = String(overrides.apiKey || '').trim();
      const configured = !PLACEHOLDER_KEYS.has(key);
      this.config.configured = configured;
      this.config.apiKey = configured ? overrides.apiKey : null;
      this.config.keySource = configured ? 'override' : 'none';
      if (!('engine' in overrides)) this.config.engine = configured ? 'deepseek' : 'mock';
    }
    this.roleMap = loadRoleMap();
    this.verificationRules = loadVerificationRules();
    this.costConfig = loadCostConfig();
    // 任务级计数（每个任务重置，对应 per_task 预算）与会话级计数（进程累积，对应 per_session 预算）
    this.tokenUsage = { total: 0, byRole: {}, calls: 0 };
    this.sessionUsage = { total: 0, calls: 0 };
  }

  /** 新任务启动时重置任务级预算（会话级继续累积，防全局熔断误伤后续任务） */
  resetTaskBudget() {
    this.tokenUsage = { total: 0, byRole: {}, calls: 0 };
    return this;
  }

  /**
   * 热更新：重读用户数据目录中的设置并刷新引擎配置（保存设置后立即生效，无需重启）。
   */
  applyUserSettings() {
    const fresh = loadBaseConfig();
    this.config.engine = fresh.engine;
    this.config.configured = fresh.configured;
    this.config.apiKey = fresh.apiKey;
    this.config.keySource = fresh.keySource;
    this.config.model = fresh.model;
    this.config.temperature = fresh.temperature;
    this.config.allowCommands = fresh.allowCommands;
    return this;
  }

  get tokenBudget() {
    const budget = this.costConfig.token_budget || {};
    return {
      perTask: budget.per_task || 500000,
      perSession: budget.per_session || 2000000,
      onExceed: budget.on_exceed || 'pause',
    };
  }

  get isBudgetExceeded() {
    const { perTask, perSession } = this.tokenBudget;
    return this.tokenUsage.total >= perTask || this.sessionUsage.total >= perSession;
  }

  _trackTokens(roleId, tokens) {
    this.tokenUsage.total += tokens;
    this.tokenUsage.calls += 1;
    this.tokenUsage.byRole[roleId] = (this.tokenUsage.byRole[roleId] || 0) + tokens;
    this.sessionUsage.total += tokens;
    this.sessionUsage.calls += 1;
  }

  get engineStatus() {
    const { configured, engine, model, endpoint, keySource } = this.config;
    const budget = this.tokenBudget;
    return {
      configured, engine, model, endpoint, keySource,
      mode: engine === 'mock' ? '演示模式（不发真实请求）' : '真实 LLM 调用',
      tokenUsage: { ...this.tokenUsage },
      sessionUsage: { ...this.sessionUsage },
      budget: { perTask: budget.perTask, perSession: budget.perSession, exceeded: this.isBudgetExceeded },
    };
  }

  /**
   * 底层对话调用（Worker 与 Verifier 共用，单轮）
   * @returns {Promise<{ok: boolean, content?: string, error?: string, duration_ms: number, tokens?: number}>}
   */
  async _chatCompletion(systemPrompt, userPrompt, roleId = 'unknown') {
    const r = await this._postChat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      roleId,
      null
    );
    // 兼容旧语义：空内容视为失败
    if (r.ok && !r.content) {
      return { ok: false, error: 'API 返回空内容', duration_ms: r.duration_ms };
    }
    return r;
  }

  /**
   * POST /chat/completions：messages + 可选 tools，返回 message 级原始结构。
   * 单轮不带循环；预算检查与 token 计量在此统一处理。
   */
  async _postChat(messages, roleId, tools) {
    if (this.isBudgetExceeded) {
      const { perTask, perSession } = this.tokenBudget;
      const scope = this.tokenUsage.total >= perTask
        ? `任务级（已用 ${this.tokenUsage.total} / 上限 ${perTask}）`
        : `会话级（已用 ${this.sessionUsage.total} / 上限 ${perSession}）`;
      return { ok: false, error: `Token 预算超限：${scope}，暂停派发。`, duration_ms: 0 };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const body = {
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      };
      if (tools && tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `API ${res.status}: ${errText.slice(0, 200)}`, duration_ms: Date.now() - started };
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      const tokens = data.usage?.total_tokens || 0;
      if (tokens > 0) this._trackTokens(roleId, tokens);
      return {
        ok: true,
        message: msg,            // { content, tool_calls? }
        content: msg.content || '',
        toolCalls: msg.tool_calls || null,
        finishReason: data.choices?.[0]?.finish_reason || '',
        duration_ms: Date.now() - started,
        tokens,
      };
    } catch (e) {
      const msg = e.name === 'AbortError' ? `超时（${this.config.timeoutMs}ms）` : e.message;
      return { ok: false, error: msg, duration_ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Agent Loop：带工具的多轮对话（DeepSeek function calling）。
   * LLM 请求 tool_calls → 本地执行（沙箱）→ 结果回填 → 直到终答或轮次/预算上限。
   * @returns {Promise<{ok, content, rounds, toolCalls, duration_ms, tokens, truncated?}>}
   */
  async _chatWithTools(systemPrompt, userPrompt, roleId, tools, executor) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const started = Date.now();
    let tokens = 0;
    let toolCallCount = 0;

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const r = await this._postChat(messages, roleId, tools);
      tokens += r.tokens || 0;
      if (!r.ok) return { ok: false, error: r.error, duration_ms: Date.now() - started, tokens, rounds: round - 1, toolCalls: toolCallCount };

      const calls = r.toolCalls && r.toolCalls.length ? r.toolCalls : null;
      if (!calls) {
        // 终答
        return { ok: true, content: r.content || '', rounds: round, toolCalls: toolCallCount, duration_ms: Date.now() - started, tokens };
      }

      // 执行工具调用并回填
      messages.push({ role: 'assistant', content: r.content || '', tool_calls: calls });
      for (const call of calls) {
        toolCallCount++;
        const fn = call.function || {};
        const exec = await executor.executeToolCall(fn.name, fn.arguments);
        const reply = exec.ok
          ? String(exec.result).slice(0, 8000) // 回填上限，防止上下文爆炸
          : `ERROR: ${exec.error}`;
        messages.push({ role: 'tool', tool_call_id: call.id, content: reply });
      }
    }

    // 轮次超限：强制收尾，要求只给最终总结
    messages.push({ role: 'user', content: '工具调用轮次已到上限，请立即停止调用工具，直接给出最终总结。' });
    const fin = await this._postChat(messages, roleId, null); // 收尾不带 tools
    tokens += fin.tokens || 0;
    if (!fin.ok) return { ok: false, error: fin.error, duration_ms: Date.now() - started, tokens, rounds: MAX_TOOL_ROUNDS, toolCalls: toolCallCount };
    return { ok: true, content: fin.content || '', rounds: MAX_TOOL_ROUNDS + 1, toolCalls: toolCallCount, duration_ms: Date.now() - started, tokens, truncated: true };
  }

  /**
   * 执行单个 Worker 任务，返回统一结果格式（见设计文档「输出（统一格式）」）
   * @param {object} input - { roleId, task, context, workspace }
   *   workspace：任务工作区目录（可选）。提供时启用工具 Agent Loop，产出落成真实文件。
   * @returns {Promise<{roleId, assignee, engine, status, output, duration_ms, error}>}
   */
  async executeWorker({ roleId, task, context, workspace }) {
    const roleInfo = this.roleMap[roleId] || { id: roleId, name: roleId, role: '' };
    const base = { roleId, assignee: roleInfo.name || roleId, engine: this.config.engine, duration_ms: 0, error: null };

    // mock 引擎：演示模式，确定性产出，不发真实请求
    if (this.config.engine === 'mock') {
      return {
        ...base,
        status: 'success',
        output: `[mock] ${roleInfo.name || roleId}（${roleInfo.role || 'Worker'}）完成任务：${task || '（无描述）'}`,
        isMock: true,
      };
    }

    // 带工作区：Agent Loop（write_file/read_file/list_dir），产出为真实文件
    if (workspace) {
      const allowCommands = this.config.allowCommands === true;
      const executor = new ToolExecutor(workspace, { allowCommands });
      const before = new Set(executor.isEmpty() ? [] : executor.listDir('.'));
      const sys = buildSystemPrompt(roleInfo) + '\n\n' + workspaceRulesWorker({ allowCommands });
      const r = await this._chatWithTools(sys, buildUserPrompt({ roleInfo, task, context }), roleId, buildWorkerTools({ allowCommands }), executor);
      if (!r.ok) return { ...base, status: 'failed', output: null, error: r.error, duration_ms: r.duration_ms };
      const after = executor.listDir('.');
      const written = after.filter(p => !before.has(p));
      const filesNote = after.length
        ? `\n\n## 工作区产出（${after.length} 个文件，本轮新增 ${written.length}）\n${after.map(p => `- ${p}`).join('\n')}`
        : '\n\n## 工作区产出\n（未写入任何文件——注意：工具可用时产出物必须落盘）';
      return {
        ...base,
        status: 'success',
        output: r.content + filesNote,
        duration_ms: r.duration_ms,
        tokens: r.tokens,
        meta: { rounds: r.rounds, toolCalls: r.toolCalls, truncated: !!r.truncated, workspace, files: after },
      };
    }

    const r = await this._chatCompletion(buildSystemPrompt(roleInfo), buildUserPrompt({ roleInfo, task, context }), roleId);
    if (!r.ok) return { ...base, status: 'failed', output: null, error: r.error, duration_ms: r.duration_ms };
    return { ...base, status: 'success', output: r.content, duration_ms: r.duration_ms, tokens: r.tokens || 0 };
  }

  /**
   * 执行 Verifier 对抗审查（真实 LLM 评审 Worker 产出，返回结构化结论）
   * @param {object} input - { verifierId, level, task, outputs, iteration, maxIterations, workspace }
   *   workspace：提供时启用只读工具，Verifier 可直接查看真实产出文件做客观验证。
   */
  async executeVerifier({ verifierId, level = 'level_1', task, outputs, iteration = 1, maxIterations = 3, workspace }) {
    const roleInfo = this.roleMap[verifierId] || { id: verifierId, name: verifierId, role: 'Verifier' };
    const levelRules = (this.verificationRules.levels || {})[level] || null;
    const base = { verifierId, assignee: roleInfo.name || verifierId, engine: this.config.engine, duration_ms: 0, error: null };

    // mock 引擎：存在失败/空产出则驳回，否则通过（确定性，便于演示与测试）
    if (this.config.engine === 'mock') {
      const vals = Object.values(outputs || {});
      const hasFailure = vals.length === 0 || vals.some(v => v == null || String(v).trim() === '' || String(v).startsWith('执行失败'));
      return {
        ...base,
        status: 'success',
        parsed: true,
        passed: !hasFailure,
        issues: hasFailure ? ['存在执行失败或空产出'] : [],
        verdict: hasFailure ? '（mock）存在失败产出，驳回' : '（mock）审查通过',
        raw: '',
        isMock: true,
      };
    }

    // 带工作区：Verifier Agent Loop（只读工具），基于真实文件审查
    if (workspace) {
      const allowCommands = this.config.allowCommands === true;
      const executor = new ToolExecutor(workspace, { allowCommands });
      let treeNote = '（工作区为空）';
      try {
        const files = executor.listDir('.');
        if (files.length) treeNote = files.map(p => `- ${p}`).join('\n');
      } catch { /* 保持默认 */ }
      const sys = buildVerifierSystemPrompt(roleInfo, levelRules) + '\n\n' + workspaceRulesVerifier({ allowCommands });
      const user = `## 工作区文件清单\n${treeNote}\n\n` + buildVerifierUserPrompt({ task, outputs, iteration, maxIterations });
      const r = await this._chatWithTools(sys, user, verifierId, buildVerifierTools({ allowCommands }), executor);
      if (!r.ok) {
        return { ...base, status: 'failed', passed: null, issues: [], verdict: '', raw: null, parsed: false, error: r.error, duration_ms: r.duration_ms };
      }
      return { ...base, status: 'success', ...parseVerdict(r.content), raw: r.content, duration_ms: r.duration_ms, tokens: r.tokens, toolCalls: r.toolCalls };
    }

    const r = await this._chatCompletion(
      buildVerifierSystemPrompt(roleInfo, levelRules),
      buildVerifierUserPrompt({ task, outputs, iteration, maxIterations }),
      verifierId
    );
    if (!r.ok) {
      return { ...base, status: 'failed', passed: null, issues: [], verdict: '', raw: null, parsed: false, error: r.error, duration_ms: r.duration_ms };
    }
    return { ...base, status: 'success', ...parseVerdict(r.content), raw: r.content, duration_ms: r.duration_ms, tokens: r.tokens || 0 };
  }
}

module.exports = { HarnessAdapter, mapLimit };
