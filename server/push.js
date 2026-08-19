#!/usr/bin/env node

const http = require('http');
const PORT = 3120;

function post(path, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    }).on('error', reject);
  });
}

const [,, cmd, ...args] = process.argv;

const HELP = `熊出没集团 · 状态推送 CLI

用法:
  node push.js <command> [options]

命令:
  status                        查看当前状态
  reset                         重置所有角色状态
  task <title> [complexity]     启动新任务
  complete [result]             完成当前任务
  role <roleId> <status> [task] 设置角色状态
  wave <index> <status>         设置波次状态
  log <level> <message>         添加日志

角色ID:
  xiongda       熊大（总裁）
  guangtouqiang 光头强（架构）
  xionger       熊二（开发）
  bengbeng      蹦蹦（测试）
  luobotou      萝卜头（调试）
  feibo         肥波（文档）
  cuihua        翠花（界面）
  tutu          涂涂（视觉）
  tuotuo        拖拖（运维）
  maomao        毛毛（调研）
  jiji          吉吉国王（代码质检）
  laoe          老鳄（设计质检）
  xiaoli        小狸（质量门禁）
  tiezhang      铁掌大师（安全）

状态:
  IDLE          空闲
  WORKING       执行中
  WAITING       等待验证
  DONE          完成
  FAILED        失败

示例:
  node push.js task "创建登录页面" complex
  node push.js role xiongda WORKING "评估任务复杂度"
  node push.js role guangtouqiang DONE "架构方案完成"
  node push.js complete "交付index.html"
`;

(async () => {
  try {
    switch (cmd) {
      case 'status': {
        const s = await get('/api/state');
        console.log(JSON.stringify(s, null, 2));
        break;
      }
      case 'reset': {
        const r = await post('/api/reset');
        console.log('✓ 已重置', r.message);
        break;
      }
      case 'task': {
        const title = args[0];
        const complexity = args[1] || 'medium';
        if (!title) { console.error('请提供任务标题'); process.exit(1); }
        const r = await post('/api/task/start', { title, complexity });
        console.log('✓ 任务启动:', title);
        break;
      }
      case 'complete': {
        const result = args.join(' ') || '任务完成';
        const r = await post('/api/task/complete', { result });
        console.log('✓ 任务完成:', result);
        break;
      }
      case 'role': {
        const [roleId, status, ...taskParts] = args;
        const task = taskParts.join(' ') || '';
        if (!roleId || !status) { console.error('用法: node push.js role <roleId> <status> [task]'); process.exit(1); }
        const r = await post('/api/role/status', { roleId, status, task });
        console.log(`✓ ${roleId} → ${status}${task ? ' (' + task + ')' : ''}`);
        break;
      }
      case 'wave': {
        const [index, status] = args;
        if (index === undefined || !status) { console.error('用法: node push.js wave <index> <status>'); process.exit(1); }
        const r = await post('/api/wave/status', { waveIndex: parseInt(index), status });
        console.log(`✓ 波次 ${parseInt(index) + 1} → ${status}`);
        break;
      }
      case 'log': {
        const [level, ...msgParts] = args;
        const message = msgParts.join(' ');
        if (!level || !message) { console.error('用法: node push.js log <level> <message>'); process.exit(1); }
        const r = await post('/api/log', { level, message });
        console.log(`✓ 日志 [${level}]: ${message}`);
        break;
      }
      default:
        console.log(HELP);
    }
  } catch (e) {
    console.error('✗ 错误:', e.message);
    console.error('请确认服务器已启动: cd server && node server.js');
    process.exit(1);
  }
})();
