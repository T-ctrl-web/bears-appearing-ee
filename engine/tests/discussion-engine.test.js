/**
 * 自由讨论引擎测试（mock 引擎，不发真实请求）
 * 运行：node --test engine/tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DiscussionEngine } = require('../discussion-engine');

const ROLES = [
  { id: 'xiongda', name: '熊大', role: '总裁', tier: 'leader' },
  { id: 'guangtouqiang', name: '光头强', role: '架构', tier: 'worker' },
  { id: 'xionger', name: '熊二', role: '开发', tier: 'worker' },
  { id: 'jiji', name: '吉吉国王', role: '质检', tier: 'verifier' },
  { id: 'cuihua', name: '翠花', role: '界面', tier: 'worker' },
];

function makeLog() {
  const logs = [];
  return { addLog: (lv, msg, rid) => logs.push({ lv, msg, rid }), logs };
}

function makeHarness() {
  return {
    config: { engine: 'mock' },
    roleMap: {
      xiongda: { id: 'xiongda', name: '熊大', role: '总裁' },
      guangtouqiang: { id: 'guangtouqiang', name: '光头强', role: '架构', file: 'roles/workers/architect-bear.md' },
      xionger: { id: 'xionger', name: '熊二', role: '开发', file: 'roles/workers/implementer-bear.md' },
      jiji: { id: 'jiji', name: '吉吉国王', role: '质检', file: 'roles/verifiers/code-reviewer-bear.md' },
      cuihua: { id: 'cuihua', name: '翠花', role: '界面', file: 'roles/workers/ui-designer-bear.md' },
    },
    _chatCompletion: async () => ({ ok: true, content: '（不应在 mock 下调用）', duration_ms: 1 }),
  };
}

test('讨论：默认参会角色为 架构+开发+质检+界面', () => {
  const { addLog } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES });
  const meta = d.start({ topic: '要不要引入微前端？' });
  assert.equal(meta.participants.length, 4);
  assert.ok(meta.participants.includes('guangtouqiang'));
  assert.ok(meta.participants.includes('cuihua'));
  assert.equal(d.isRunning(), true);
});

test('讨论：mock 模式下完整跑完，产出转录与主持人结论', async () => {
  const { addLog, logs } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES });
  d.start({ topic: '要不要引入微前端？', maxRounds: 2 });
  await d.run();
  assert.equal(d.isRunning(), false);
  const st = d.status();
  assert.ok(st.transcript.length >= 2, '应有多条发言');
  assert.ok(st.transcript.some(m => m.summary === true), '应有主持人总结');
  assert.ok(st.transcript.some(m => m.text.includes('微前端')), '发言应引用议题');
});

test('讨论：被 stop 后及时停止，不再追加发言', async () => {
  const { addLog } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES });
  d.start({ topic: '讨论A', maxRounds: 3 });
  d.stop();
  await d.run();
  assert.equal(d.isRunning(), false);
});

test('讨论：重复 start 被拒绝', () => {
  const { addLog } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES });
  d.start({ topic: '讨论A' });
  assert.throws(() => d.start({ topic: '讨论B' }), /已有一场讨论/);
});

test('讨论：过滤不存在/重复角色，主持人不参与发言', () => {
  const { addLog } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES });
  const meta = d.start({ topic: 'T', participants: ['guangtouqiang', 'guangtouqiang', 'nonexistent', 'xiongda'] });
  // 去重且过滤不存在；xiongda（主持人）不进入 participants
  assert.deepEqual(meta.participants, ['guangtouqiang']);
});

test('讨论：记录持久化到 dataDir，history/load 可回看', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-disc-'));
  const { addLog } = makeLog();
  const d = new DiscussionEngine({ harness: makeHarness(), addLog, ROLES, dataDir: tmp });
  d.start({ topic: '持久化议题', maxRounds: 1 });
  await d.run();
  // 落盘文件存在
  const files = fs.readdirSync(path.join(tmp, 'discussions')).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 1, '应已持久化讨论记录');
  // history 列表含本场
  const hist = d.history();
  assert.ok(hist.some(h => h.topic === '持久化议题'), 'history 应包含本场');
  const top = hist[0];
  // load 能取回完整转录（含主持人总结）
  const rec = d.load(top.id);
  assert.ok(rec, 'load 应返回记录');
  assert.ok(rec.transcript.some(l => l.summary), '转录应含主持人结论');
  assert.ok(rec.transcript.length >= 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});