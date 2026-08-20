/**
 * 熊出没集团 · 桌面版（Electron 壳）
 *
 * 思路：复用根目录下的零依赖 node server（state.js + engine/* + dashboard.html 看板）。
 * main 进程在 require server 前把 desktop 环境缺失的 DEEPSEEK_API_KEY 从
 * config/harness-config.json 补齐，然后加载现有 server（自监听 127.0.0.1:PORT），
 * 开一个 BrowserWindow 展示看板。前端零改动、引擎零改动，打包即"加壳"。
 *
 * 端口：固定用 3199（桌面应用专用），避免与开发态 3121 冲突。
 */
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.PORT = process.env.PORT || '3199';
// 用户设置/状态持久化到 Electron 用户数据目录（打包后可写，区别于只读的 asar 资源）
process.env.MAVIS_USER_DATA = app.getPath('userData');

// 桌面环境没有 DEEPSEEK_API_KEY 环境变量：若未设置，从配置文件读取补齐
// （优先级仍是 环境变量 > config/harness-config.json，与 engine 的读取约定一致）
// 打包后资源配置在 app.asar 内的 build-app/ 下（见 desktop/copy-assets.js）
const APP_DIR = path.join(__dirname, 'build-app');

if (!process.env.DEEPSEEK_API_KEY) {
  try {
    const cfgPath = path.join(APP_DIR, 'config', 'harness-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const key = cfg && cfg.engines && cfg.engines.deepseek && cfg.engines.deepseek.config
      ? cfg.engines.deepseek.config.api_key
      : '';
    if (key) process.env.DEEPSEEK_API_KEY = key;
  } catch {
    /* 无配置文件或解析失败 → 保持 mock 模式 */
  }
}

// 复用现有零依赖 server：加载即监听 127.0.0.1:PORT，提供看板 + 状态机 API + SSE
require(path.join(APP_DIR, 'server', 'server.js'));

const PORT = process.env.PORT;
let mainWindow = null;

function waitForServer(retries = 25, cb) {
  const net = require('net');
  const sock = net.connect({ port: Number(PORT), host: '127.0.0.1' });
  sock.on('connect', () => { sock.end(); cb(); });
  sock.on('error', () => {
    if (retries <= 0) return cb();
    setTimeout(() => waitForServer(retries - 1, cb), 300);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    title: '熊出没集团 · 纸片人工作看板',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

// 原生“选择文件夹”对话框：渲染进程通过 window.mavis.selectFolder() 调用
ipcMain.handle('select-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const res = await dialog.showOpenDialog(win, {
    title: '选择工作区目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
  return res.filePaths[0];
});

app.whenReady().then(() => {
  waitForServer(30, () => {
    createWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});