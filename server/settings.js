/**
 * 熊出没集团 · 用户设置读写
 *
 * 桌面环境下无法依赖环境变量 DEEPSEEK_API_KEY，用户通过看板设置界面填写
 * API Key / 模型。配置持久化到"用户数据目录"（Electron 下为 app.getPath('userData')，
 * 纯 node 开发态为 ~/.mavis），避免写入打包后只读的 asar。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const USER_DATA_DIR = process.env.MAVIS_USER_DATA || path.join(os.homedir(), '.mavis');
const SETTINGS_FILE = path.join(USER_DATA_DIR, 'user-settings.json');

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
}

/** 读取已保存的用户设置（不存在返回空对象） */
function loadUserSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) || {};
    }
  } catch { /* 损坏则当空处理 */ }
  return {};
}

/** 保存用户设置（API Key 不落日志） */
function saveUserSettings(settings) {
  ensureDir(USER_DATA_DIR);
  const merged = { ...loadUserSettings(), ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { USER_DATA_DIR, loadUserSettings, saveUserSettings };