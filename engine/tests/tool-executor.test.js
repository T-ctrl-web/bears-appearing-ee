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

test('executeToolCall：未知工具返回错误，不抛异常', async () => {
  const ex = new ToolExecutor(mkWs());
  const r = await ex.executeToolCall('rm_rf', '{}');
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});

test('executeToolCall：参数为 JSON 字符串也能执行', async () => {
  const ex = new ToolExecutor(mkWs());
  const r = await ex.executeToolCall('write_file', JSON.stringify({ path: 'a.txt', content: 'hi' }));
  assert.equal(r.ok, true);
  assert.equal(ex.readFile('a.txt'), 'hi');
});

test('工具定义：Worker 3 个，Verifier 只读（无 write_file）', () => {
  assert.equal(WORKER_TOOLS.length, 3);
  const names = VERIFIER_TOOLS.map(t => t.function.name);
  assert.deepEqual(names.sort(), ['list_dir', 'read_file']);
});

// === P3 命令执行（白名单 node + 超时 + 开关门控） ===

test('run_command：默认关闭 → executeToolCall 返回未启用', async () => {
  const ex = new ToolExecutor(mkWs());
  const r = await ex.executeToolCall('run_command', JSON.stringify({ command: 'node x.js' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /未启用/);
});

test('run_command：node 跑工作区脚本成功，输出回传', async () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  ex.writeFile('hi.js', 'console.log("hello-from-ws")');
  const r = await ex.runCommand('node hi.js');
  assert.equal(r.exitCode, 0);
  assert.ok(r.output.includes('hello-from-ws'));
});

test('run_command：非 node 命令被白名单拒绝', () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  assert.throws(() => ex.runCommand('del /Q x'), /白名单/);
  assert.throws(() => ex.runCommand('npm install'), /白名单/);
});

test('run_command：-e 内联代码被拒绝（强制文件式）', () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  assert.throws(() => ex.runCommand('node -e "console.log(1)"'), /标志位/);
});

test('run_command：引用工作区外脚本被拒绝', () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  assert.throws(() => ex.runCommand('node ../outside.js'), /越界/);
});

test('run_command：脚本抛错 → exitCode 非零且 stderr 回传', async () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  ex.writeFile('boom.js', 'throw new Error("boom-test")');
  const r = await ex.runCommand('node boom.js');
  assert.notEqual(r.exitCode, 0);
  assert.ok(r.output.includes('boom-test'));
});

test('run_command：超时强杀（timedOut=true）', async () => {
  const ex = new ToolExecutor(mkWs(), { allowCommands: true });
  ex.writeFile('slow.js', 'setTimeout(()=>{}, 60000)');
  const r = await ex.runCommand('node slow.js', { timeout_ms: 800 });
  assert.equal(r.timedOut, true);
});

test('工具集构建：allowCommands 开启时暴露 run_command', () => {
  const { buildWorkerTools, buildVerifierTools } = require('../tool-executor');
  assert.equal(buildWorkerTools({}).length, 3);
  assert.equal(buildWorkerTools({ allowCommands: true }).length, 4);
  const vNames = buildVerifierTools({ allowCommands: true }).map(t => t.function.name).sort();
  assert.deepEqual(vNames, ['list_dir', 'read_file', 'run_command']);
});