/**
 * 熊出没集团 · 自由讨论引擎
 *
 * 让多个角色围绕一个议题"自由讨论"：每次发言都追加到共享转录(transcript)，
 * 下一个发言者基于"议题 + 之前所有发言"来回应/反驳/补充，形成真正的对话感。
 * 达到最大轮数后由主持人(熊大)收敛输出结论。
 *
 * 设计要点：
 *   - 独立于任务状态机：讨论是并行的"开会"，不占用任务闭环
 *   - 转录放在模块内存；每个发言通过回调 callbacks.onSpeak 播报到看板气泡
 *   - 每轮每个参与者限发言一次，角色间天然轮流、可回应前者
 *   - maxRounds 控制讨论深度，预算复用 harness 的任务/会话护栏
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PARTICIPANTS = ['guangtouqiang', 'xionger', 'jiji', 'cuihua']; // 默认参会：架构/开发/质检/界面
const DEFAULT_ROUNDS = 2;
const MAX_SPEAK_BYTES = 4000; // 单条发言保留上限，避免上下文爆炸

class DiscussionEngine {
  /**
   * @param {object} deps - { harness, addLog, ROLES, dataDir }
   *   harness: HarnessAdapter 实例（含 roleMap、_chatCompletion、token 护栏）
   *   addLog: 用来往看板日志/气泡播报 (level, message, roleId)
   *   ROLES: 角色数组（server/state ROLES）
   *   dataDir: 用户数据目录（用于持久化讨论记录，落盘到 dataDir/discussions/*.json）
   */
  constructor({ harness, addLog, ROLES = [], dataDir }) {
    this.harness = harness;
    this.addLog = addLog;
    this.ROLES = ROLES;
    this.dataDir = dataDir ? path.join(dataDir, 'discussions') : null;
    this.active = null; // { id, topic, participants, round, maxRounds, transcript:[] }
    this.last = null;   // 最近一场已结束讨论的只读快照（供面板回看）
    this._ensureDir();
  }

  _ensureDir() {
    if (this.dataDir) { try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch { /* 只读环境忽略 */ } }
  }

  /** 落盘一场讨论记录 */
  _persist(disc) {
    if (!this.dataDir) return;
    try {
      const rec = {
        id: disc.id,
        topic: disc.topic,
        participants: disc.participants,
        maxRounds: disc.maxRounds,
        concludedAt: new Date().toISOString(),
        transcript: disc.transcript.map(l => ({
          role: l.role, name: this.name(l.role), text: l.text, summary: !!l.summary,
        })),
      };
      fs.writeFileSync(path.join(this.dataDir, `${disc.id}.json`), JSON.stringify(rec, null, 2), 'utf-8');
    } catch (e) { /* 持久化失败不影响运行 */ }
  }

  /** 历史讨论列表（时间倒序），每项含摘要 */
  history() {
    if (!this.dataDir) return [];
    try {
      const files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
      const list = files.map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(this.dataDir, f), 'utf-8'));
          return {
            id: d.id,
            topic: d.topic,
            participants: d.participants || [],
            concludedAt: d.concludedAt || '',
            count: (d.transcript || []).length,
            summary: (d.transcript || []).filter(l => l.summary).map(l => l.text).join(' ').slice(0, 200),
          };
        } catch { return null; }
      }).filter(Boolean);
      return list.sort((a, b) => (b.concludedAt || '').localeCompare(a.concludedAt || ''));
    } catch { return []; }
  }

  /** 加载一场历史讨论的完整记录 */
  load(id) {
    if (!this.dataDir || !id) return null;
    try {
      const f = path.join(this.dataDir, `${id}.json`);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch { return null; }
  }

  get roleNames() {
    const m = {};
    for (const r of this.ROLES) m[r.id] = r.name;
    return m;
  }

  name(id) {
    return this.roleNames[id] || this.harness?.roleMap?.[id]?.name || id;
  }

  isRunning() {
    return this.active !== null;
  }

  /** 解析出有效参会角色 id（去掉不存在/重复的） */
  _resolveParticipants(ids, topic) {
    const list = (ids && ids.length) ? ids : DEFAULT_PARTICIPANTS;
    const seen = new Set(['xiongda']); // 主持人总是主持但不参与发言
    const out = [];
    for (const id of list) {
      const r = this.harness?.roleMap?.[id];
      if (!r) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    // 至少要有 2 个讨论者，否则生硬
    return out.length >= 1 ? out : ['guangtouqiang', 'xionger'];
  }

  _buildSystemPrompt(roleId) {
    const info = this.harness.roleMap[roleId];
    if (info && info.file) {
      try {
        return fs.readFileSync(path.join(require('path').resolve(__dirname, '..'), info.file), 'utf-8');
      } catch { /* fallthrough */ }
    }
    return `你是熊出没集团的${this.name(roleId)}（${info?.role || roleId}）。在团队自由讨论中，以你的专业角色发言。`;
  }

  /** 给某个角色构造"该说话了"的 user prompt */
  _buildSpeakPrompt(topic, transcript, round, maxRounds, isSummary) {
    const parts = [`## 团队自由讨论议题\n${topic || '（无议题）'}`];
    if (transcript.length) {
      parts.push(`## 到目前为止的讨论记录\n${transcript.map(l => `${this.name(l.role)}：${l.text}`).join('\n\n')}`);
    }
    if (isSummary) {
      parts.push('## 你的任务（主持人）\n请综合大家的发言，输出一段收敛后的最终结论（含达成的共识与尚待解决的分歧）。');
    } else {
      parts.push(`## 轮到你了（第 ${round}/${maxRounds} 轮）\n请基于以上讨论，以你的专业视角发言。可以：支持他人观点、提出反对/补充、指出被忽略的风险、给出你的建议。要像真人在开会那样自然，尽量简短有力。直接输出你的发言内容即可。`);
    }
    return parts.join('\n\n');
  }

  /**
   * 启动一场自由讨论
   * @returns {object} { id, topic, participants }
   */
  start({ topic, participants, maxRounds = DEFAULT_ROUNDS }) {
    if (this.active) throw new Error('已有一场讨论在进行，请先结束或等它跑完');
    const resolved = this._resolveParticipants(participants, topic);
    const id = `disc-${Date.now()}`;
    const maxR = Math.max(1, Math.min(Number(maxRounds) || DEFAULT_ROUNDS, 4));
    this.active = {
      id, topic: String(topic || '').trim() || '未命议题',
      participants: resolved,
      round: 0,
      maxRounds: maxR,
      transcript: [],
      stopped: false,
    };
    const names = resolved.map(r => this.name(r)).join('、');
    if (this.addLog) this.addLog('info', `🐻 熊大召开自由讨论：${this.active.topic}（参会：${names}）`, 'xiongda');
    return { id, topic: this.active.topic, participants: resolved };
  }

  stop() {
    if (this.active) this.active.stopped = true;
    const was = this.active;
    this.active = null;
    return was;
  }

  async run() {
    if (!this.active) return;
    const { topic, participants, maxRounds, id } = this.active;
    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (this.active?.stopped || this.active?.id !== id) return;
        this.active.round = round;
        for (const pid of participants) {
          if (this.active?.stopped || this.active?.id !== id) return;
          const text = await this._speak(pid, topic, this.active.transcript, round, maxRounds, false);
          if (text == null) continue; // 该角色本轮跳过（失败/预算）
          this.active.transcript.push({ role: pid, text });
          if (this.addLog) this.addLog('info', text.slice(0, 200), pid);
        }
      }
      // 收敛：主持人总结
      if (this.active?.id === id && !this.active?.stopped) {
        const summary = await this._speak('xiongda', topic, this.active.transcript, this.active.maxRounds, this.active.maxRounds, true);
        if (summary != null) {
          this.active.transcript.push({ role: 'xiongda', text: summary, summary: true });
          if (this.addLog) this.addLog('info', `🐻 熊大结论：${summary.slice(0, 400)}`, 'xiongda');
        }
      }
    } finally {
      if (this.active?.id === id) {
        const done = this.active;
        this.active = null;
        // 保存只读快照供回看（transcript 深拷贝，避免后续被覆盖）
        this.last = {
          id: done.id,
          topic: done.topic,
          participants: done.participants,
          maxRounds: done.maxRounds,
          transcript: done.transcript.map(l => ({ ...l })),
        };
        // 持久化到磁盘，结束的服务重启后仍可回看
        this._persist(done);
        if (this.addLog) this.addLog('info', `讨论结束：${done.transcript.length} 条发言（已存档）`, 'xiongda');
      }
    }
  }

  /** 单角色发言；预算超限/临时失败返回 null */
  async _speak(roleId, topic, transcript, round, maxRounds, isSummary) {
    try {
      // mock 引擎：确定性发言，发真实请求会崩（_postChat 无 mock 分支）
      if (this.harness.config.engine === 'mock') {
        const mine = this.name(roleId);
        if (isSummary) {
          return `讨论结束。综合大家意见，共识是围绕「${topic}」方向上可行，仍需关注执行细节与风险对冲。`;
        }
        const base = `${mine}（${round}轮）：我觉得「${topic}」${round === 1 ? '值得做，但要先把范围收紧' : '需要补充风险点，避免过度设计'}。`;
        if (transcript.length) base += ` 回应${transcript[transcript.length - 1].role === roleId ? '上一位' : this.name(transcript[transcript.length - 1].role)}的观点——基本同意，但提出一点补充。`;
        return base;
      }
      const sys = this._buildSystemPrompt(roleId);
      const user = this._buildSpeakPrompt(topic, transcript, round, maxRounds, isSummary);
      const r = await this.harness._chatCompletion(sys, user, roleId);
      if (!r.ok) {
        if (this.addLog) this.addLog('warn', `${this.name(roleId)} 本轮未发言（${r.error}）`, roleId);
        return null;
      }
      const txt = String(r.content || '').trim();
      if (!txt) return null;
      return txt.length > MAX_SPEAK_BYTES ? txt.slice(0, MAX_SPEAK_BYTES) : txt;
    } catch (e) {
      if (this.addLog) this.addLog('error', `${this.name(roleId)} 发言异常：${e.message}`, roleId);
      return null;
    }
  }

  status() {
    if (!this.active) {
      // 未在讨论：返回最近一场（若有）供面板回看转录
      if (this.last) {
        return {
          running: false,
          id: this.last.id,
          topic: this.last.topic,
          participants: Array.isArray(this.last.participants) ? this.last.participants.map(r => ({ id: r, name: this.name(r) })) : [],
          transcript: this.last.transcript.map(l => ({ role: l.role, name: this.name(l.role), text: l.text, summary: !!l.summary })),
        };
      }
      return { running: false, transcript: [] };
    }
    return {
      running: true,
      id: this.active.id,
      topic: this.active.topic,
      round: this.active.round,
      maxRounds: this.active.maxRounds,
      participants: this.active.participants.map(r => ({ id: r, name: this.name(r) })),
      transcript: this.active.transcript.map(l => ({ role: l.role, name: this.name(l.role), text: l.text, summary: !!l.summary })),
    };
  }
}

module.exports = { DiscussionEngine };