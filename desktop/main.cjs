// Ứng dụng desktop Văn Phòng AI (Electron): tự khởi động máy chủ Next.js cục bộ và mở cửa sổ ứng dụng.
// - Chế độ phát triển (mặc định khi chưa đóng gói): chạy `next dev`.
// - Chế độ sản phẩm (`--prod` hoặc bản đã đóng gói): chạy `next start` (cần `npm run build` trước).
// - VANPHONG_URL=http://... : chỉ mở cửa sổ tới máy chủ đã chạy sẵn.
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PROD = app.isPackaged || process.argv.includes('--prod');
let server = null;
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => {
      const s2 = net.createServer();
      s2.listen(0, '127.0.0.1', () => {
        const { port } = s2.address();
        s2.close(() => resolve(port));
      });
    });
    s.listen(preferred, '127.0.0.1', () => s.close(() => resolve(preferred)));
  });
}

function waitFor(url, timeoutMs = 180_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(5000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error('Máy chủ không phản hồi'));
      else setTimeout(tick, 600);
    };
    tick();
  });
}

function loadEnvFile() {
  const env = {};
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

async function startServer() {
  if (process.env.VANPHONG_URL) return process.env.VANPHONG_URL.replace(/\/$/, '');
  const port = await freePort(Number(process.env.VANPHONG_PORT) || 3456);
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = [nextBin, PROD ? 'start' : 'dev', '-H', '127.0.0.1', '-p', String(port)];
  server = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...loadEnvFile(),
      ELECTRON_RUN_AS_NODE: '1',
      VANPHONG_DESKTOP: '1',
      // Bản dev desktop dùng thư mục build riêng để chạy song song với `npm run dev`.
      ...(PROD ? {} : { NEXT_DIST_DIR: '.next-desktop' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`));
  server.on('exit', (code) => {
    server = null;
    if (code && win && !win.isDestroyed()) {
      dialog.showErrorBox('Văn Phòng AI', `Máy chủ nội bộ đã dừng (mã ${code}). Kiểm tra MongoDB và chạy lại ứng dụng.`);
    }
  });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(url);
  return url;
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#06080d;color:#e8ecf4;font-family:'Segoe UI',system-ui,sans-serif">
<div style="text-align:center"><div style="width:64px;height:64px;margin:0 auto 18px;border-radius:18px;background:linear-gradient(135deg,#38BDF8,#6EE7B7,#E9A568);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px;color:#06080d">VP</div>
<div style="font-size:20px;font-weight:600">Văn Phòng AI</div><div style="margin-top:8px;color:#9aa4b8;font-size:13px">Đang khởi động văn phòng…</div></div></body></html>`)}`;

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#06080d',
    title: 'Văn Phòng AI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(SPLASH);
  // Liên kết ngoài mở bằng trình duyệt mặc định.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  try {
    const url = await startServer();
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(url)) {
        e.preventDefault();
        if (/^https?:\/\//i.test(target)) shell.openExternal(target);
      }
    });
    await win.loadURL(url);
    if (process.env.VANPHONG_SMOKE) {
      // Kiểm tra nhanh: xác nhận cầu nối desktop hoạt động rồi thoát.
      const bridge = await win.webContents.executeJavaScript('JSON.stringify({desktop: !!window.vanphong?.isDesktop, title: document.title})');
      console.log(`SMOKE_OK ${url} ${bridge}`);
      app.quit();
    }
  } catch (err) {
    dialog.showErrorBox('Văn Phòng AI', `Không khởi động được: ${err.message}`);
    app.quit();
  }
}

ipcMain.handle('vp:pick-folder', async (_e, defaultPath) => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Chọn thư mục dự án',
    defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('vp:open-external', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
});

ipcMain.handle('vp:reveal', async (_e, p) => {
  if (typeof p === 'string' && p) await shell.openPath(p);
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: 'Xem',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopServer() {
  if (!server || !server.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
    else server.kill('SIGTERM');
  } catch {
    /* đã dừng */
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', stopServer);
