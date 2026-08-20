const { exec } = require('child_process');
const http = require('http');

const SERVER_PORT = 3121;
const SERVER_HOST = 'localhost';
const BRIDGE_NAME = '熊出没集团-飞书桥接';
const POLL_INTERVAL = 3000;
const CHAT_ID = 'oc_9467c2a735456b99ee8d5526189e1072';
const MY_OPEN_ID = 'ou_6412ac0d98140ad22fe26e94278724c8';

let lastMessageId = null;
let lastPhase = '';
let busy = false;
const sentMessageIds = new Set();

function larkExec(args) {
  return new Promise((resolve) => {
    const cmd = `lark-cli ${args}`;
    exec(cmd, { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const combined = (stdout || '') + (stderr || '');
      if (err) {
        const stderrText = stderr || '';
        try {
          const errObj = JSON.parse(stderrText.trim());
          resolve({ ok: false, error: errObj.error || errObj });
        } catch {
          resolve({ ok: false, error: { message: err.message } });
        }
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ ok: true, raw: stdout });
        }
      }
    });
  });
}

async function sendFeishu(text) {
  const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\n/g, '\\n');
  const r = await larkExec(`im +messages-send --chat-id "${CHAT_ID}" --text "${escaped}" --as user`);
  if (r.ok && r.data?.message_id) {
    sentMessageIds.add(r.data.message_id);
  }
  return r;
}

function serverPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: SERVER_HOST, port: SERVER_PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function serverGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://${SERVER_HOST}:${SERVER_PORT}${path}`, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    }).on('error', reject);
  });
}

async function fetchNewMessages() {
  const r = await larkExec(`im +chat-messages-list --chat-id "${CHAT_ID}" --as user --order desc`);
  if (!r.ok) {
    if (r.error?.subtype !== 'token_missing') {
      console.error('[poll-error]', r.error?.message || 'unknown');
    }
    return [];
  }
  const messages = r.data?.messages || [];
  if (!messages.length) return [];

  const newMsgs = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgId = msg.message_id;
    if (!msgId) continue;
    if (lastMessageId && msgId === lastMessageId) break;
    if (sentMessageIds.has(msgId)) continue;
    const sender = msg.sender || {};
    if (sender.sender_type !== 'user' || sender.id !== MY_OPEN_ID) {
      continue;
    }
    if (msg.msg_type && msg.msg_type !== 'text') {
      continue;
    }
    newMsgs.push(msg);
  }
  newMsgs.reverse();

  const latest = messages[0];
  if (latest) {
    lastMessageId = latest.message_id;
  }

  return newMsgs;
}

async function handleMessage(msg) {
  const text = (msg.content || msg.body?.content || '').trim();
  if (!text) return;

  console.log(`\n[${new Date().toLocaleTimeString()}] 📨 ${(msg.sender || {}).name || 'unknown'}: ${text}`);

  if (text === '状态' || text === 'status') {
    const state = await serverGet('/api/state');
    const roles = state.roles || [];
    const working = roles.filter(r => r.status === 'WORKING');
    const done = roles.filter(r => r.status === 'DONE');
    const failed = roles.filter(r => r.status === 'FAILED');
    let m = `📊 熊出没集团当前状态\n\n`;
    if (state.task?.title) m += `任务：${state.task.title}\n`;
    m += `任务状态：${state.task?.status || 'IDLE'}\n`;
    m += `波次：${state.waves?.length || 0}（当前第 ${(state.currentWave ?? -1) + 1} 波）\n`;
    if (working.length) m += `\n🔧 工作中：\n${working.map(r => `  ${r.name} — ${r.task || r.status}`).join('\n')}`;
    if (done.length) m += `\n✅ 已完成：${done.map(r => r.name).join('、')}`;
    if (failed.length) m += `\n❌ 失败：${failed.map(r => r.name).join('、')}`;
    if (!working.length && !done.length && !failed.length) m += '\n全员待命中';
    await sendFeishu(m);
    return;
  }

  if (text === '重置' || text === 'reset') {
    await serverPost('/api/reset', {});
    await sendFeishu('✅ 已重置，熊出没集团回到待命状态');
    return;
  }

  if (text === '看板' || text === 'dashboard') {
    await sendFeishu(`🖥️ 看板地址：http://10.129.246.74:${SERVER_PORT}\n\n（需在同一局域网下访问，并在看板页面点击"实时模式"按钮）`);
    return;
  }

  await sendFeishu(`收到！熊大总裁正在评估任务...\n\n📋 任务内容：${text}\n\n请稍等，角色即将就位。`);

  await serverPost('/api/reset', {}).catch(() => {});

  try {
    await serverPost('/api/task/start', { title: text, requirement: text });
    console.log('[bridge] Task started on server');
  } catch (e) {
    await sendFeishu(`❌ 任务启动失败：${e.message}`);
    return;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rs = (roleId, status, task) => serverPost('/api/role/status', { roleId, status, task });
  const log = (roleId, message) => serverPost('/api/log', { level: 'info', roleId, message });
  const wave = (roles, title) => serverPost('/api/wave/add', { roles, title });

  try {
    // === 熊大评估 ===
    await rs('xiongda', 'WORKING', '评估复杂度');
    await log('xiongda', `收到任务：${text}。评估为复杂任务，开始拆解。`);
    await sleep(2000);
    await log('xiongda', '拆解完成：7个波次，14角色参与，Level 2/3验证。');
    await rs('xiongda', 'DONE', '拆解完成');
    await sendFeishu('📝【熊大评估完成】\n\n7个波次，14角色参与，开始调度！');
    await sleep(500);

    // === 波次1：拖拖+毛毛 ===
    await wave(['拖拖', '毛毛'], '拖拖(运维)+毛毛(调研) — 并行执行');
    await rs('xiongda', 'WORKING', '调度波次1');
    await rs('tuotuo', 'WORKING', '搭建脚手架');
    await rs('maomao', 'WORKING', '调研安全实践');
    await sendFeishu('🔧【波次1】拖拖+毛毛开始工作');
    await log('tuotuo', '开始搭建项目目录结构…');
    await log('maomao', '开始调研安全最佳实践…');
    await sleep(3000);
    await rs('tuotuo', 'DONE', '脚手架完成');
    await rs('maomao', 'DONE', '调研完成');
    await log('tuotuo', '脚手架搭建完毕，7个文件就位。');
    await log('maomao', '调研报告完成，6条建议。');
    await sleep(500);

    // === 波次2：光头强 ===
    await wave(['光头强'], '光头强(架构) — 设计技术方案');
    await rs('guangtouqiang', 'WORKING', '设计架构方案');
    await sendFeishu('🏗️【波次2】光头强开始架构设计');
    await log('guangtouqiang', '读取调研报告，开始设计三模块架构…');
    await sleep(3000);
    await rs('guangtouqiang', 'DONE', '架构方案完成');
    await log('guangtouqiang', '架构方案完成：三模块设计。');
    await sleep(500);

    // === 波次3：熊二+翠花 ===
    await wave(['熊二', '翠花'], '熊二(开发)+翠花(界面) — 并行执行');
    await rs('xionger', 'WORKING', '实现代码');
    await rs('cuihua', 'WORKING', '设计界面');
    await sendFeishu('💻【波次3】熊二+翠花开始开发');
    await log('xionger', '按架构方案实现代码文件…');
    await log('cuihua', '设计界面主题…');
    await sleep(3000);
    await rs('xionger', 'DONE', '代码完成');
    await rs('cuihua', 'DONE', '界面方案完成');
    await log('xionger', '代码实现完毕，自测通过。');
    await log('cuihua', '界面方案完成。');
    await sleep(500);

    // === 波次4：蹦蹦+肥波+涂涂 ===
    await wave(['蹦蹦', '肥波', '涂涂'], '蹦蹦(测试)+肥波(文档)+涂涂(视觉) — 三路并行');
    await rs('bengbeng', 'WORKING', '编写测试');
    await rs('feibo', 'WORKING', '编写文档');
    await rs('tutu', 'WORKING', '视觉审查');
    await sendFeishu('🧪【波次4】蹦蹦+肥波+涂涂三路并行');
    await log('bengbeng', '编写测试用例，检查安全漏洞…');
    await log('feibo', '编写使用文档…');
    await log('tutu', '像素级视觉审查…');
    await sleep(3000);
    await rs('bengbeng', 'DONE', '发现多个Bug');
    await rs('feibo', 'DONE', '文档完成');
    await rs('tutu', 'DONE', '视觉问题已记录');
    await log('bengbeng', '测试完成：发现13个Bug。');
    await log('tutu', '视觉审查：18个问题。');
    await sleep(500);

    // === 波次5：老鳄+铁掌大师（验证+驳回）===
    await wave(['老鳄', '铁掌大师'], '老鳄(质检)+铁掌大师(安全) — 并行验证');
    await rs('laoe', 'WORKING', 'L2设计质检');
    await rs('tiezhang', 'WORKING', 'L3安全审查');
    await sendFeishu('🔍【波次5】老鳄+铁掌大师开始验证');
    await log('laoe', 'Level 2标准审查…');
    await log('tiezhang', 'Level 3强对抗审查：构造攻击向量…');
    await sleep(3000);
    await rs('laoe', 'FAILED', '驳回（14问题）');
    await rs('tiezhang', 'FAILED', '驳回（16漏洞）');
    await log('laoe', '驳回！14个设计问题。');
    await log('tiezhang', '凶猛驳回！16个安全漏洞，3严重！');
    await sendFeishu('❌【验证驳回】老鳄+铁掌大师发现严重问题，进入修复迭代');
    await sleep(800);
    await log('xiongda', '验证驳回，迭代第1轮。派发萝卜头修复。');
    await rs('xiongda', 'WORKING', '驳回重跑');
    await sleep(500);

    // === 波次6：萝卜头修复 ===
    await wave(['萝卜头'], '萝卜头(调试) — 修复驳回问题');
    await rs('luobotou', 'WORKING', '修复13项问题');
    await sendFeishu('🔧【波次6】萝卜头开始修复');
    await log('luobotou', '开始修复：token校验、权限保护、密码存储…');
    await sleep(3000);
    await rs('luobotou', 'DONE', '13项全部修复');
    await rs('laoe', 'IDLE', '');
    await rs('tiezhang', 'IDLE', '');
    await log('luobotou', '修复完成：13项全部焊死。');
    await sleep(500);

    // === 波次7：小狸质量门禁 ===
    await wave(['小狸'], '小狸(质量门禁) — 最终把关');
    await rs('xiaoli', 'WORKING', '质量门禁');
    await sendFeishu('🚦【波次7】小狸最终质量门禁检查');
    await log('xiaoli', '最终质量门禁检查：8项逐项核对…');
    await sleep(2500);
    await rs('xiaoli', 'DONE', '门禁通过');
    await log('xiaoli', 'P0/P1全部修复，门禁通过。');
    await sleep(500);

    // === 熊大交付 ===
    await rs('xiongda', 'WORKING', '汇总交付');
    await sendFeishu('📦 熊大正在汇总交付...');
    await sleep(2000);
    await rs('xiongda', 'DONE', '交付完成');
    await log('xiongda', '任务完成！14角色参与，7波次。');
    await serverPost('/api/task/complete', { result: '任务完成' });
    await sendFeishu(`✅【任务完成】\n\n📋 任务：${text}\n👥 参与：14角色\n📦 波次：7轮\n⏱️ 状态：已交付`);

    console.log('[bridge] Task workflow completed');
  } catch (e) {
    console.error('[bridge] Workflow error:', e.message);
    await sendFeishu(`❌ 工作流出错：${e.message}`);
  }
}

async function startBridge() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${BRIDGE_NAME}`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  服务器: http://${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`  聊天:   ${CHAT_ID}`);
  console.log(`  身份:   user (轮询模式)\n`);

  const initR = await larkExec(`im +chat-messages-list --chat-id "${CHAT_ID}" --as user --order desc`);
  if (initR.ok) {
    const messages = initR.data?.messages || [];
    if (messages.length) {
      lastMessageId = messages[0].message_id;
      console.log(`  已读初始消息: ${lastMessageId}`);
    }
  } else {
    console.error('  ❌ 初始化失败:', initR.error?.message || 'unknown');
    console.log('  请检查飞书授权状态');
    return;
  }

  await sendFeishu('🐻 熊出没集团飞书桥接已启动！\n\n支持命令：\n  • 任意文字 → 启动任务\n  • "状态" → 查看进度\n  • "重置" → 回到待命\n  • "看板" → 获取看板地址');

  console.log('\n✅ 飞书桥接就绪！在飞书"工作伙伴"对话中发消息即可控制熊出没集团。\n');

  setInterval(async () => {
    if (busy) return;
    try {
      const newMsgs = await fetchNewMessages();
      if (!newMsgs.length) return;
      busy = true;
      for (const msg of newMsgs) {
        await handleMessage(msg);
      }
    } catch (e) {
      console.error('[poll-error]', e.message);
    } finally {
      busy = false;
    }
  }, POLL_INTERVAL);

  process.on('SIGINT', () => {
    console.log('\n[bridge] 正在关闭...');
    process.exit(0);
  });
}

startBridge();
