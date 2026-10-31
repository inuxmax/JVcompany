#!/usr/bin/env node
// create-jvcompany: tạo một bản JVCompany mới bằng một lệnh – tải mã nguồn từ GitHub, cài gói, tạo .env.local,
// kiểm tra MongoDB (gợi ý / chạy MongoDB bằng Docker), rồi chạy app và mở trình duyệt.
//
//   npx create-jvcompany@latest [thư mục] [--yes] [--no-install] [--no-start] [--ref <nhánh|tag>] [--mongodb-uri <uri>] [--db <tên>]
//
// Chỉ dùng module có sẵn của Node.js (không phụ thuộc gói nào) để npx tải và chạy nhanh.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'inuxmax/JVcompany';
const PORT = 2501;
const APP_URL = `http://127.0.0.1:${PORT}`;
const DOCKER_MONGO = ['run', '-d', '--name', 'jvcompany-mongo', '-p', '27017:27017', '-v', 'jvcompany-mongo:/data/db', 'mongo:8'];
const WIN = process.platform === 'win32';
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// ---------------- Màu & in ra ----------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const accent = paint('38;5;173');

const log = (s = '') => console.log(s);
const step = (s) => log(`${accent('›')} ${s}`);
const ok = (s) => log(`${green('✔')} ${s}`);
const warn = (s) => log(`${yellow('!')} ${s}`);

class CliError extends Error {}
const fail = (msg) => {
  throw new CliError(msg);
};

const HELP = `
${bold('create-jvcompany')} ${dim(`v${VERSION}`)} – create a new JVCompany (AI agent software company in a 3D office)

${bold('Usage')}
  npx create-jvcompany@latest ${dim('[directory] [options]')}

${bold('Options')}
  -y, --yes             Use defaults, ask nothing
  --no-install          Download only, skip npm install
  --no-start            Don't start the app at the end
  --start               Start the app at the end without asking
  --ref <branch|tag>    Git branch or tag to download ${dim('(default: main)')}
  --mongodb-uri <uri>   MongoDB connection string ${dim('(default: mongodb://127.0.0.1:27017)')}
  --db <name>           Database name ${dim('(default: jvcompany)')}
  -v, --version         Print the version
  -h, --help            Show this help

${bold('Docs')} https://github.com/${REPO}#readme
`;

// ---------------- Tham số dòng lệnh ----------------

function parseArgs(argv) {
  const o = { dir: null, yes: false, install: true, start: null, ref: 'main', mongoUri: null, db: null, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    const value = () => {
      const v = inline ?? argv[++i];
      if (!v || v.startsWith('-')) fail(`Missing value for ${a}`);
      return v;
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-y' || a === '--yes') o.yes = true;
    else if (a === '--no-install') o.install = false;
    else if (a === '--no-start') o.start = false;
    else if (a === '--start') o.start = true;
    else if (a === '--ref' || a === '--branch') o.ref = value();
    else if (a === '--mongodb-uri') o.mongoUri = value();
    else if (a === '--db') o.db = value();
    else if (a.startsWith('-')) fail(`Unknown option ${a} (see --help)`);
    else if (!o.dir) o.dir = a;
    else fail(`Unexpected argument ${a} (see --help)`);
  }
  return o;
}

// ---------------- Hỏi người dùng ----------------

let rl = null;
let interactive = false;

async function ask(question, def = '') {
  if (!interactive) return def;
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${accent('?')} ${question}${def ? dim(` (${def})`) : ''} `)).trim();
  return answer || def;
}

async function confirm(question, def = true) {
  if (!interactive) return def;
  const answer = (await ask(`${question} ${dim(def ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
  return answer ? answer.startsWith('y') : def;
}

function closePrompt() {
  rl?.close();
  rl = null;
}

// ---------------- Chạy lệnh ----------------

/** Windows: npm/git… là tệp .cmd → chạy qua shell với dòng lệnh đã đặt dấu ngoặc. */
const quote = (s) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = WIN
      ? spawn([cmd, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true, ...opts })
      : spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new CliError(`${cmd} ${args.join(' ')} failed (exit code ${code})`))));
  });
}

function has(cmd) {
  const r = WIN ? spawnSync(`${cmd} --version`, { stdio: 'ignore', shell: true }) : spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Tải mã nguồn ----------------

/** git clone (giữ lịch sử để cập nhật bằng git pull); không có git thì tải tarball từ GitHub rồi giải nén bằng tar. */
async function download(ref, target) {
  if (has('git')) {
    try {
      await run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${REPO}.git`, target]);
      return 'git';
    } catch {
      warn('git clone failed – downloading the source archive instead.');
      rmSync(target, { recursive: true, force: true });
    }
  }
  const url = `https://codeload.github.com/${REPO}/tar.gz/${encodeURIComponent(ref)}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`Could not download ${url} (HTTP ${res.status})`);
  const archive = path.join(os.tmpdir(), `jvcompany-${Date.now()}.tar.gz`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));
  mkdirSync(target, { recursive: true });
  try {
    await run('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
  } finally {
    rmSync(archive, { force: true });
  }
  return 'archive';
}

// ---------------- MongoDB ----------------

/** Máy chủ đầu tiên trong chuỗi mongodb:// (mongodb+srv:// thì không kiểm tra được bằng TCP). */
function mongoHost(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?,]+)/.exec(uri);
  if (!m) return null;
  const hostPort = m[1];
  const i = hostPort.lastIndexOf(':');
  const host = i > 0 && !hostPort.endsWith(']') ? hostPort.slice(0, i) : hostPort;
  const port = i > 0 && !hostPort.endsWith(']') ? Number(hostPort.slice(i + 1)) : 27017;
  return { host: host.replace(/^\[|\]$/g, '') || '127.0.0.1', port: port || 27017 };
}

function reachable({ host, port }, ms = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(ms, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function ensureMongo(uri) {
  const target = mongoHost(uri);
  if (!target) {
    ok(`Using ${dim(uri.replace(/\/\/[^@]*@/, '//***@'))}`);
    return;
  }
  if (await reachable(target)) {
    ok(`MongoDB is running at ${target.host}:${target.port}`);
    return;
  }
  warn(`MongoDB is not reachable at ${target.host}:${target.port}.`);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(target.host) && target.port === 27017;
  if (local && has('docker') && (await confirm('Start MongoDB in Docker now?', true))) {
    closePrompt();
    try {
      // Container đã có (đang dừng) thì bật lại, chưa có thì tạo mới
      await run('docker', ['start', 'jvcompany-mongo'], { stdio: 'ignore' }).catch(() => run('docker', DOCKER_MONGO));
      for (let i = 0; i < 30 && !(await reachable(target)); i++) await sleep(1000);
      if (await reachable(target)) {
        ok('MongoDB is running in Docker (container jvcompany-mongo)');
        return;
      }
      warn('MongoDB did not answer yet – check `docker logs jvcompany-mongo`.');
      return;
    } catch {
      // Docker có sẵn nhưng không chạy được (daemon chưa bật…) – không dừng cả quá trình tạo dự án.
      warn('Could not start MongoDB in Docker – is the Docker daemon running?');
    }
  }
  log(dim('  Start MongoDB with one of these, then run the app:'));
  log(`  • Install MongoDB Community: ${accent('https://www.mongodb.com/try/download/community')}`);
  log(`  • Docker: ${accent(`docker ${DOCKER_MONGO.join(' ')}`)}`);
  log(`  • MongoDB Atlas: put your connection string in ${bold('.env.local')} (MONGODB_URI)`);
}

/** .env.local từ .env.example với chuỗi kết nối & tên CSDL đã chọn. */
function writeEnv(target, uri, db) {
  const example = path.join(target, '.env.example');
  let text = existsSync(example) ? readFileSync(example, 'utf8') : 'MONGODB_URI=\nMONGODB_DB=\n';
  text = text.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${uri}`).replace(/^MONGODB_DB=.*$/m, `MONGODB_DB=${db}`);
  writeFileSync(path.join(target, '.env.local'), text);
}

// ---------------- Chạy app ----------------

function openBrowser(url) {
  const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* không mở được trình duyệt – đường dẫn đã in ra */
  }
}

/** Đợi máy chủ dev trả lời rồi mở trình duyệt (tối đa 3 phút – lần đầu Next.js biên dịch hơi lâu). */
async function openWhenReady() {
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(APP_URL, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      if (res.status < 500) {
        openBrowser(APP_URL);
        return;
      }
    } catch {
      /* chưa sẵn sàng */
    }
    await sleep(1000);
  }
}

// ---------------- Chính ----------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return log(HELP);
  if (opts.version) return log(VERSION);
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) fail(`JVCompany needs Node.js 20 or newer (you have ${process.versions.node}).`);
  interactive = Boolean(process.stdin.isTTY) && !opts.yes;

  log();
  log(`  ${bold(accent('jv'))}  ${bold('JVCompany')} ${dim(`· create-jvcompany v${VERSION}`)}`);
  log(`      ${dim('Your software company, run by AI agents.')}`);
  log();

  const dirName = opts.dir ?? (await ask('Where should we create your company?', 'jvcompany'));
  const target = path.resolve(dirName);
  if (existsSync(target) && readdirSync(target).length) fail(`${dirName} already exists and is not empty – pick another directory.`);
  const mongoUri = opts.mongoUri ?? (await ask('MongoDB connection string', 'mongodb://127.0.0.1:27017'));
  const db = opts.db ?? (await ask('Database name', 'jvcompany'));

  log();
  step(`Downloading JVCompany (${opts.ref}) into ${bold(target)}`);
  const via = await download(opts.ref, target);
  ok(`Source downloaded${via === 'git' ? ' (git – update later with `git pull`)' : ''}`);

  writeEnv(target, mongoUri, db);
  ok(`Created ${bold('.env.local')} (database ${bold(db)})`);

  await ensureMongo(mongoUri);

  if (opts.install) {
    closePrompt();
    log();
    step(`Installing dependencies ${dim('(a few minutes the first time)')}`);
    const lock = existsSync(path.join(target, 'package-lock.json'));
    await run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: target });
    ok('Dependencies installed');
  }

  const rel = path.relative(process.cwd(), target) || '.';
  log();
  log(`${green(bold('Your AI company is ready!'))}`);
  log();
  log(`  ${dim('cd')} ${rel}`);
  if (!opts.install) log(`  npm install`);
  log(`  npm run dev        ${dim(`→ ${APP_URL}`)}`);
  log(dim('  Desktop app: npm run desktop (downloads Electron the first time)'));
  log();

  const start = opts.install && (opts.start ?? (await confirm('Start JVCompany now?', true)));
  closePrompt();
  if (!start) return;
  step(`Starting JVCompany at ${accent(APP_URL)} ${dim('(Ctrl+C to stop)')}`);
  void openWhenReady();
  await run('npm', ['run', 'dev'], { cwd: target });
}

main().catch((err) => {
  closePrompt();
  if (err?.code === 'ABORT_ERR' || err?.name === 'AbortError') process.exit(130);
  console.error(`\n${red('✖')} ${err instanceof CliError ? err.message : (err?.stack ?? err)}`);
  process.exit(1);
});
