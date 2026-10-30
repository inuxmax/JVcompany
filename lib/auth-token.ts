// Phiên đăng nhập (dùng chung cho proxy.ts và máy chủ): mã phiên ký HMAC + "ảnh chụp" tài khoản trên đĩa.
// proxy.ts không đọc MongoDB – nó đọc tệp auth-<CSDL>.json (máy chủ ghi lại mỗi khi tài khoản thay đổi) để biết
// đã bật đăng nhập chưa, tài khoản còn hiệu lực không, vai trò là gì.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { UserRole } from './types';

export const SESSION_COOKIE = 'jv_session';
export const SESSION_DAYS = 14;

export interface AuthSnapshotUser {
  role: UserRole;
  v: number;
  status: 'active' | 'disabled';
  companies: string[];
}

export interface AuthSnapshot {
  enabled: boolean;
  users: Record<string, AuthSnapshotUser>;
}

function dataDir(): string {
  return process.env.JVCOMPANY_DATA_DIR || path.join(process.cwd(), '.jvcompany');
}

/** Tệp ảnh chụp tài khoản – tách theo CSDL để máy chủ thử nghiệm không ảnh hưởng máy chủ thật. */
export function snapshotFile(): string {
  const db = (process.env.MONGODB_DB || 'jvcompany').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(dataDir(), `auth-${db}.json`);
}

let keyCache: Buffer | null = null;
function sessionKey(): Buffer {
  if (keyCache) return keyCache;
  if (process.env.JVCOMPANY_SESSION_SECRET) return (keyCache = crypto.createHash('sha256').update(process.env.JVCOMPANY_SESSION_SECRET).digest());
  const file = path.join(dataDir(), 'session.key');
  try {
    keyCache = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (keyCache.length >= 32) return keyCache;
  } catch {
    /* chưa có */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  keyCache = crypto.randomBytes(32);
  fs.writeFileSync(file, keyCache.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return keyCache;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signSession(uid: string, v: number, days = SESSION_DAYS): string {
  const payload = b64(JSON.stringify({ uid, v, exp: Date.now() + days * 86400_000 }));
  const sig = b64(crypto.createHmac('sha256', sessionKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined | null): { uid: string; v: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64(crypto.createHmac('sha256', sessionKey()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { uid?: string; v?: number; exp?: number };
    if (!p.uid || typeof p.v !== 'number' || !p.exp || p.exp < Date.now()) return null;
    return { uid: p.uid, v: p.v };
  } catch {
    return null;
  }
}

let snapCache: { mtime: number; snap: AuthSnapshot } | null = null;

/** Đọc ảnh chụp tài khoản (đệm theo thời điểm sửa tệp). Không có tệp = chưa bật đăng nhập. */
export function readSnapshot(): AuthSnapshot {
  const file = snapshotFile();
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (snapCache && snapCache.mtime === mtime) return snapCache.snap;
    const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as AuthSnapshot;
    snapCache = { mtime, snap };
    return snap;
  } catch {
    return { enabled: false, users: {} };
  }
}

export function writeSnapshot(snap: AuthSnapshot): void {
  const file = snapshotFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  snapCache = null;
}

// ---------------- Phân quyền theo vai trò ----------------

export const ROLE_LABEL: Record<UserRole, string> = { owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên', viewer: 'Chỉ xem' };

/** Cấu hình công ty – chỉ Quản trị / Chủ sở hữu được thay đổi. */
const ADMIN_WRITE = /^\/api\/(providers|secrets|settings|connections|connectors|plugins|portability|workflows?|budgets|setup|skills|teams|company|floors|routines)(\/|$)/;
/** Đọc cũng cần quyền quản trị (xuất dữ liệu công ty). */
const ADMIN_READ = /^\/api\/(export|portability\/export)(\/|$)/;
/** Đăng nhập, đổi mật khẩu của chính mình, đánh dấu đã đọc hộp thư – vai trò nào cũng được. */
const ANY_WRITE = /^\/api\/(auth\/|inbox$)/;

/** Trả về lý do bị chặn (tiếng Việt) hoặc null nếu được phép. */
export function roleBlock(role: UserRole, method: string, pathname: string): string | null {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!pathname.startsWith('/api/')) return null;
  if (role === 'owner') return null;
  if (/^\/api\/users(\/|$)/.test(pathname) && write) return 'Chỉ Chủ sở hữu được quản lý tài khoản.';
  if (write && ANY_WRITE.test(pathname)) return null;
  if (role === 'viewer') return write ? 'Tài khoản "Chỉ xem" không thay đổi được dữ liệu.' : null;
  if (role === 'admin') return null;
  // Thành viên: làm việc hằng ngày (chat, dự án, nhiệm vụ, phê duyệt, tài liệu, đánh giá) – không đổi cấu hình công ty
  if (ADMIN_READ.test(pathname)) return 'Cần quyền Quản trị để xuất dữ liệu công ty.';
  if (!write) return null;
  if (/^\/api\/departments\/[^/]+\/wake$/.test(pathname)) return null;
  if (/^\/api\/companies\/switch$/.test(pathname)) return null;
  if (ADMIN_WRITE.test(pathname) || /^\/api\/departments(\/|$)/.test(pathname) || /^\/api\/companies(\/|$)/.test(pathname)) return 'Cần quyền Quản trị để thay đổi cấu hình công ty.';
  return null;
}

/** Đường dẫn không cần đăng nhập: trang đăng nhập + các cổng máy-gọi-máy có mã xác thực riêng. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/me' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/mcp/hook' ||
    pathname.startsWith('/api/hooks/') ||
    pathname.startsWith('/api/agent-callback/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}
