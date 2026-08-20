/**
 * 熊出没集团 · 桌面版 preload（contextBridge 桥接）
 *
 * 在 renderer（看板）中暴露 window.mavis.selectFolder()，
 * 通过 IPC 调用 Electron 原生“选择文件夹”对话框，把所选绝对路径返回给页面，
 * 替代手动输入绝对路径。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mavis', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  isDesktop: true,
});