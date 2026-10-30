// Cầu nối an toàn giữa giao diện web và Electron (hộp thoại chọn thư mục gốc của hệ điều hành…).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vanphong', {
  isDesktop: true,
  platform: process.platform,
  pickFolder: (defaultPath) => ipcRenderer.invoke('vp:pick-folder', defaultPath),
  openExternal: (url) => ipcRenderer.invoke('vp:open-external', url),
  revealPath: (p) => ipcRenderer.invoke('vp:reveal', p),
});
