/**
 * 熊出没集团 · 代码状态机
 * 用确定性代码控制任务流程，取代模型自发判断
 *
 * 状态流转：
 *   IDLE → DRAFTING → DISPATCHING → EXECUTING → VERIFYING → DELIVERING → COMPLETED
 *                                    ↑              │
 *                                    └────────────  │ (驳回重跑)
 *                                                   ↓
 *                                                ITERATING → DISPATCHING (重试)
 *                                                       ↓
 *                                                    FAILED (超限)
 */

const STATES = {
  IDLE:        { label: '空闲',     desc: '等待任务',          color: '#94a3b8' },
  DRAFTING:    { label: '拆解中',   desc: 'Leader评估并拆解任务', color: '#6c8eef' },
  DISPATCHING: { label: '派发中',   desc: 'Leader派发Worker',   color: '#6c8eef' },
  EXECUTING:   { label: '执行中',   desc: 'Worker执行任务',     color: '#3b82f6' },
  VERIFYING:   { label: '验证中',   desc: 'Verifier审查',      color: '#f59e0b' },
  ITERATING:   { label: '驳回重跑', desc: 'Worker修复问题',     color: '#f0a04b' },
  DELIVERING:  { label: '交付中',   desc: 'Leader汇总交付',     color: '#4ac4a0' },
  COMPLETED:   { label: '已完成',   desc: '任务结束',          color: '#22c55e' },
  FAILED:      { label: '已失败',   desc: '任务终止',          color: '#ef4444' },
};

const TRANSITIONS = {
  IDLE:        ['DRAFTING'],
  DRAFTING:    ['DISPATCHING', 'COMPLETED', 'FAILED'],
  DISPATCHING: ['EXECUTING', 'DELIVERING', 'FAILED'],
  EXECUTING:   ['VERIFYING', 'DELIVERING', 'ITERATING', 'FAILED'],
  VERIFYING:   ['DELIVERING', 'ITERATING', 'FAILED'],
  ITERATING:   ['DISPATCHING', 'FAILED'],
  DELIVERING:  ['COMPLETED', 'FAILED'],
  COMPLETED:   [],
  FAILED:      [],
};

const ENTRY_ACTIONS = {
  DRAFTING: (ctx) => {
    ctx.log('info', '熊大开始评估任务复杂度并拆解', 'xiongda');
    ctx.setRole('xiongda', 'WORKING', '评估任务复杂度');
  },
  DISPATCHING: (ctx) => {
    ctx.log('info', `熊大派发波次${ctx.currentWave + 1}的Worker`, 'xiongda');
    ctx.setRole('xiongda', 'WORKING', `派发波次${ctx.currentWave + 1}`);
    if (ctx.currentWave >= 0 && ctx.waves[ctx.currentWave]) {
      const wave = ctx.waves[ctx.currentWave];
      wave.roles.forEach(roleId => ctx.setRole(roleId, 'WORKING', wave.task || '执行中'));
    }
  },
  EXECUTING: (ctx) => {
    ctx.log('info', 'Worker执行中', null);
  },
  VERIFYING: (ctx) => {
    const verifier = ctx.currentVerifier || 'jiji';
    ctx.log('info', `验证阶段开始，${ctx.getRoleName(verifier)}审查中`, verifier);
    ctx.setRole(verifier, 'WORKING', '审查中');
  },
  ITERATING: (ctx) => {
    ctx.iterationCount++;
    ctx.log('warn', `验证驳回！第${ctx.iterationCount}轮重跑，派发萝卜头修复`, 'luobotou');
    if (ctx.iterationCount > ctx.maxIterations) {
      ctx.log('error', `超过最大迭代次数(${ctx.maxIterations})，升级用户决策`, 'xiongda');
      return 'FAILED';
    }
    ctx.setRole('luobotou', 'WORKING', '修复驳回问题');
  },
  DELIVERING: (ctx) => {
    ctx.log('info', '熊大汇总产出，准备交付', 'xiongda');
    ctx.setRole('xiongda', 'WORKING', '汇总交付');
  },
  COMPLETED: (ctx) => {
    ctx.log('info', '任务完成！', 'xiongda');
    ctx.setRole('xiongda', 'DONE', '交付完成');
    ctx.task.status = 'completed';
    ctx.task.completedAt = new Date().toISOString();
  },
  FAILED: (ctx) => {
    ctx.log('error', '任务失败终止', 'xiongda');
    ctx.setRole('xiongda', 'FAILED', '任务失败');
    ctx.task.status = 'failed';
  },
};

class StateMachine {
  constructor(context) {
    this.state = 'IDLE';
    this.context = context;
    this.history = [];
    this.listeners = new Set();
  }

  canTransition(to) {
    const allowed = TRANSITIONS[this.state] || [];
    return allowed.includes(to);
  }

  transition(to, extra = {}) {
    if (!this.canTransition(to)) {
      const err = `非法状态转换：${this.state} → ${to}（允许：${(TRANSITIONS[this.state]||[]).join('/')})`;
      this.context.log('error', err, 'xiongda');
      throw new Error(err);
    }

    const entry = { from: this.state, to, timestamp: new Date().toISOString(), ...extra };
    this.history.push(entry);

    const prev = this.state;
    this.state = to;
    this.context.log('info', `状态转换：${STATES[prev]?.label || prev} → ${STATES[to]?.label || to}`, null);
    this.notify();

    const action = ENTRY_ACTIONS[to];
    if (action) {
      const overrideState = action(this.context);
      if (overrideState && this.canTransition(overrideState)) {
        return this.transition(overrideState, { auto: true });
      }
    }
    return true;
  }

  getState() { return this.state; }

  getHistory() { return [...this.history]; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    const snapshot = { state: this.state, history: [...this.history] };
    for (const fn of this.listeners) {
      try { fn(snapshot); } catch {}
    }
  }

  reset() {
    this.state = 'IDLE';
    this.history = [];
    this.notify();
  }
}

module.exports = { StateMachine, STATES, TRANSITIONS };
