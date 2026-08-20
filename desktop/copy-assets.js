/**
 * 熊出没集团 · 打包前资源预置脚本
 * 把 mavis 根目录下桌面应用运行时需要的资源复制到 desktop/build-app/，
 * 使 electron-builder 能把这些资源一并打进 app.asar（files 不能越出 app 目录）。
 * 使用：node copy-assets.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');      // mavis 根
const out = path.join(__dirname, 'build-app');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const items = [
  'server',   // server.js + state.js（复用看板服务）
  'engine',   // team-runner / harness-adapter /...（CommonJS，随 server require）
  'config',   // harness-config.json + team-engine.json + verification-rules.json
  'roles',    // role md（harness buildSystemPrompt 读取）
  'assets',   // 3d 角色图（dashboard 引用）
  'dashboard.html',
  '3d-preview.html',
];

for (const it of items) {
  const src = path.join(root, it);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(out, it), { recursive: true });
  }
}

console.log('staged build-app:', items.join(', '));