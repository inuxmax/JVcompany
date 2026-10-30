// Tài khoản & phân quyền (theo Paperclip "multi-user auth"): owner / admin / member / viewer.
// Chưa có tài khoản nào → ứng dụng chạy như trước (chỉ máy này). Tạo tài khoản đầu tiên (Chủ sở hữu) → bắt buộc đăng nhập.
import crypto from 'crypto';
import type { DocAuthor, User, UserRole } from '../types';
import { getRootCollections, newId, now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { ROLE_LABEL, readSnapshot, writeSnapshot } from '../auth-token';
import { LocalizedError } from './http';
import { m } from '../i18n';

export const ROLES: UserRole[] = ['owner', 'admin', 'member', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------- Mật khẩu ----------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

function checkPassword(p: string) {
  if (p.length < 8) throw new LocalizedError(m('Mật khẩu tối thiểu 8 ký tự.'));
}

// ---------------- Tài khoản ----------------

export function publicUser(u: User): User {
  const { passwordHash: _p, ...rest } = u;
  void _p;
  return rest;
}

export async function listUsers(): Promise<User[]> {
  const c = await getRootCollections();
  return (await c.users.find().sort({ createdAt: 1 }).toArray()).map(publicUser);
}

/** Ghi lại ảnh chụp tài khoản cho proxy.ts (bật đăng nhập khi có ít nhất một tài khoản đang hoạt động). */
export async function syncAuthSnapshot(): Promise<void> {
  const c = await getRootCollections();
  const users = await c.users.find({}, { projection: { role: 1, tokenVersion: 1, status: 1, companies: 1 } }).toArray();
  writeSnapshot({
    enabled: users.some((u) => u.status === 'active'),
    users: Object.fromEntries(users.map((u) => [u._id, { role: u.role, v: u.tokenVersion, status: u.status, companies: u.companies ?? [] }])),
  });
}

export function authEnabled(): boolean {
  return readSnapshot().enabled;
}

async function activeOwners(excludeId?: string): Promise<number> {
  const c = await getRootCollections();
  return c.users.countDocuments({ role: 'owner', status: 'active', ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
}

export async function createUser(input: { email: string; name: string; password: string; role?: UserRole; companies?: string[] }, by?: User | null): Promise<User> {
  const c = await getRootCollections();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new LocalizedError(m('Email không hợp lệ.'));
  if (!input.name.trim()) throw new LocalizedError(m('Nhập tên hiển thị.'));
  checkPassword(input.password);
  if (await c.users.findOne({ email })) throw new LocalizedError(m('Email này đã có tài khoản.'));
  const first = (await c.users.countDocuments()) === 0;
  // Tài khoản đầu tiên luôn là Chủ sở hữu (bật đăng nhập cho cả ứng dụng)
  const role: UserRole = first ? 'owner' : ROLES.includes(input.role as UserRole) ? (input.role as UserRole) : 'member';
  const ts = now();
  const user: User = {
    _id: newId(),
    email,
    name: input.name.trim().slice(0, 80),
    role,
    status: 'active',
    passwordHash: hashPassword(input.password),
    companies: first ? [] : (input.companies ?? []).map(String),
    tokenVersion: 1,
    lastLoginAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await c.users.insertOne(user);
  await syncAuthSnapshot();
  await emit('user.updated', null, { id: user._id });
  await logActivity({ actorName: by?.name, action: 'user.created', entityType: 'user', entityId: user._id, summary: `Tạo tài khoản ${user.name} (${ROLE_LABEL[role]})${first ? ' – bật đăng nhập' : ''}` });
  return publicUser(user);
}

export async function updateUser(id: string, patch: { name?: string; role?: UserRole; status?: User['status']; companies?: string[]; password?: string }, by?: User | null): Promise<User> {
  const c = await getRootCollections();
  const user = await c.users.findOne({ _id: id });
  if (!user) throw new LocalizedError(m('Không tìm thấy tài khoản'), undefined, 404);
  const set: Partial<User> = { updatedAt: now() };
  let bump = false;
  if (patch.name?.trim()) set.name = patch.name.trim().slice(0, 80);
  if (patch.role && ROLES.includes(patch.role) && patch.role !== user.role) {
    if (user.role === 'owner' && (await activeOwners(id)) === 0) throw new LocalizedError(m('Phải còn ít nhất một Chủ sở hữu.'));
    set.role = patch.role;
    bump = true;
  }
  if (patch.status && patch.status !== user.status) {
    if (patch.status === 'disabled' && user.role === 'owner' && (await activeOwners(id)) === 0) throw new LocalizedError(m('Không khoá được Chủ sở hữu cuối cùng.'));
    set.status = patch.status;
    bump = true;
  }
  if (patch.companies) {
    set.companies = patch.companies.map(String);
    bump = true;
  }
  if (patch.password) {
    checkPassword(patch.password);
    set.passwordHash = hashPassword(patch.password);
    bump = true;
  }
  // Đổi quyền / khoá / đổi mật khẩu → các phiên đăng nhập cũ hết hiệu lực
  await c.users.updateOne({ _id: id }, { $set: set, ...(bump ? { $inc: { tokenVersion: 1 } } : {}) });
  await syncAuthSnapshot();
  await emit('user.updated', null, { id });
  await logActivity({ actorName: by?.name, action: 'user.updated', entityType: 'user', entityId: id, summary: `Sửa tài khoản ${user.name}: ${Object.keys(patch).filter((k) => k !== 'password').join(', ') || ''}${patch.password ? ' (đổi mật khẩu)' : ''}` });
  return publicUser((await c.users.findOne({ _id: id }))!);
}

export async function deleteUser(id: string, by?: User | null): Promise<void> {
  const c = await getRootCollections();
  const user = await c.users.findOne({ _id: id });
  if (!user) return;
  if (user.role === 'owner' && (await activeOwners(id)) === 0) throw new LocalizedError(m('Không xoá được Chủ sở hữu cuối cùng.'));
  await c.users.deleteOne({ _id: id });
  await syncAuthSnapshot();
  await emit('user.updated', null, { id, deleted: true });
  await logActivity({ actorName: by?.name, action: 'user.deleted', entityType: 'user', entityId: id, summary: `Xoá tài khoản ${user.name}` });
}

/** Đăng nhập: trả về tài khoản nếu đúng email + mật khẩu và tài khoản đang hoạt động. */
export async function login(email: string, password: string): Promise<User | null> {
  const c = await getRootCollections();
  const user = await c.users.findOne({ email: email.trim().toLowerCase() });
  // Luôn băm để thời gian phản hồi không lộ email có tồn tại hay không
  const ok = verifyPassword(password, user?.passwordHash ?? hashPassword('khong-co-tai-khoan'));
  if (!user || !ok || user.status !== 'active') return null;
  await c.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: now() } });
  return user;
}

// ---------------- Người đang dùng (theo yêu cầu HTTP) ----------------

/** Tài khoản của yêu cầu hiện tại (proxy.ts gắn header x-vp-user sau khi xác thực phiên). null = chưa bật đăng nhập / ngoài yêu cầu. */
export async function currentUser(): Promise<User | null> {
  let uid: string | null = null;
  try {
    const { headers } = await import('next/headers');
    uid = (await headers()).get('x-vp-user');
  } catch {
    return null;
  }
  if (!uid) return null;
  const c = await getRootCollections();
  const u = await c.users.findOne({ _id: uid });
  return u ? publicUser(u) : null;
}

/** Tên người thao tác để ghi vào tin nhắn / nhật ký ("Bạn" khi chưa bật đăng nhập). */
export async function actorName(): Promise<string> {
  return (await currentUser())?.name ?? 'Bạn';
}

export async function userAuthor(): Promise<DocAuthor> {
  const u = await currentUser();
  return u ? { type: 'user', id: u._id, name: u.name } : { type: 'user', name: 'Bạn' };
}
