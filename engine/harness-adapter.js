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

const ROOT = path.resolve(__dirname, '..');
const REAL_CONFIG_PATH = path.join(ROOT, 'config', 'harness-config.json');
const TEAM_CONFIG_PATH = path.join(ROOT, 'config', 'team-engine.json');

const PLACEHOLDER_KEYS = new Set(['', 'YOUR_DEEPSEEK_API_KEY']);

function loadBaseConfig() {
  let dsConfig = {};
  try {
    const cfg = JSON.parse(fs.readFileSync(REAL_CONFIG_PATH, 'utf-8'));
    dsConfig = (cfg.engines && cfg.engines.deepseek && cfg.engines.deepseek.config) || {};
  } catch { /* 无真实配置文件，走环境变量/mock */ }

  const apiKey = process.env.DEEPSEEK_API_KEY || dsConfig.api_key || '';
  const configured = !PLACEHOLDER_KEYS.has(String(apiKey).trim());

  return {
    engine: configured ? 'deepseek' : 'mock',
    configured,
    apiKey: configured ? apiKey : null,
    keySource: process.env.DEEPSEEK_API_KEY ? 'env' : configured ? 'config' : 'none',
    endpoint: dsConfig.endpoint || 'https://api.deepseek.com/v1/chat/completions',
    model: dsConfig.model || 'deepseek-chat',
    maxTokens: dsConfig.max_tokens || 8192,
    temperature: dsConfig.temperature ?? 0.7,
    timeoutMs: dsConfig.timeout_ms || 120000,
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
  parts.push(`## 输出要求\n以 ${roleInfo.name || roleInfo.id}（${roleInfo.role || 'Worker'}）的身份完成上述任务，直接给出你的产出内容，不要解释你将要做什么。`);
  return parts.join('\n\n');
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
  }

  get engineStatus() {
    const { configured, engine, model, endpoint, keySource } = this.config;
    return { configured, engine, model, endpoint, keySource, mode: engine === 'mock' ? '演示模式（不发真实请求）' : '真实 LLM 调用' };
  }

  /**
   * 执行单个 Worker 任务，返回统一结果格式（见设计文档「输出（统一格式）」）
   * @param {object} input - { roleId, task, context }
   * @returns {Promise<{roleId, assignee, engine, status, output, duration_ms, error}>}
   */
  async executeWorker({ roleId, task, context }) {
    const started = Date.now();
    const roleInfo = this.roleMap[roleId] || { id: roleId, name: roleId, role: '' };
    const base = { roleId, assignee: roleInfo.name || roleId, engine: this.config.engine, duration_ms: 0, error: null };

    // mock 引擎：演示模式，确定性产出，不发真实请求
    if (this.config.engine === 'mock') {
      return {
        ...base,
        status: 'success',
        output: `[mock] ${roleInfo.name || roleId}（${roleInfo.role || 'Worker'}）完成任务：${task || '（无描述）'}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: buildSystemPrompt(roleInfo) },
            { role: 'user', content: buildUserPrompt({ roleInfo, task, context }) },
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ...base, status: 'failed', output: null, error: `API ${res.status}: ${errText.slice(0, 200)}`, duration_ms: Date.now() - started };
      }

      const data = await res.json();
      const output = data.choices?.[0]?.message?.content || '';
      if (!output) {
        return { ...base, status: 'failed', output: null, error: 'API 返回空内容', duration_ms: Date.now() - started };
      }
      return { ...base, status: 'success', output, duration_ms: Date.now() - started };
    } catch (e) {
      const msg = e.name === 'AbortError' ? `超时（${this.config.timeoutMs}ms）` : e.message;
      return { ...base, status: 'failed', output: null, error: msg, duration_ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { HarnessAdapter, mapLimit };
