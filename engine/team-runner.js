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
const { mapLimit } = require('./harness-adapter');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 任务工作区根目录：桌面版（MAVIS_USER_DATA）优先，开发态 ~/.mavis。
// 不放项目目录内（打包后项目位于只读 asar）。
const WORKSPACE_ROOT = process.env.MAVIS_USER_DATA
  ? path.join(process.env.MAVIS_USER_DATA, 'workspaces')
  : path.join(os.homedir(), '.mavis', 'workspaces');

function createWorkspace(taskInfo) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  const slug = String(taskInfo.title || taskInfo.requirement || 'task')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'task';
  const dir = path.join(WORKSPACE_ROOT, `${ts}-${slug}-${rand}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listWorkspaceFiles(dir, limit = 200) {
  try {
    const out = [];
    const walk = (d, prefix) => {
      for (const name of fs.readdirSync(d).sort()) {
        if (out.length >= limit) return;
        const full = path.join(d, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        const st = fs.statSync(full);
        out.push(st.isDirectory() ? `${rel}/` : rel);
        if (st.isDirectory()) walk(full, rel);
      }
    };
    walk(dir, '');
    return out;
  } catch {
    return [];
  }
}

class TeamRunner {
  constructor(stateModule, options = {}) {
    this.sm = stateModule;
    this.harness = options.harness || null;
    this.machine = null;
    this.ctx = null;
    this._execution = null; // 进行中的波次异步执行 Promise（测试/运维可 await）
    this._verification = null; // 进行中的异步审查 Promise
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
    if (this.harness && typeof this.harness.resetTaskBudget === 'function') {
      this.harness.resetTaskBudget(); // 每个任务独立的 per_task 预算（会话级继续累积）
    }
    this.ctx = this._createContext(taskInfo);
    this._execution = null;
    this._verification = null;
    // autoExecute：由 harness 真实执行 Worker 任务（需同时具备 harness）
    this.autoExecute = !!(taskInfo.autoExecute && this.harness);
    // 任务专属工作区：Worker 用工具把产出写成真实文件（工具层 P1/P2）
    if (this.autoExecute && taskInfo.workspace !== false) {
      try {
        this.ctx.task.workspace = createWorkspace(taskInfo);
        this.ctx.log('info', `任务工作区已创建：${this.ctx.task.workspace}`, 'xiongda');
      } catch (e) {
        this.ctx.log('warn', `工作区创建失败（退化为纯文本产出）：${e.message}`, 'xiongda');
      }
    }
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
    // 真实执行闭环：autoExecute 时由 harness 调用 LLM 执行，完成后自动 completeWorker
    if (this.autoExecute && this.harness && this.ctx.waves[waveIndex].roles.length) {
      this._executeWaveAsync(this.ctx.waves[waveIndex], waveIndex);
    }
    return this;
  }

  /**
   * 异步执行波次：并发调用 harness（最多 3 个），每个 Worker 完成后回调 completeWorker。
   * 波次全部完成后状态机自动进入 VERIFYING。
   */
  _executeWaveAsync(wave, waveIndex) {
    const task = wave.task || this.ctx.task.requirement || this.ctx.task.title || '';
    const context = wave.context || '';
    if (this.autoExecute) {
      this.ctx.log('info', `波次${waveIndex + 1}进入 harness 执行（${this.harness.config?.engine || 'harness'}引擎，最多3并发）`, null);
    }
    this._execution = mapLimit(wave.roles, 3, async (roleId) => {
      const res = await this.harness.executeWorker({
        roleId, task, context,
        workspace: this.ctx.task.workspace || null, // 工具层：产出落真实文件
      });
      if (!this.ctx || this.currentState === 'IDLE') return res; // 任务已被重置，丢弃过期结果

      wave.outputs = wave.outputs || {};
      if (res.status === 'success') {
        wave.outputs[roleId] = res.output;
        const meta = res.meta || {};
        const toolNote = meta.toolCalls != null ? `，工具调用${meta.toolCalls}次` : '';
        this.ctx.log('info', `${res.assignee}（${res.engine}）执行完成，耗时${res.duration_ms}ms${toolNote}`, roleId);
        if (meta.files && meta.files.length) {
          this.ctx.log('info', `产出文件 ${meta.files.length} 个：${meta.files.slice(0, 5).join('、')}${meta.files.length > 5 ? '…' : ''}`, roleId);
        }
        const summary = String(res.output).slice(0, 120) + (String(res.output).length > 120 ? '…' : '');
        try { this.completeWorker(roleId, summary); }
        catch (e) { this.ctx.log('warn', `忽略过期的完成回调（${roleId}）：${e.message}`, roleId); }
      } else {
        wave.outputs[roleId] = null;
        this.ctx.log('error', `${res.assignee} 执行失败：${res.error}`, roleId);
        try { this.completeWorker(roleId, `执行失败：${res.error}`); }
        catch (e) { this.ctx.log('warn', `忽略过期的完成回调（${roleId}）：${e.message}`, roleId); }
      }
      return res;
    }).catch((err) => {
      if (this.ctx) this.ctx.log('error', `波次${waveIndex + 1}执行异常：${err.message}`, null);
      return [];
    });
    return this._execution;
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
      this._maybeAutoVerify(wave); // Verifier 真实 LLM 对抗审查闭环
    }
    return this;
  }

  /**
   * 解析本次验证的级别与 Verifier：
   *   优先取复杂度评估结论（assessment.verification），否则按 complexity 映射，默认 L1 吉吉国王
   */
  _resolveVerification() {
    const t = this.ctx.task;
    const av = t.assessment?.verification;
    const level = av?.level || { medium: 'level_1', complex: 'level_2' }[t.complexity] || 'level_1';
    const verifierId = (av?.verifiers || [])[0]
      || { medium: 'jiji', complex: 'laoe' }[t.complexity]
      || this.ctx.currentVerifier
      || 'jiji';
    return { level, verifierId };
  }

  /**
   * Verifier 自动对抗审查闭环：
   *   审查通过 → 有下一波则继续派发（多波次流水线），否则自动交付
   *   审查驳回 → ITERATING（萝卜头修复）→ 自动重派当前波次（携带驳回问题上下文）→ 再次执行与审查
   *   迭代超限由状态机 ITERATING entry action 终止为 FAILED
   *   L1 柔性审查按规则不强制驳回（问题仅作建议）
   */
  _maybeAutoVerify(wave) {
    if (!this.autoExecute || !this.harness) return null;
    const { level, verifierId } = this._resolveVerification();
    this.ctx.currentVerifier = verifierId;
    const task = wave.task || this.ctx.task.requirement || this.ctx.task.title || '';

    this._verification = (async () => {
      this.ctx.log('info', `${this.ctx.getRoleName(verifierId)} 开始${level === 'level_3' ? '强对抗' : ''}审查（${level}，第${this.ctx.iterationCount + 1}轮）`, verifierId);
      const verdict = await this.harness.executeVerifier({
        verifierId,
        level,
        task,
        outputs: wave.outputs || {},
        iteration: this.ctx.iterationCount + 1,
        maxIterations: this.ctx.maxIterations,
        workspace: this.ctx.task.workspace || null, // 工具层：Verifier 只读工具看真实文件
      });
      if (!this.ctx || this.currentState === 'IDLE') return verdict; // 任务已被重置，丢弃过期结论

      // 审查调用本身失败：默认拒绝，记录错误，升级用户决策
      let passed;
      if (verdict.status === 'failed') {
        passed = false;
        this.ctx.log('error', `审查调用失败，默认拒绝（${verdict.error}）。需人工确认是否放行`, verifierId);
      } else {
        passed = verdict.passed;
      }

      // L1 柔性审查：问题记录为建议，但不强制驳回（可配置）
      const l1Config = this.harness?.verificationRules?.levels?.level_1 || {};
      const l1Enforce = l1Config.enforce_reject !== false;
      if (!passed && level === 'level_1' && verdict.status !== 'failed' && !l1Enforce) {
        passed = true;
        this.ctx.log('info', `L1 柔性审查：${(verdict.issues || []).length}条问题仅作建议，不驳回（enforce_reject=false）`, verifierId);
      } else if (!passed && level === 'level_1' && verdict.status !== 'failed' && l1Enforce) {
        this.ctx.log('warn', `L1 审查驳回：${(verdict.issues || []).length}条问题`, verifierId);
      }

      this.ctx.task.verification = {
        verifierId, level, passed,
        issues: verdict.issues || [],
        verdict: verdict.verdict || '',
        iteration: this.ctx.iterationCount + 1,
      };

      if (passed) {
        const nextIndex = this.ctx.currentWave + 1;
        const nextWave = this.ctx.waves[nextIndex];
        if (nextWave && Array.isArray(nextWave.roles) && nextWave.roles.length) {
          // 多波次流水线：验证通过，继续派发下一波
          this.sm.setRoleStatus(verifierId, 'DONE', '验证通过');
          this.ctx.log('info', `${this.ctx.getRoleName(verifierId)} 审查通过，继续派发波次${nextIndex + 1}`, verifierId);
          this.machine.transition('DISPATCHING');
          this.dispatchWave(nextIndex, nextWave);
        } else {
          // 末波通过：走标准验证通过路径并自动交付
          this.completeVerification(true);
          this.ctx.log('info', '全部波次完成且验证通过，自动交付', 'xiongda');
          this.deliver(this._aggregateOutputs());
        }
      } else {
        this.completeVerification(false, verdict.issues || []);
        // 自动驳回重跑：萝卜头修复后重派当前波次（携带驳回问题）
        if (this.currentState === 'ITERATING') {
          this.completeIteration();
          const fixCtx = (verdict.issues || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
          this.ctx.log('info', `重派波次${this.ctx.currentWave + 1}，Worker 需修复驳回问题`, 'xiongda');
          this.dispatchWave(this.ctx.currentWave, {
            ...wave,
            context: `${wave.context || ''}\n\n## 上一轮驳回问题（必须修复）\n${fixCtx}`.trim(),
          });
        }
      }
      return verdict;
    })().catch((err) => {
      if (this.ctx) this.ctx.log('error', `自动验证异常：${err.message}`, null);
      return null;
    });
    return this._verification;
  }

  /** 汇总所有波次产出为交付物文本 */
  _aggregateOutputs() {
    const parts = [];
    (this.ctx.waves || []).forEach((w, i) => {
      const outs = Object.entries(w.outputs || {})
        .map(([rid, out]) => `### ${this.ctx.getRoleName(rid)}\n${out ?? '（执行失败）'}`);
      if (outs.length) parts.push(`## 波次${i + 1}\n${outs.join('\n\n')}`);
    });
    // 工具层交付：附工作区真实产物清单与路径
    const ws = this.ctx.task?.workspace;
    if (ws) {
      const files = listWorkspaceFiles(ws);
      parts.push(`## 工作区产物\n路径：${ws}\n${files.length ? files.map(p => `- ${p}`).join('\n') : '（无文件）'}`);
    }
    return parts.join('\n\n') || '（无产出）';
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
    this._execution = null;
    this._verification = null;
    this.autoExecute = false;
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
      waveOutputs: (this.ctx?.waves || []).map(w => w.outputs || {}),
      history: this.machine?.getHistory() || [],
    };
  }
}

module.exports = { TeamRunner };
