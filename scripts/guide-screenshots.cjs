// Chụp ảnh màn hình cho trang Hướng dẫn (/guide): mở lần lượt từng trang của app – chỉ xem, không bấm gì –
// rồi lưu ảnh JPEG 1440×900 vào public/guide/. Chạy lại bất cứ lúc nào để ảnh khớp giao diện mới nhất:
//
//   npx electron scripts/guide-screenshots.cjs                 (app đang chạy ở http://127.0.0.1:2501)
//   npx electron scripts/guide-screenshots.cjs http://127.0.0.1:3210
//
// Ảnh chụp dữ liệu thật của văn phòng bạn (tên dự án, tin nhắn…) – xem lại trước khi chia sẻ mã nguồn.
// Ảnh cho README / GitHub Pages: dựng dữ liệu demo tiếng Anh (scripts/demo-seed.cjs), chạy app trên CSDL demo với worker
// tắt rồi thêm --demo – trạng thái hệ thống hiện như khi worker đang chạy các việc demo.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:2501').replace(/\/+$/, '');
const DEMO = process.argv.includes('--demo');
const OUT = path.join(__dirname, '..', 'public', 'guide');
const W = 1440;
const H = 900;

// Hồ sơ trình duyệt riêng (không đụng tới cửa sổ app desktop đang mở)
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'jv-guide-')));

/** Danh sách ảnh: tên tệp, đường dẫn, giao diện, thời gian chờ thêm (ms). `{project}` = dự án cập nhật gần nhất. */
const SHOTS = [
  { name: 'overview', path: '/' },
  { name: 'office', path: '/office?chat={project}', wait: 9000 },
  { name: 'office-new-chat', path: '/office?floor={freeFloor}', wait: 9000 },
  { name: 'office-dark', path: '/office?chat={project}', theme: 'dark', wait: 9000 },
  { name: 'office-staff', path: '/office?view=grid' },
  { name: 'projects', path: '/projects' },
  { name: 'project-new', path: '/projects/new' },
  { name: 'project-detail', path: '/projects/{project}' },
  { name: 'tasks', path: '/tasks' },
  { name: 'inbox', path: '/inbox' },
  { name: 'approvals', path: '/approvals' },
  { name: 'providers', path: '/providers', wait: 2500 },
  { name: 'settings', path: '/settings' },
  { name: 'goals', path: '/goals' },
  { name: 'org', path: '/org' },
  { name: 'skills', path: '/skills' },
  { name: 'connections', path: '/connections' },
  { name: 'accounts', path: '/accounts' },
  { name: 'company', path: '/company' },
  { name: 'routines', path: '/routines' },
  { name: 'costs', path: '/costs' },
  { name: 'evals', path: '/evals' },
  { name: 'activity', path: '/activity' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  try {
    const r = await fetch(BASE + p);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** --demo: /api/health trả về worker đang chạy với số việc demo đang làm (CSDL demo chạy với worker tắt). */
async function fakeRunningWorker(win, projects) {
  const tasks = (await getJson('/api/tasks')) || [];
  const list = Array.isArray(tasks) ? tasks : tasks.items || [];
  const active = list.filter((t) => t.status === 'running').length || projects.length;
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*/api/health*' }] });
  dbg.on('message', async (_e, method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const body = {
      db: { ok: true, message: 'OK', uri: 'mongodb://127.0.0.1:27017', name: 'jvcompany' },
      worker: { running: true, enabled: true, activeTasks: active, startedAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
      platform: `${os.type()} ${os.release()} (${process.platform})`,
      version: '2.0.0',
    };
    await dbg
      .sendCommand('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      })
      .catch(() => {});
  });
}

/** Chờ trang hết khung "đang tải" (tối đa 25 giây). */
async function settle(win) {
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    const busy = await win.webContents
      .executeJavaScript(`Boolean(document.querySelector('.animate-jv-pulse')) || /Đang dựng toà nhà|Setting up the building/.test(document.body.innerText)`)
      .catch(() => true);
    if (!busy) return;
    await sleep(400);
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const projects = (await getJson('/api/projects')) || [];
  const floors = (await getJson('/api/floors'))?.floors || [];
  const latest = [...projects].filter((p) => !p.internal).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const freeFloor = floors.find((f) => f.enabled && !f.project)?.number ?? 2;
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  if (DEMO) await fakeRunningWorker(win, projects);
  await win.loadURL(BASE + '/');
  for (const s of SHOTS) {
    if (s.path.includes('{project}') && !latest) {
      console.log(`- bỏ qua ${s.name} (chưa có dự án)`);
      continue;
    }
    const url = BASE + s.path.replace('{project}', latest?._id ?? '').replace('{freeFloor}', String(freeFloor));
    await win.webContents.executeJavaScript(
      `localStorage.setItem('jv-theme', '${s.theme || 'light'}'); localStorage.setItem('jv-nav', 'open'); localStorage.removeItem('jv.chatThread'); true`,
    );
    await win.loadURL(url);
    await settle(win);
    await sleep(s.wait ?? 1800);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${s.name}.jpg`), img.resize({ width: W }).toJPEG(82));
    console.log(`✓ ${s.name}  ${url.replace(BASE, '')}`);
  }
  app.quit();
});
