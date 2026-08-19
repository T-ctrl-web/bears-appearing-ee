/**
 * Harness 适配器测试（全部 mock，不发真实网络请求）
 * 运行：node --test engine/tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const { HarnessAdapter, mapLimit } = require('../harness-adapter');

const REAL_FETCH = global.fetch;
function withMockFetch(mock, fn) {
  return async () => {
    global.fetch = mock;
    try { await fn(); } finally { global.fetch = REAL_FETCH; }
  };
}

// === 引擎状态 ===

test('未配置 Key → mock 引擎演示模式', () => {
  const a = new HarnessAdapter({ apiKey: null });
  assert.equal(a.config.engine, 'mock');
  assert.equal(a.engineStatus.configured, false);
  assert.match(a.engineStatus.mode, /演示模式/);
});

test('配置 Key → deepseek 引擎', () => {
  const a = new HarnessAdapter({ apiKey: 'sk-test' });
  assert.equal(a.config.engine, 'deepseek');
  assert.equal(a.engineStatus.configured, true);
  assert.equal(a.engineStatus.model, 'deepseek-chat');
});

// === mock 引擎执行 ===

test('mock 引擎：确定性产出，包含角色名与任务', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计登录架构' });
  assert.equal(r.status, 'success');
  assert.equal(r.engine, 'mock');
  assert.equal(r.assignee, '光头强');
  assert.match(r.output, /光头强/);
  assert.match(r.output, /设计登录架构/);
});

test('mock 引擎：未知角色 ID 也能执行（降级命名）', async () => {
  const a = new HarnessAdapter({ apiKey: null });
  const r = await a.executeWorker({ roleId: 'unknown-role', task: 'x' });
  assert.equal(r.status, 'success');
  assert.equal(r.assignee, 'unknown-role');
});

// === deepseek 引擎（mock fetch） ===

test('deepseek：成功调用，提取 choices[0].message.content', withMockFetch(
  async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '架构方案：三模块设计' } }] }),
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计架构' });
    assert.equal(r.status, 'success');
    assert.equal(r.output, '架构方案：三模块设计');
    assert.equal(r.engine, 'deepseek');
    assert.ok(r.duration_ms >= 0);
  }
));

test('deepseek：请求携带角色 system prompt 与任务 user prompt', withMockFetch(
  async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(opts.headers.Authorization, 'Bearer sk-test');
    assert.equal(body.model, 'deepseek-chat');
    assert.match(body.messages[0].content, /光头强/); // system = 角色 MD 全文
    assert.match(body.messages[1].content, /设计登录架构/); // user = 任务
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  },
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeWorker({ roleId: 'guangtouqiang', task: '设计登录架构', context: '参考调研报告' });
    assert.equal(r.status, 'success');
  }
));

test('deepseek：HTTP 错误 → status failed 且错误信息含状态码', withMockFetch(
  async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-bad' });
    const r = await a.executeWorker({ roleId: 'xionger', task: '写代码' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /API 401/);
    assert.equal(r.output, null);
  }
));

test('deepseek：超时中断 → failed 且提示超时', withMockFetch(
  (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test', timeoutMs: 50 });
    const r = await a.executeWorker({ roleId: 'xionger', task: '慢任务' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /超时/);
  }
));

test('deepseek：空内容响应 → failed', withMockFetch(
  async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
  async () => {
    const a = new HarnessAdapter({ apiKey: 'sk-test' });
    const r = await a.executeWorker({ roleId: 'feibo', task: '写文档' });
    assert.equal(r.status, 'failed');
    assert.match(r.error, /空内容/);
  }
));

// === mapLimit 并发控制 ===

test('mapLimit：限制并发上限且结果保序', async () => {
  let running = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const results = await mapLimit(items, 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 10));
    running--;
    return n * 10;
  });
  assert.ok(peak <= 3, `并发峰值 ${peak} 应不超过 3`);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70]);
});
