/**
 * 复杂度评估器测试
 * 运行：node --test engine/tests/
 */
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, evaluateFromText, evaluateAuto } = require('../complexity-evaluator');

// === 结构化指标评估 ===

test('结构化：全简单 → simple + 快速通道 + 无验证', () => {
  const r = evaluate({ files: 1, modules: 1, dependency: 'none', techStacks: 1, security: 'none', crossSystem: false });
  assert.equal(r.score, 0);
  assert.equal(r.level, 'simple');
  assert.equal(r.verification.level, null);
  assert.deepEqual(r.verification.verifiers, []);
  assert.match(r.strategy, /快速通道/);
});

test('结构化：全中等 → medium + L1 吉吉国王', () => {
  const r = evaluate({ files: 3, modules: 2, dependency: 'sequential', techStacks: 2, security: 'normal', crossSystem: false });
  // crossSystem 为二元维度（false=0），五维各 50：50×0.95 = 47.5
  assert.equal(r.score, 47.5);
  assert.equal(r.level, 'medium');
  assert.equal(r.verification.level, 'level_1');
  assert.deepEqual(r.verification.verifiers, ['jiji']);
  assert.equal(r.verification.maxIterations, 1);
});

test('结构化：全复杂非安全 → complex + L2 老鳄+小狸', () => {
  const r = evaluate({ files: 8, modules: 4, dependency: 'cross', techStacks: 3, security: 'normal', crossSystem: true });
  // 30+25+15+10+7.5+5 = 92.5
  assert.equal(r.score, 92.5);
  assert.equal(r.level, 'complex');
  assert.equal(r.verification.level, 'level_2');
  assert.deepEqual(r.verification.verifiers, ['laoe', 'xiaoli']);
  assert.equal(r.verification.maxIterations, 2);
});

test('结构化：安全敏感强制升级 complex + L3 铁掌大师', () => {
  const r = evaluate({ files: 1, modules: 1, dependency: 'none', techStacks: 1, security: true, crossSystem: false });
  assert.equal(r.score, 15); // 仅安全维度贡献 15，仍强制升级
  assert.equal(r.level, 'complex');
  assert.equal(r.securitySensitive, true);
  assert.equal(r.verification.level, 'level_3');
  assert.deepEqual(r.verification.verifiers, ['tiezhang']);
  assert.equal(r.verification.maxIterations, 3);
});

test('结构化：阈值边界 65 → medium，72.5 → complex', () => {
  const m = evaluate({ files: 6, modules: 3, dependency: 'none', techStacks: 2, security: 'none', crossSystem: true });
  assert.equal(m.score, 65); // 30+25+0+5+0+5
  assert.equal(m.level, 'medium');
  const c = evaluate({ files: 6, modules: 3, dependency: 'none', techStacks: 2, security: 'normal', crossSystem: true });
  assert.equal(c.score, 72.5); // 65 + 7.5
  assert.equal(c.level, 'complex');
});

test('结构化：支持字段别名（fileCount/modules/securitySensitive）', () => {
  const r = evaluate({ fileCount: 3, moduleCount: 2, securitySensitive: false });
  assert.equal(r.score, 27.5); // 15+12.5
  assert.equal(r.level, 'simple');
  assert.equal(r.dimensions.fileCount.raw, 3);
});

// === 文本启发式评估 ===

test('文本：改文案 → simple', () => {
  assert.equal(evaluateFromText('改一下首页的文案').level, 'simple');
});

test('文本：修复错别字 → simple（不被“修复”关键词干扰）', () => {
  assert.equal(evaluateFromText('修复README里的错别字').level, 'simple');
});

test('文本：新增页面功能 → medium', () => {
  assert.equal(evaluateFromText('新增一个数据导出页面').level, 'medium');
});

test('文本：跨模块重构 → complex', () => {
  const r = evaluateFromText('重构跨模块的订单流程');
  assert.equal(r.level, 'complex');
  assert.equal(r.verification.level, 'level_2');
});

test('文本：登录认证 → 强制 complex + L3', () => {
  const r = evaluateFromText('实现用户登录认证');
  assert.equal(r.level, 'complex');
  assert.equal(r.securitySensitive, true);
  assert.equal(r.verification.level, 'level_3');
});

test('文本：英文关键词（user login auth → complex + L3）', () => {
  const r = evaluateFromText('implement user login auth');
  assert.equal(r.level, 'complex');
  assert.equal(r.verification.level, 'level_3');
});

test('文本：无关键词命中 → 默认 medium（宁可多验证）', () => {
  assert.equal(evaluateFromText('帮我处理一下那个事情').level, 'medium');
});

// === 自动分派 ===

test('evaluateAuto：字符串走文本评估，对象走指标评估', () => {
  assert.equal(evaluateAuto('改文案').basis, 'text');
  assert.equal(evaluateAuto({ files: 3 }).basis, 'metrics');
  assert.equal(evaluateAuto(undefined).basis, 'text');
});
