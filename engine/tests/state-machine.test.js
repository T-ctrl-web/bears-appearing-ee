/**
 * 状态机 + TeamRunner 测试（复用真实 server/state.js）
 * 运行：node --test engine/tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const stateModule = require('../../server/state');
const { StateMachine } = require('../state-machine');
const { TeamRunner } = require('../team-runner');

function stubCtx() {
  return {
    task: {},
    currentWave: -1,
    waves: [],
    currentVerifier: null,
    iterationCount: 0,
    maxIterations: 3,
    log() {},
    setRole() {},
    getRoleName: (id) => id,
  };
}

function newRunner() {
  const runner = new TeamRunner(stateModule);
  runner.reset();
  return runner;
}

// === StateMachine 单元测试 ===

test('状态机：合法流转 IDLE → COMPLETED 全链路', () => {
  const sm = new StateMachine(stubCtx());
  assert.equal(sm.getState(), 'IDLE');
  sm.transition('DRAFTING');
  sm.transition('DISPATCHING');
  sm.transition('EXECUTING');
  sm.transition('VERIFYING');
  sm.transition('DELIVERING');
  sm.transition('COMPLETED');
  assert.equal(sm.getHistory().length, 6);
  assert.deepEqual(sm.getHistory().map(h => h.to), ['DRAFTING', 'DISPATCHING', 'EXECUTING', 'VERIFYING', 'DELIVERING', 'COMPLETED']);
});

test('状态机：非法流转被拒绝并抛错', () => {
  const sm = new StateMachine(stubCtx());
  assert.throws(() => sm.transition('EXECUTING'), /非法状态转换/);
  // COMPLETED 是终态，不能再迁移
  const sm2 = new StateMachine(stubCtx());
  sm2.transition('DRAFTING');
  sm2.transition('COMPLETED'); // DRAFTING 允许直达 COMPLETED（简单任务快速通道）
  assert.throws(() => sm2.transition('DRAFTING'), /非法状态转换/);
});

test('状态机：VERIFYING → DISPATCHING 合法（多波次流水线）', () => {
  const sm = new StateMachine(stubCtx());
  sm.transition('DRAFTING');
  sm.transition('DISPATCHING');
  sm.transition('EXECUTING');
  sm.transition('VERIFYING');
  sm.transition('DISPATCHING'); // 验证通过后继续下一波
  sm.transition('EXECUTING');
});

test('状态机：reset 回到 IDLE 并清空历史', () => {
  const sm = new StateMachine(stubCtx());
  sm.transition('DRAFTING');
  sm.reset();
  assert.equal(sm.getState(), 'IDLE');
  assert.equal(sm.getHistory().length, 0);
});

// === TeamRunner 集成测试 ===

test('TeamRunner：完整任务流程推进到 COMPLETED', () => {
  const r = newRunner();
  r.startTask({ requirement: '开发用户列表页', complexity: 'medium' });
  assert.equal(r.currentState, 'DRAFTING');
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['guangtouqiang', 'xionger'] });
  assert.equal(r.currentState, 'EXECUTING');
  // 波次未全部完成，不能提前进入验证
  r.completeWorker('guangtouqiang', '方案完成');
  assert.equal(r.currentState, 'EXECUTING');
  r.completeWorker('xionger', '代码完成');
  assert.equal(r.currentState, 'VERIFYING');
  r.startVerification('jiji');
  r.completeVerification(true);
  assert.equal(r.currentState, 'DELIVERING');
  r.deliver('交付物');
  assert.equal(r.currentState, 'COMPLETED');
  assert.equal(r.currentTask.status, 'completed');
  assert.equal(r.currentTask.result, '交付物');
});

test('TeamRunner：任务未结束时不允许启动新任务', () => {
  const r = newRunner();
  r.startTask({ requirement: '任务A' });
  assert.throws(() => r.startTask({ requirement: '任务B' }), /当前任务未结束/);
});

test('TeamRunner：验证驳回 → ITERATING → 重派 → 再验证', () => {
  const r = newRunner();
  r.startTask({ requirement: '开发功能', complexity: 'medium' });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'] });
  r.completeWorker('xionger', '第一版');
  r.startVerification('jiji');
  r.completeVerification(false, ['问题1']);
  assert.equal(r.currentState, 'ITERATING');
  assert.equal(r.getSnapshot().iterationCount, 1);
  r.completeIteration();
  assert.equal(r.currentState, 'DISPATCHING');
  // 重派后再次验证通过
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'] });
  r.completeWorker('xionger', '修复版');
  r.startVerification('jiji');
  r.completeVerification(true);
  r.deliver('完成');
  assert.equal(r.currentState, 'COMPLETED');
});

test('TeamRunner：迭代超限（>3 轮）自动 FAILED', () => {
  const r = newRunner();
  r.startTask({ requirement: '困难任务', complexity: 'complex' });
  r.completeDrafting();
  const wave = { name: 'w1', roles: ['xionger'] };
  for (let i = 1; i <= 4; i++) {
    r.dispatchWave(0, wave);
    r.completeWorker('xionger', `第${i}轮产出`);
    r.startVerification('jiji');
    r.completeVerification(false, [`问题${i}`]);
    if (i < 4) {
      assert.equal(r.currentState, 'ITERATING');
      r.completeIteration();
      assert.equal(r.currentState, 'DISPATCHING');
    }
  }
  assert.equal(r.currentState, 'FAILED');
  assert.equal(r.currentTask.status, 'failed');
});

test('TeamRunner：reset 回到 IDLE 且任务清空', () => {
  const r = newRunner();
  r.startTask({ requirement: 'x' });
  r.reset();
  assert.equal(r.currentState, 'IDLE');
  assert.equal(r.currentTask, null);
});

// === 复杂度自动评估集成 ===

test('集成：未指定复杂度时自动评估（安全关键词 → complex + L3）', () => {
  const r = newRunner();
  r.startTask({ requirement: '实现用户登录认证功能' });
  assert.equal(r.currentTask.complexity, 'complex');
  assert.equal(r.currentTask.assessment.verification.level, 'level_3');
  assert.deepEqual(r.currentTask.assessment.verification.verifiers, ['tiezhang']);
});

test('集成：文本启发式（改文案 → simple，新增页面 → medium）', () => {
  const r1 = newRunner();
  r1.startTask({ requirement: '修改首页文案' });
  assert.equal(r1.currentTask.complexity, 'simple');
  const r2 = newRunner();
  r2.startTask({ requirement: '新增导出页面' });
  assert.equal(r2.currentTask.complexity, 'medium');
});

test('集成：显式指定复杂度时不覆盖、不评估', () => {
  const r = newRunner();
  r.startTask({ requirement: '实现登录功能', complexity: 'simple' });
  assert.equal(r.currentTask.complexity, 'simple');
  assert.equal(r.currentTask.assessment, undefined);
});

test('集成：评估结论写入日志', () => {
  const r = newRunner();
  r.startTask({ requirement: '实现支付功能' });
  const logs = stateModule.getState().logs;
  const evalLog = logs.find(l => l.message.includes('复杂度评估'));
  assert.ok(evalLog, '应有复杂度评估日志');
  assert.match(evalLog.message, /complex/);
  assert.match(evalLog.message, /Level 3/);
});

// === Worker 真实执行闭环（autoExecute + harness） ===

function fakeHarness(opts = {}) {
  let verifyCalls = 0;
  const h = {
    config: { engine: 'mock' },
    async executeWorker({ roleId, task }) {
      if (opts.workerFail) {
        return { roleId, assignee: roleId, engine: 'mock', status: 'failed', output: null, duration_ms: 1, error: 'API 500: boom' };
      }
      return { roleId, assignee: roleId, engine: 'mock', status: 'success', output: `产出:${roleId}:${task}`, duration_ms: 1, error: null };
    },
    async executeVerifier({ verifierId }) {
      verifyCalls++;
      if (opts.verifierError) {
        return { verifierId, assignee: verifierId, engine: 'mock', status: 'failed', passed: null, issues: [], verdict: '', raw: null, parsed: false, error: 'API 500', duration_ms: 1 };
      }
      if (opts.reject === 'always') {
        return { verifierId, assignee: verifierId, engine: 'mock', status: 'success', passed: false, issues: ['问题A'], verdict: '驳回', duration_ms: 1 };
      }
      if (opts.reject === 'once') {
        const passed = verifyCalls > 1;
        return { verifierId, assignee: verifierId, engine: 'mock', status: 'success', passed, issues: passed ? [] : ['首次驳回'], verdict: passed ? '通过' : '驳回', duration_ms: 1 };
      }
      return { verifierId, assignee: verifierId, engine: 'mock', status: 'success', passed: true, issues: [], verdict: '通过', duration_ms: 1 };
    },
  };
  h.verifyCalls = () => verifyCalls;
  return h;
}

async function waitState(r, expected, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (expected.includes(r.currentState)) return r.currentState;
    await new Promise(res => setTimeout(res, 5));
  }
  throw new Error(`等待状态超时：当前 ${r.currentState}，期望 ${expected.join('/')}`);
}

test('闭环：autoExecute 全自动（执行→审查→交付）单波次', async () => {
  const r = new TeamRunner(stateModule, { harness: fakeHarness() });
  r.reset();
  r.startTask({ requirement: '开发登录页', complexity: 'complex', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['guangtouqiang', 'xionger'], task: '实现登录' });
  assert.equal(r.currentState, 'EXECUTING'); // 异步执行中
  await waitState(r, ['COMPLETED']);
  assert.equal(r.currentState, 'COMPLETED');
  assert.equal(r.currentTask.status, 'completed');
  assert.equal(r.currentTask.verification.passed, true);
  assert.match(r.currentTask.result, /产出:guangtouqiang:实现登录/); // 自动交付聚合产出
});

test('闭环：Worker 执行失败 → 审查驳回 → 迭代重跑仍失败 → FAILED', async () => {
  const r = new TeamRunner(stateModule, { harness: fakeHarness({ workerFail: true, reject: 'always' }) });
  r.reset();
  r.startTask({ requirement: '困难任务', complexity: 'complex', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: '失败场景' });
  await waitState(r, ['FAILED']);
  assert.equal(r.currentTask.status, 'failed');
  const logs = stateModule.getState().logs;
  assert.ok(logs.some(l => l.level === 'error' && /执行失败/.test(l.message)), '应有失败日志');
});

// === Verifier 自动对抗审查闭环 ===

test('审查闭环：驳回后自动重跑，二次通过后自动交付', async () => {
  const h = fakeHarness({ reject: 'once' });
  const r = new TeamRunner(stateModule, { harness: h });
  r.reset();
  r.startTask({ requirement: '开发功能', complexity: 'complex', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: '实现功能' });
  await waitState(r, ['COMPLETED', 'FAILED']);
  assert.equal(r.currentState, 'COMPLETED');
  assert.equal(h.verifyCalls(), 2); // 驳回1次 + 通过1次
  assert.equal(r.getSnapshot().iterationCount, 1);
  assert.equal(r.currentTask.verification.passed, true);
  assert.deepEqual(r.currentTask.verification.issues, []);
});

test('审查闭环：L1 强制驳回（enforce_reject=true 默认）', async () => {
  const r = new TeamRunner(stateModule, { harness: fakeHarness({ reject: 'always' }) });
  r.reset();
  // medium → level_1，enforce_reject 默认 true → 驳回
  r.startTask({ requirement: '新增导出页面', complexity: 'medium', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: '实现页面' });
  await waitState(r, ['COMPLETED', 'FAILED']);
  // L1 enforce_reject=true 时驳回，迭代超限后 FAILED
  assert.equal(r.currentState, 'FAILED');
  assert.equal(r.currentTask.verification.passed, false);
});

test('审查闭环：持续驳回达迭代上限 → FAILED（有界）', async () => {
  const h = fakeHarness({ reject: 'always' });
  const r = new TeamRunner(stateModule, { harness: h });
  r.reset();
  r.startTask({ requirement: '跨模块重构', complexity: 'complex', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: '重构' });
  await waitState(r, ['FAILED']);
  assert.equal(r.currentState, 'FAILED');
  assert.ok(h.verifyCalls() <= 4, `审查次数 ${h.verifyCalls()} 应被迭代上限约束`);
  assert.equal(r.currentTask.status, 'failed');
});

test('审查闭环：审查 API 失败默认拒绝防放行', async () => {
  const r = new TeamRunner(stateModule, { harness: fakeHarness({ verifierError: true }) });
  r.reset();
  r.startTask({ requirement: '开发功能', complexity: 'complex', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: 'x' });
  await waitState(r, ['COMPLETED', 'FAILED']);
  // 审查调用失败 → 默认拒绝 → 迭代重跑 → 超限 FAILED
  assert.equal(r.currentState, 'FAILED');
  const logs = stateModule.getState().logs;
  assert.ok(logs.some(l => l.level === 'error' && /审查调用失败/.test(l.message)), '应有审查失败日志');
});

test('审查闭环：多波次流水线（验证通过自动派发下一波）', async () => {
  const h = fakeHarness();
  const r = new TeamRunner(stateModule, { harness: h });
  r.reset();
  r.startTask({ requirement: '开发完整功能', complexity: 'complex', autoExecute: true });
  r.startDrafting([
    { name: 'w1', roles: ['guangtouqiang'], task: '设计架构' },
    { name: 'w2', roles: ['xionger'], task: '编码实现' },
  ]);
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['guangtouqiang'], task: '设计架构' });
  await waitState(r, ['COMPLETED', 'FAILED']);
  assert.equal(r.currentState, 'COMPLETED');
  assert.equal(h.verifyCalls(), 2); // 每波各审一次
  const snap = r.getSnapshot();
  assert.equal(snap.waveOutputs.length, 2);
  assert.match(snap.waveOutputs[0].guangtouqiang, /设计架构/);
  assert.match(snap.waveOutputs[1].xionger, /编码实现/);
});

test('闭环：执行期间 reset，过期回调被安全忽略', async () => {
  let release;
  const slowHarness = {
    config: { engine: 'mock' },
    executeWorker: ({ roleId }) => new Promise(resolve => {
      release = () => resolve({ roleId, assignee: roleId, engine: 'mock', status: 'success', output: 'late', duration_ms: 1, error: null });
    }),
  };
  const r = new TeamRunner(stateModule, { harness: slowHarness });
  r.reset();
  r.startTask({ requirement: 'x', autoExecute: true });
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'], task: '慢任务' });
  r.reset(); // 执行中途重置
  assert.equal(r.currentState, 'IDLE');
  release(); // harness 迟到返回
  await r._execution;
  await new Promise(res => setImmediate(res));
  assert.equal(r.currentState, 'IDLE'); // 不应被过期结果扰动
});

test('闭环：未开启 autoExecute 时保持手动模式（不发 harness 请求）', async () => {
  let called = 0;
  const countingHarness = {
    config: { engine: 'mock' },
    executeWorker: async (...a) => { called++; return { status: 'success', output: 'x' }; },
  };
  const r = new TeamRunner(stateModule, { harness: countingHarness });
  r.reset();
  r.startTask({ requirement: '手动模式' }); // 不传 autoExecute
  r.completeDrafting();
  r.dispatchWave(0, { name: 'w1', roles: ['xionger'] });
  assert.equal(r.currentState, 'EXECUTING');
  assert.equal(called, 0); // harness 未被调用
  r.completeWorker('xionger', '手动完成');
  assert.equal(r.currentState, 'VERIFYING');
});
