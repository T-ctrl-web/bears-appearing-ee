const fs = require('fs');
const path = require('path');

const PERSIST_PATH = path.join(__dirname, '..', 'data', 'state-backup.json');

const ROLES = [
  { id: 'xiongda', name: '熊大', role: '总裁', tier: 'leader', avatar: '🐻' },
  { id: 'guangtouqiang', name: '光头强', role: '架构', tier: 'worker', avatar: '👷' },
  { id: 'xionger', name: '熊二', role: '开发', tier: 'worker', avatar: '🐻' },
  { id: 'bengbeng', name: '蹦蹦', role: '测试', tier: 'worker', avatar: '🐿️' },
  { id: 'luobotou', name: '萝卜头', role: '调试', tier: 'worker', avatar: '🦫' },
  { id: 'feibo', name: '肥波', role: '文档', tier: 'worker', avatar: '🐱' },
  { id: 'cuihua', name: '翠花', role: '界面', tier: 'worker', avatar: '🐼' },
  { id: 'tutu', name: '涂涂', role: '视觉', tier: 'worker', avatar: '🦉' },
  { id: 'tuotuo', name: '拖拖', role: '运维', tier: 'worker', avatar: '🐢' },
  { id: 'maomao', name: '毛毛', role: '调研', tier: 'worker', avatar: '🐒' },
  { id: 'jiji', name: '吉吉国王', role: '代码质检', tier: 'verifier', avatar: '👑' },
  { id: 'laoe', name: '老鳄', role: '设计质检', tier: 'verifier', avatar: '🐊' },
  { id: 'xiaoli', name: '小狸', role: '质量门禁', tier: 'verifier', avatar: '🦊' },
  { id: 'tiezhang', name: '铁掌大师', role: '安全', tier: 'verifier', avatar: '🐯' },
];

const STATES = {
  IDLE: { label: '空闲', color: '#94a3b8', icon: '○' },
  WORKING: { label: '执行中', color: '#3b82f6', icon: '▶' },
  WAITING: { label: '等待验证', color: '#f59e0b', icon: '⏳' },
  DONE: { label: '完成', color: '#22c55e', icon: '✓' },
  FAILED: { label: '失败', color: '#ef4444', icon: '✗' },
};

const state = {
  roles: ROLES.map(r => ({ ...r, status: 'IDLE', task: '', startTime: null, endTime: null })),
  task: null,
  taskQueue: [],
  waves: [],
  currentWave: -1,
  logs: [],
  startedAt: null,
  tokenUsage: { total: 0, byRole: {}, calls: 0 },
};

const listeners = new Set();

function persist() {
  try {
    const dir = path.dirname(PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[state] persist failed:', e.message);
  }
}

function loadPersisted() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const saved = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf-8'));
    if (saved && typeof saved === 'object') {
      Object.assign(state, saved);
      console.log('[state] Restored from', PERSIST_PATH);
    }
  } catch (e) {
    console.error('[state] loadPersisted failed:', e.message);
  }
}

loadPersisted();

function getState() {
  return JSON.parse(JSON.stringify(state));
}

function setState(updater) {
  const prev = JSON.stringify(state);
  if (typeof updater === 'function') updater(state);
  else Object.assign(state, updater);
  const next = JSON.stringify(state);
  if (prev !== next) notify();
}

function notify() {
  const snapshot = getState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch {}
  }
  persist();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function addLog(level, message, roleId) {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    roleId: roleId || null,
  };
  state.logs.push(entry);
  if (state.logs.length > 200) state.logs.shift();
  notify();
  return entry;
}

function enqueueTask(taskInfo, priority = 'P1') {
  const entry = {
    ...taskInfo,
    priority,
    status: 'queued',
    queuedAt: new Date().toISOString(),
  };
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  state.taskQueue.push(entry);
  state.taskQueue.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
  addLog('info', `任务入队（${priority}）：${taskInfo.title || '未命名任务'}`);
  notify();
  return entry;
}

function dequeueTask() {
  if (state.taskQueue.length === 0) return null;
  const next = state.taskQueue.shift();
  notify();
  return next;
}

function resetTask() {
  state.roles = ROLES.map(r => ({ ...r, status: 'IDLE', task: '', startTime: null, endTime: null }));
  state.task = null;
  state.waves = [];
  state.currentWave = -1;
  state.logs = [];
  state.startedAt = null;
  notify();
}

function startTask(taskInfo) {
  resetTask();
  state.task = { ...taskInfo, status: 'in_progress', createdAt: new Date().toISOString() };
  state.startedAt = new Date().toISOString();
  addLog('info', `任务启动：${taskInfo.title || '未命名任务'}`);
  notify();
}

function setRoleStatus(roleId, status, task) {
  const role = state.roles.find(r => r.id === roleId);
  if (!role) { addLog('error', `角色未找到：${roleId}`); return; }
  const prev = role.status;
  role.status = status;
  if (task !== undefined) role.task = task;
  if (status === 'WORKING' && !role.startTime) role.startTime = new Date().toISOString();
  if ((status === 'DONE' || status === 'FAILED') && !role.endTime) role.endTime = new Date().toISOString();
  if (prev !== status) {
    addLog('info', `${role.name}（${role.role}）状态：${STATES[prev]?.label || prev} → ${STATES[status]?.label || status}`, roleId);
  }
  notify();
}

function addWave(wave) {
  state.waves.push({ ...wave, id: wave.id || `wave-${state.waves.length + 1}`, status: 'pending' });
  state.currentWave = state.waves.length - 1;
  addLog('info', `波次 ${state.waves.length} 加入调度：${wave.roles.map(r => r).join(', ')}`);
  notify();
}

function setWaveStatus(waveIndex, status) {
  if (waveIndex < 0 || waveIndex >= state.waves.length) return;
  state.waves[waveIndex].status = status;
  state.currentWave = waveIndex;
  addLog('info', `波次 ${waveIndex + 1} 状态：${status}`);
  notify();
}

function completeTask(result) {
  if (state.task) {
    state.task.status = 'completed';
    state.task.result = result;
    state.task.completedAt = new Date().toISOString();
  }
  addLog('info', `任务完成：${state.task?.title || ''}`);
  notify();
}

function addTokenUsage(roleId, tokens) {
  state.tokenUsage.total += tokens;
  state.tokenUsage.calls += 1;
  state.tokenUsage.byRole[roleId] = (state.tokenUsage.byRole[roleId] || 0) + tokens;
  notify();
}

function getTokenUsage() {
  return JSON.parse(JSON.stringify(state.tokenUsage));
}

module.exports = {
  ROLES,
  STATES,
  getState,
  setState,
  subscribe,
  addLog,
  resetTask,
  startTask,
  setRoleStatus,
  addWave,
  setWaveStatus,
  completeTask,
  enqueueTask,
  dequeueTask,
  addTokenUsage,
  getTokenUsage,
};
