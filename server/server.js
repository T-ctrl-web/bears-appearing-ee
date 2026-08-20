const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3121;
const ROOT = path.resolve(__dirname, '..');
const DASHBOARD = path.join(ROOT, 'dashboard.html');

const {
  getState,
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
  removeQueuedTask,
  ROLES,
} = require('./state');

const { TeamRunner, getWorkspaceRoot } = require('../engine/team-runner');
const { HarnessAdapter } = require('../engine/harness-adapter');
const { ToolExecutor } = require('../engine/tool-executor');
const settings = require('./settings');
const harness = new HarnessAdapter();
const runner = new TeamRunner({ getState, addLog, resetTask, startTask, setRoleStatus, addWave, setWaveStatus, completeTask, ROLES }, { harness });

const sseClients = new Set();

function broadcastSSE() {
  const data = JSON.stringify(getState());
  for (const res of sseClients) {
    try { res.write(`event: update\ndata: ${data}\n\n`); } catch {}
  }
}

subscribe(broadcastSSE);

// === 多任务调度器 ===
// 状态机为单实例：同一时刻只跑一个任务；新任务在忙碌时入队（P0 插队），
// 当前任务进入终态（COMPLETED/FAILED）后自动接续队首任务。

/** 按复杂度给排队任务生成默认波次计划（单波次；Verifier 由评估结论自动选择） */
function defaultWavePlan(task) {
  const roles = task.complexity === 'complex'
    ? ['guangtouqiang', 'xionger']   // 复杂：先架构后开发（同一波次并发，共享工作区）
    : ['xionger'];
  return [{ roles, task: task.requirement || task.title || '' }];
}

/** 以 autoExecute 全自动模式启动一个任务（含默认波次与派发） */
function startAutoTask(info) {
  runner.startTask(info);                       // 内部完成复杂度评估与工作区创建
  runner.startDrafting(defaultWavePlan(runner.currentTask));
  runner.completeDrafting();
  runner.dispatchWave(0, null);                  // 使用 startDrafting 写入的波次
}

function runnerBusy() {
  return !['IDLE', 'COMPLETED', 'FAILED'].includes(runner.currentState);
}

let advanceTimer = null;
/** 终态自动接续：防抖处理，避免与 reset 竞态 */
function scheduleAdvance() {
  if (advanceTimer) return;
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    if (runnerBusy()) return;                    // 已有新任务在跑（含外部手动启动）
    const next = dequeueTask();
    if (!next) return;
    addLog('info', `接续排队任务：${next.title || next.requirement || '未命名任务'}`, 'xiongda');
    try {
      const { priority, status, queuedAt, ...taskInfo } = next;
      startAutoTask({ ...taskInfo, autoExecute: taskInfo.autoExecute !== false });
    } catch (e) {
      addLog('error', `接续任务失败：${e.message}`, 'xiongda');
      scheduleAdvance();                         // 跳过坏任务，尝试下一个
    }
  }, 400);
}

// 监听状态变化：任务到达终态 → 自动接续队首
subscribe(() => {
  const st = runner.currentState;
  if ((st === 'COMPLETED' || st === 'FAILED')) scheduleAdvance();
});

/** 入口：忙则入队，闲则立即启动 */
function startOrQueue(info, priority) {
  if (runnerBusy()) {
    const entry = enqueueTask(info, priority || 'P1');
    return { queued: true, position: getState().taskQueue.findIndex(q => q === entry || (q.queuedAt === entry.queuedAt && q.title === entry.title)) + 1, entry };
  }
  startAutoTask(info);
  return { queued: false, state: runner.currentState };
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/' || p === '/dashboard') {
    try {
      const html = fs.readFileSync(DASHBOARD, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      sendJson(res, 404, { error: 'dashboard.html not found', path: DASHBOARD, detail: e.message });
    }
    return;
  }

  // 静态文件（图片等）
  if (req.method === 'GET' && !p.startsWith('/api') && !p.startsWith('/events')) {
    const relPath = decodeURIComponent(p.replace(/^\//, ''));
    const filePath = path.join(ROOT, relPath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.css': 'text/css',
      '.js': 'text/javascript', '.ico': 'image/x-icon',
    };
    if (types[ext] && fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'max-age=3600' });
        res.end(data);
        return;
      } catch {}
    }
  }

  // SSE 端点
  if (p === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: init\ndata: ${JSON.stringify(getState())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (p === '/api/state' && req.method === 'GET') { sendJson(res, 200, getState()); return; }
  if (p === '/api/harness/status' && req.method === 'GET') { sendJson(res, 200, harness.engineStatus); return; }

  // 用户设置：看板内配置 API Key / 模型（持久化到用户数据目录，保存即热更新 harness）
  if (p === '/api/settings' && req.method === 'GET') {
    const saved = settings.loadUserSettings();
    sendJson(res, 200, { saved, harness: harness.engineStatus });
    return;
  }
  if (p === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const next = {};
    if (typeof body.api_key === 'string') {
      next.api_key = String(body.api_key).trim().replace(/^sk-/, '') ? String(body.api_key).trim() : '';
      next.api_key = next.api_key || '';
    }
    if (typeof body.model === 'string' && body.model.trim()) next.model = String(body.model).trim();
    if (typeof body.allow_commands === 'boolean') next.allow_commands = body.allow_commands;
    // 工作区根目录：绝对路径生效，空串/相对路径回退默认（新任务生效）
    if (typeof body.workspace_root === 'string') {
      const root = body.workspace_root.trim();
      if (root && path.isAbsolute(root)) {
        try {
          fs.mkdirSync(root, { recursive: true });
          next.workspace_root = root;
        } catch (e) { sendJson(res, 400, { error: `目录不可创建：${e.message}` }); return; }
      } else {
        next.workspace_root = ''; // 显式清空 = 恢复默认目录
      }
    }
    settings.saveUserSettings(next);
    harness.applyUserSettings();
    sendJson(res, 200, { ok: true, harness: harness.engineStatus });
    return;
  }
  if (p === '/api/roles' && req.method === 'GET') { sendJson(res, 200, ROLES); return; }
  if (p === '/api/logs' && req.method === 'GET') { sendJson(res, 200, getState().logs); return; }

  if (p === '/api/task/start' && req.method === 'POST') {
    const body = await readBody(req);
    startTask(body);
    sendJson(res, 200, { ok: true, message: 'Task started' });
    return;
  }

  if (p === '/api/task/complete' && req.method === 'POST') {
    const body = await readBody(req);
    completeTask(body.result);
    sendJson(res, 200, { ok: true, message: 'Task completed' });
    return;
  }

  if (p === '/api/reset' && req.method === 'POST') {
    resetTask();
    sendJson(res, 200, { ok: true, message: 'Reset' });
    return;
  }

  if (p === '/api/role/status' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.roleId || !body.status) {
      sendJson(res, 400, { error: 'Missing roleId or status' });
      return;
    }
    setRoleStatus(body.roleId, body.status, body.task);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (p === '/api/wave/add' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.roles) {
      sendJson(res, 400, { error: 'Missing roles' });
      return;
    }
    addWave(body);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (p === '/api/wave/status' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.waveIndex === undefined || !body.status) {
      sendJson(res, 400, { error: 'Missing waveIndex or status' });
      return;
    }
    setWaveStatus(body.waveIndex, body.status);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (p === '/api/log' && req.method === 'POST') {
    const body = await readBody(req);
    addLog(body.level || 'info', body.message, body.roleId);
    sendJson(res, 200, { ok: true });
    return;
  }

  // === 状态机 API ===
  if (p === '/api/sm/start' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      if (body.autoExecute !== false) {
        // 全自动模式：忙碌时自动入队（支持 P0/P1/P2 优先级），闲时直接启动并派发默认波次
        const r = startOrQueue(body, body.priority);
        sendJson(res, 200, { ok: true, ...r });
      } else {
        runner.startTask(body); // 手动演示模式，保持原有逐步 API 语义
        sendJson(res, 200, { ok: true, state: runner.currentState });
      }
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  // 任务队列
  if (p === '/api/sm/queue' && req.method === 'GET') {
    sendJson(res, 200, { queue: getState().taskQueue, busy: runnerBusy(), current: runner.currentState });
    return;
  }
  if (p === '/api/sm/queue/cancel' && req.method === 'POST') {
    const body = await readBody(req);
    const q = getState().taskQueue;
    const idx = Number(body.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.length) {
      sendJson(res, 400, { error: 'index 越界' });
      return;
    }
    const removed = removeQueuedTask(idx);
    addLog('info', `已取消排队任务：${removed.title || '未命名任务'}`, 'xiongda');
    sendJson(res, 200, { ok: true, removed: removed.title || removed.requirement || '' });
    return;
  }

  if (p === '/api/sm/draft' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.startDrafting(body.waves || null);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/complete-draft' && req.method === 'POST') {
    try {
      runner.completeDrafting();
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/dispatch' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.dispatchWave(body.waveIndex, body.waveData);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/complete-worker' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.completeWorker(body.roleId, body.result);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/verify' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.startVerification(body.verifierId);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/complete-verify' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.completeVerification(body.passed, body.issues || []);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/complete-iteration' && req.method === 'POST') {
    try {
      runner.completeIteration();
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/deliver' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      runner.deliver(body.result);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  if (p === '/api/sm/snapshot' && req.method === 'GET') {
    sendJson(res, 200, runner.getSnapshot());
    return;
  }

  if (p === '/api/sm/reset' && req.method === 'POST') {
    runner.reset();
    // 手动重置同时清空排队任务（避免历史队列在重启后"复活"造成意外执行）
    while (removeQueuedTask(0)) {}
    addLog('info', '已重置当前任务与任务队列', 'xiongda');
    sendJson(res, 200, { ok: true, state: 'IDLE' });
    return;
  }

  // 工作区产物查看（工具层）：仅限当前任务工作区，路径禁闭防越界
  if (p === '/api/workspace/list' && req.method === 'GET') {
    const ws = runner.currentTask?.workspace;
    if (!ws) { sendJson(res, 404, { error: '当前任务无工作区' }); return; }
    try {
      const ex = new ToolExecutor(ws);
      sendJson(res, 200, { workspace: ws, files: ex.listDir('.') });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }
  if (p === '/api/workspace/file' && req.method === 'GET') {
    const ws = runner.currentTask?.workspace;
    const rel = url.searchParams.get('path') || '';
    if (!ws) { sendJson(res, 404, { error: '当前任务无工作区' }); return; }
    const ex = new ToolExecutor(ws);
    try { sendJson(res, 200, { path: rel, content: ex.readFile(rel) }); }
    catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  // 在系统资源管理器中打开工作区（当前任务工作区优先，无任务时打开根目录）
  if (p === '/api/workspace/open' && req.method === 'POST') {
    const ws = (runner.currentTask?.workspace && fs.existsSync(runner.currentTask.workspace))
      ? runner.currentTask.workspace
      : getWorkspaceRoot();
    try { fs.mkdirSync(ws, { recursive: true }); } catch { /* 已存在 */ }
    const opener = process.platform === 'win32' ? 'explorer'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      const { spawn } = require('child_process');
      spawn(opener, [ws], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      sendJson(res, 200, { ok: true, path: ws });
    } catch (e) { sendJson(res, 500, { error: e.message }); }
    return;
  }

  sendJson(res, 404, { error: 'Not found', path: p });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  熊出没集团 · 纸片人工作看板服务器`);
  console.log(`  ────────────────────────────────`);
  console.log(`  看板地址:  http://localhost:${PORT}`);
  console.log(`  SSE 通道:  http://localhost:${PORT}/events`);
  console.log(`  API 基址:  http://localhost:${PORT}/api`);
  console.log(`  Harness:   ${harness.engineStatus.configured ? `DeepSeek API（${harness.config.model}）已配置` : 'mock 演示模式（未配置 API Key，发真实请求请配置 config/harness-config.json 或环境变量 DEEPSEEK_API_KEY）'}`);
  console.log(`\n  等待连接...\n`);
});
