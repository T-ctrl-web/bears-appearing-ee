const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3120;
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
  ROLES,
} = require('./state');

const { TeamRunner } = require('../engine/team-runner');
const runner = new TeamRunner({ getState, addLog, resetTask, startTask, setRoleStatus, addWave, setWaveStatus, completeTask, ROLES });

const sseClients = new Set();

function broadcastSSE() {
  const data = JSON.stringify(getState());
  for (const res of sseClients) {
    try { res.write(`event: update\ndata: ${data}\n\n`); } catch {}
  }
}

subscribe(broadcastSSE);

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
    } catch {
      sendJson(res, 404, { error: 'dashboard.html not found' });
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
      runner.startTask(body);
      sendJson(res, 200, { ok: true, state: runner.currentState });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
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
    sendJson(res, 200, { ok: true, state: 'IDLE' });
    return;
  }

  sendJson(res, 404, { error: 'Not found', path: p });
});

server.listen(PORT, () => {
  console.log(`\n  熊出没集团 · 纸片人工作看板服务器`);
  console.log(`  ────────────────────────────────`);
  console.log(`  看板地址:  http://localhost:${PORT}`);
  console.log(`  SSE 通道:  http://localhost:${PORT}/events`);
  console.log(`  API 基址:  http://localhost:${PORT}/api`);
  console.log(`\n  等待连接...\n`);
});
