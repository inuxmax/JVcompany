// Tiện ích hệ điều hành: chạy tiến trình, shell, tìm lệnh trong PATH.
import os from 'os';
import path from 'path';
import fs from 'fs';
import spawn from 'cross-spawn';
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

export function osName(): string {
  if (IS_WIN) return 'Windows';
  if (IS_MAC) return 'macOS';
  return 'Linux';
}

let pwshCache: string | null | undefined;
/** PowerShell 7 (pwsh) nếu có – hỗ trợ && / ||, UTF-8 tốt hơn Windows PowerShell 5.1. */
function pwsh(): string | null {
  if (pwshCache === undefined) pwshCache = IS_WIN ? which('pwsh') : null;
  return pwshCache;
}

export function shellName(): string {
  if (!IS_WIN) return 'bash';
  return pwsh() ? 'PowerShell 7 (pwsh)' : 'Windows PowerShell 5.1 – KHÔNG hỗ trợ "&&" / "||": nối lệnh bằng ";" và kiểm tra $LASTEXITCODE';
}

/** Lệnh + tham số để chạy một câu lệnh shell. */
export function shellCommand(command: string): { cmd: string; args: string[] } {
  if (IS_WIN) {
    // Xuất UTF-8 (giữ dấu tiếng Việt) và trả đúng mã thoát của lệnh cuối (PowerShell mặc định chỉ trả 0/1)
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8',
      command,
      'if (-not $?) { if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }',
    ].join('\n');
    return {
      cmd: pwsh() ?? 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    };
  }
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  return { cmd: bash, args: ['-lc', command] };
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  maxOutput?: number;
  /** Dùng child_process gốc thay vì cross-spawn (khi tự xử lý quoting). */
  raw?: boolean;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  error?: string;
}

export function killTree(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (IS_WIN) {
      nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* đã thoát */
    }
  }
}

export function runProcess(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const max = opts.maxOutput ?? 2_000_000;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const spawner = opts.raw ? nodeSpawn : spawn;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    let child: ChildProcess;
    try {
      child = spawner(cmd, args, {
        cwd: opts.cwd,
        env,
        windowsHide: true,
        detached: !IS_WIN,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: -1, stdout, stderr, timedOut, aborted, error: String(err) });
      return;
    }
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort);
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (stdout.length < max) stdout += d;
      opts.onStdout?.(d);
    });
    child.stderr?.on('data', (d: string) => {
      if (stderr.length < max) stderr += d;
      opts.onStderr?.(d);
    });
    child.on('error', (err) => finish({ code: -1, stdout, stderr, timedOut, aborted, error: err.message }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, aborted }));
    if (child.stdin) {
      child.stdin.on('error', () => {});
      if (opts.input != null) child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export function runShell(command: string, opts: RunOptions = {}): Promise<RunResult> {
  const { cmd, args } = shellCommand(command);
  return runProcess(cmd, args, { ...opts, raw: true });
}

/** Các thư mục hay chứa CLI nhưng có thể không nằm trong PATH của tiến trình server. */
function extraBinDirs(): string[] {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin')];
  if (IS_WIN) {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appData, 'npm'), path.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin'));
    dirs.push(path.join(local, 'Programs', 'Ollama'), path.join(local, 'cursor-agent'));
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.cursor', 'bin'));
  }
  return dirs;
}

/** Tìm đường dẫn đầy đủ của một lệnh (giống `which`). */
export function which(command: string): string | null {
  if (!command) return null;
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  const exts = IS_WIN ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extraBinDirs()].filter(Boolean);
  for (const dir of dirs) {
    for (const ext of IS_WIN ? ['', ...exts] : exts) {
      const full = path.join(dir, command + ext);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) {
          if (IS_WIN && ext === '' && !path.extname(full)) continue;
          return full;
        }
      } catch {
        /* không có */
      }
    }
  }
  return null;
}

export function truncate(text: string, max = 30_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n…[đã lược ${text.length - max} ký tự]…\n\n${text.slice(-tail)}`;
}

export function appDataDir(): string {
  const dir = process.env.VANPHONG_DATA_DIR || path.join(process.cwd(), '.vanphong');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
