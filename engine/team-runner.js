/**
 * 熊出没集团 · 团队调度引擎
 * 用代码状态机驱动任务流程，替代文档约束
 *
 * 使用方式：
 *   const runner = new TeamRunner(stateModule);
 *   runner.startTask({ title: '创建登录页面', complexity: 'complex' });
 *   runner.startDrafting(wavePlan);
 *   runner.completeDrafting();
 *   runner.startDispatching();
 *   runner.completeWorker('xionger', '代码完成');
 *   runner.startVerification('jiji');
 *   runner.completeVerification(true);  // 通过
 *   runner.deliver();
 */

const { StateMachine, STATES } = require('./state-machine');
const { evaluateAuto } = require('./complexity-evaluator');

class TeamRunner {
  constructor(stateModule) {
    this.sm = stateModule;
    this.machine = null;
    this.ctx = null;
  }

  get currentTask() { return this.ctx?.task || null; }
  get currentState() { return this.machine?.getState() || 'IDLE'; }

  _createContext(taskInfo) {
    const self = this;
    return {
      task: { ...taskInfo, status: 'in_progress', createdAt: new Date().toISOString() },
      currentWave: -1,
      waves: [],
      currentVerifier: null,
      iterationCount: 0,
      maxIterations: 3,
      completedWorkers: new Set(),

      log(level, message, roleId) {
        self.sm.addLog(level, message, roleId);
      },
      setRole(roleId, status, task) {
        self.sm.setRoleStatus(roleId, status, task);
      },
      getRoleName(roleId) {
        const r = self.sm.ROLES.find(r => r.id === roleId);
        return r ? r.name : roleId;
      },
    };
  }

  startTask(taskInfo) {
    if (this.machine && this.machine.getState() !== 'IDLE' && this.machine.getState() !== 'COMPLETED' && this.machine.getState() !== 'FAILED') {
      throw new Error(`当前任务未结束（状态：${this.currentState}），无法启动新任务`);
    }
    this.sm.resetTask();
    this.ctx = this._createContext(taskInfo);
    this.machine = new StateMachine(this.ctx);
    this.sm.startTask(taskInfo);
    this.machine.transition('DRAFTING');
    // 未显式指定复杂度时自动评估（文本启发式），并记录评估结论
    if (!this.ctx.task.complexity) {
      const assessment = evaluateAuto(this.ctx.task.requirement || this.ctx.task.title || '');
      this.ctx.task.complexity = assessment.level;
      this.ctx.task.assessment = assessment;
      const basis = assessment.basis === 'text' ? '关键词判断' : `得分 ${assessment.score}`;
      this.ctx.log('info', `复杂度评估：${assessment.level}（${basis}），处理方式：${assessment.strategy}`, 'xiongda');
    }
    return this;
  }

  startDrafting(wavePlan) {
    this._ensureState('DRAFTING');
    if (wavePlan) {
      this.ctx.waves = wavePlan;
      this.sm.addLog('info', `拆解完成：${wavePlan.length}个波次，${wavePlan.reduce((a,w)=>a+w.roles.length,0)}人次`, 'xiongda');
    }
    return this;
  }

  completeDrafting() {
    this._ensureState('DRAFTING');
    this.sm.setRoleStatus('xiongda', 'DONE', '拆解完成');
    this.machine.transition('DISPATCHING');
    return this;
  }

  startDispatching() {
    if (this.currentState === 'DRAFTING') this.completeDrafting();
    return this;
  }

  dispatchWave(waveIndex, waveData) {
    this._ensureState('DISPATCHING');
    this.ctx.currentWave = waveIndex;
    if (waveData) {
      this.ctx.waves[waveIndex] = waveData;
      this.sm.addWave({ ...waveData, title: waveData.title || waveData.roles.map(r => this.ctx.getRoleName(r)).join('+') });
    }
    this.sm.setWaveStatus(waveIndex, 'executing');
    this.ctx.completedWorkers.clear();
    // 重新触发 DISPATCHING entry action 派发当前波次
    this.ctx.log('info', `波次${waveIndex + 1}开始：${this.ctx.waves[waveIndex].roles.map(r => this.ctx.getRoleName(r)).join(' + ')}`, 'xiongda');
    this.ctx.waves[waveIndex].roles.forEach(roleId => {
      this.ctx.setRole(roleId, 'WORKING', this.ctx.waves[waveIndex].task || '执行中');
    });
    this.machine.transition('EXECUTING');
    return this;
  }

  completeWorker(roleId, result) {
    this._ensureState('EXECUTING');
    this.sm.setRoleStatus(roleId, 'DONE', result);
    this.ctx.completedWorkers.add(roleId);
    const wave = this.ctx.waves[this.ctx.currentWave];
    if (wave && wave.roles.every(r => this.ctx.completedWorkers.has(r))) {
      this.sm.setWaveStatus(this.ctx.currentWave, 'done');
      this.ctx.log('info', `波次${this.ctx.currentWave + 1}全部完成`, null);
      this.machine.transition('VERIFYING');
    }
    return this;
  }

  startVerification(verifierId) {
    if (this.currentState === 'EXECUTING') {
      this.ctx.currentVerifier = verifierId || 'jiji';
      this.machine.transition('VERIFYING');
    } else if (this.currentState === 'VERIFYING') {
      this.ctx.currentVerifier = verifierId || this.ctx.currentVerifier || 'jiji';
    }
    return this;
  }

  completeVerification(passed, issues = []) {
    this._ensureState('VERIFYING');
    const verifier = this.ctx.currentVerifier || 'jiji';
    if (passed) {
      this.sm.setRoleStatus(verifier, 'DONE', '验证通过');
      this.ctx.log('info', `${this.ctx.getRoleName(verifier)}审查通过`, verifier);
      this.machine.transition('DELIVERING');
    } else {
      this.sm.setRoleStatus(verifier, 'FAILED', `驳回（${issues.length}个问题）`);
      this.ctx.log('warn', `${this.ctx.getRoleName(verifier)}驳回：${issues.length}个问题`, verifier);
      this.machine.transition('ITERATING');
    }
    return this;
  }

  startIteration() {
    this._ensureState('ITERATING');
    // ITERATING entry action 已自动处理迭代计数和角色派发
    // 完成后自动切回 DISPATCHING 重派
    return this;
  }

  completeIteration() {
    this._ensureState('ITERATING');
    this.sm.setRoleStatus('luobotou', 'DONE', '修复完成');
    this.ctx.log('info', '萝卜头修复完成，重新派发验证', 'luobotou');
    this.machine.transition('DISPATCHING');
    return this;
  }

  deliver(result) {
    this._ensureState('DELIVERING');
    if (result) this.ctx.task.result = result;
    this.sm.completeTask(result || '任务完成');
    this.machine.transition('COMPLETED');
    return this;
  }

  fail(reason) {
    this.ctx.log('error', `任务失败：${reason}`, 'xiongda');
    try { this.machine.transition('FAILED', { reason }); } catch {}
    return this;
  }

  reset() {
    if (this.machine) this.machine.reset();
    this.sm.resetTask();
    this.ctx = null;
    this.machine = null;
    return this;
  }

  _ensureState(expected) {
    if (this.currentState !== expected) {
      throw new Error(`状态机当前状态为${STATES[this.currentState]?.label || this.currentState}，需要${STATES[expected]?.label || expected}才能执行此操作`);
    }
  }

  getSnapshot() {
    return {
      state: this.currentState,
      task: this.ctx?.task || null,
      currentWave: this.ctx?.currentWave ?? -1,
      iterationCount: this.ctx?.iterationCount ?? 0,
      history: this.machine?.getHistory() || [],
    };
  }
}

module.exports = { TeamRunner };
