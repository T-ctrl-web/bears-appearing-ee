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
