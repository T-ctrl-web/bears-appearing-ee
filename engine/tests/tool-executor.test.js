/**
 * 工具执行器（沙箱）测试：路径禁闭 / 读写列 / 大小上限
 * 运行：node --test engine/tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ToolExecutor, WORKER_TOOLS, VERIFIER_TOOLS } = require('../tool-executor');

function mkWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mavis-ws-'));
}

test('write/read 往返：嵌套目录自动创建', () => {
  const ex = new ToolExecutor(mkWs());
  ex.writeFile('src/lib/util.js', 'module.exports = 1;');
  assert.equal(ex.readFile('src/lib/util.js'), 'module.exports = 1;');
});

test('路径禁闭：.. 逃逸被拒绝', () => {
  const ex = new ToolExecutor(mkWs());
  assert.throws(() => ex.writeFile('../escape.txt', 'x'), /越界/);
  assert.throws(() => ex.readFile('../../etc/passwd'), /越界/);
});

test('路径禁闭：绝对路径被拒绝', () => {
  const ex = new ToolExecutor(mkWs());
  assert.throws(() => ex.writeFile(path.resolve('evil.txt'), 'x'), /绝对路径/);
});

test('路径禁闭：内部 ./ 归一化路径放行', () => {
  const ex = new ToolExecutor(mkWs());
  ex.writeFile('a/./b.txt', 'ok');
  assert.equal(ex.readFile('a/b.txt'), 'ok');
});

test('listDir：递归列出，目录带 / 后缀', () => {
  const ex = new ToolExecutor(mkWs());
  ex.writeFile('README.md', 'r');
  ex.writeFile('src/index.js', 'i');
  const files = ex.listDir('.');
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('src/'));
  assert.ok(files.includes('src/index.js'));
});

test('单文件大小上限：超 1MB 拒绝', () => {
  const ex = new ToolExecutor(mkWs());
  assert.throws(() => ex.writeFile('big.txt', 'x'.repeat(1024 * 1024 + 1)), /过大/);
});

test('executeToolCall：未知工具返回错误，不抛异常', () => {
  const ex = new ToolExecutor(mkWs());
  const r = ex.executeToolCall('rm_rf', '{}');
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});

test('executeToolCall：参数为 JSON 字符串也能执行', () => {
  const ex = new ToolExecutor(mkWs());
  const r = ex.executeToolCall('write_file', JSON.stringify({ path: 'a.txt', content: 'hi' }));
  assert.equal(r.ok, true);
  assert.equal(ex.readFile('a.txt'), 'hi');
});

test('工具定义：Worker 3 个，Verifier 只读（无 write_file）', () => {
  assert.equal(WORKER_TOOLS.length, 3);
  const names = VERIFIER_TOOLS.map(t => t.function.name);
  assert.deepEqual(names.sort(), ['list_dir', 'read_file']);
});