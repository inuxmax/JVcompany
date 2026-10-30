// Cầu nối an toàn giữa giao diện web và Electron (hộp thoại chọn thư mục gốc của hệ điều hành…).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jvcompany', {
  isDesktop: true,
  platform: process.platform,
  pickFolder: (defaultPath) => ipcRenderer.invoke('jv:pick-folder', defaultPath),
  openExternal: (url) => ipcRenderer.invoke('jv:open-external', url),
  revealPath: (p) => ipcRenderer.invoke('jv:reveal', p),
});
