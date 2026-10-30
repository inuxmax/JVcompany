// Kho bí mật: mã hoá AES-256-GCM bằng khoá cục bộ (.vanphong/secret.key); giá trị chỉ được giải mã khi chạy agent.
// Dùng trong biến môi trường của kết nối / phòng ban: TEN_BIEN=secret:KHOA_BI_MAT
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Secret, SecretVersion } from '../types';
import { getCollections, newId, now } from './db';
import { appDataDir } from './platform';
import { emit } from './bus';
import { logActivity } from './activity';
import { LocalizedError } from './http';
import { m } from '../i18n';

const KEY_FILE = () => path.join(appDataDir(), 'secret.key');
let cachedKey: Buffer | null = null;

/** Khoá mã hoá (32 byte) – tạo một lần, lưu cạnh dữ liệu ứng dụng. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const file = KEY_FILE();
  if (process.env.VANPHONG_SECRET_KEY) {
    cachedKey = crypto.createHash('sha256').update(process.env.VANPHONG_SECRET_KEY).digest();
    return cachedKey;
  }
  if (fs.existsSync(file)) {
    cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(file, cachedKey.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  }
  return cachedKey;
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export const SECRET_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Bản an toàn cho client: không có giá trị, không có bản mã. */
export function publicSecret(s: Secret): Secret {
  const { versions, ...rest } = s;
  return { ...rest, versions: (versions ?? []).map((v) => ({ ...v, cipher: '' })) };
}

export async function listSecrets(): Promise<Secret[]> {
  const c = await getCollections();
  return (await c.secrets.find().sort({ key: 1 }).toArray()).map(publicSecret);
}

export async function createSecret(key: string, value: string, description = ''): Promise<Secret> {
  const k = key.trim().toUpperCase();
  if (!SECRET_KEY_RE.test(k)) throw new LocalizedError(m('Tên bí mật chỉ gồm chữ IN HOA, số và dấu gạch dưới (vd GITHUB_TOKEN).'));
  if (!value) throw new LocalizedError(m('Nhập giá trị bí mật.'));
  const c = await getCollections();
  if (await c.secrets.findOne({ key: k })) throw new LocalizedError(m('Đã có bí mật "{key}". Dùng "Xoay vòng" để đổi giá trị.'), { key: k });
  const ts = now();
  const s: Secret = {
    _id: newId(),
    key: k,
    description: description.trim(),
    status: 'active',
    versions: [{ version: 1, cipher: encrypt(value), status: 'current', createdAt: ts }],
    currentVersion: 1,
    preview: value.length > 6 ? `••••${value.slice(-4)}` : '••••',
    lastUsedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await c.secrets.insertOne(s);
  await logActivity({ action: 'secret.created', entityType: 'secret', entityId: s._id, summary: `Thêm bí mật ${k}` });
  await emit('secret.updated', null, { id: s._id });
  return publicSecret(s);
}

/** Đổi giá trị: tạo phiên bản mới, bản cũ thành "previous". */
export async function rotateSecret(id: string, value: string): Promise<Secret | null> {
  if (!value) throw new LocalizedError(m('Nhập giá trị mới.'));
  const c = await getCollections();
  const s = await c.secrets.findOne({ _id: id });
  if (!s) return null;
  const version = s.currentVersion + 1;
  const versions: SecretVersion[] = (s.versions ?? []).map((v) => ({ ...v, status: v.status === 'current' ? 'previous' : v.status }));
  versions.push({ version, cipher: encrypt(value), status: 'current', createdAt: now() });
  await c.secrets.updateOne({ _id: id }, { $set: { versions: versions.slice(-10), currentVersion: version, preview: value.length > 6 ? `••••${value.slice(-4)}` : '••••', updatedAt: now() } });
  await logActivity({ action: 'secret.rotated', entityType: 'secret', entityId: id, summary: `Xoay vòng bí mật ${s.key} (phiên bản ${version})` });
  await emit('secret.updated', null, { id });
  return publicSecret((await c.secrets.findOne({ _id: id }))!);
}

export async function updateSecret(id: string, patch: { description?: string; status?: Secret['status'] }): Promise<Secret | null> {
  const c = await getCollections();
  await c.secrets.updateOne({ _id: id }, { $set: { ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.status ? { status: patch.status } : {}), updatedAt: now() } });
  await emit('secret.updated', null, { id });
  const s = await c.secrets.findOne({ _id: id });
  return s ? publicSecret(s) : null;
}

export async function deleteSecret(id: string): Promise<void> {
  const c = await getCollections();
  const s = await c.secrets.findOne({ _id: id });
  await c.secrets.deleteOne({ _id: id });
  if (s) await logActivity({ action: 'secret.deleted', entityType: 'secret', entityId: id, summary: `Xoá bí mật ${s.key}` });
  await emit('secret.updated', null, { id, deleted: true });
}

/**
 * Giải các tham chiếu "secret:KHOA" trong biến môi trường (chỉ khi chạy agent). Trả về môi trường đã giải
 * và danh sách giá trị để che trong nhật ký. Thiếu bí mật → báo lỗi trước khi chạy.
 */
export async function resolveSecretEnv(env: Record<string, string> | undefined, who: { taskId?: string; label: string }): Promise<{ env: Record<string, string>; values: string[] }> {
  const out: Record<string, string> = {};
  const values: string[] = [];
  if (!env) return { env: out, values };
  const c = await getCollections();
  for (const [k, raw] of Object.entries(env)) {
    const m = /^secret:([A-Z][A-Z0-9_]*)(?:@(\d+))?$/.exec(raw.trim());
    if (!m) {
      out[k] = raw;
      continue;
    }
    const s = await c.secrets.findOne({ key: m[1] });
    if (!s || s.status !== 'active') throw new LocalizedError('{label}: biến {name} cần bí mật "{secret}" nhưng kho bí mật không có (hoặc đã tắt).', { label: who.label, name: k, secret: m[1] });
    const want = m[2] ? Number(m[2]) : s.currentVersion;
    const v = (s.versions ?? []).find((x) => x.version === want);
    if (!v) throw new LocalizedError('{label}: bí mật "{secret}" không có phiên bản {version}.', { label: who.label, secret: m[1], version: want });
    const value = decrypt(v.cipher);
    out[k] = value;
    values.push(value);
    await c.secrets.updateOne({ _id: s._id }, { $set: { lastUsedAt: now() } });
    await logActivity({ actorType: 'system', action: 'secret.value.read', entityType: 'secret', entityId: s._id, summary: `${who.label} dùng bí mật ${s.key} (biến ${k})`, details: { taskId: who.taskId ?? null } });
  }
  return { env: out, values };
}

/** Che các giá trị bí mật trong chữ hiển thị (nhật ký, kết quả). */
export function maskSecrets(text: string, values: string[]): string {
  let t = text;
  for (const v of values) if (v && v.length >= 4) t = t.split(v).join('••••');
  return t;
}

/** Ghi giá trị cho bí mật theo tên: chưa có thì tạo, có rồi thì xoay vòng (phiên bản mới). */
export async function upsertSecretValue(key: string, value: string, description = ''): Promise<Secret> {
  const c = await getCollections();
  const k = key.trim().toUpperCase();
  const existing = await c.secrets.findOne({ key: k });
  if (!existing) return createSecret(k, value, description);
  return (await rotateSecret(existing._id, value))!;
}

/**
 * Giải các tham chiếu "secret:KHOA" nằm BẤT KỲ đâu trong giá trị (vd header "Bearer secret:GITHUB_TOKEN").
 * Dùng cho cấu hình kết nối dịch vụ (MCP). Trả về giá trị đã giải + danh sách giá trị bí mật để che.
 */
export async function resolveSecretRefs(map: Record<string, string> | undefined, who: { taskId?: string; label: string }): Promise<{ map: Record<string, string>; values: string[] }> {
  const out: Record<string, string> = {};
  const values: string[] = [];
  if (!map) return { map: out, values };
  const c = await getCollections();
  for (const [k, raw] of Object.entries(map)) {
    let v = String(raw);
    for (const m of Array.from(v.matchAll(/secret:([A-Z][A-Z0-9_]*)/g))) {
      const s = await c.secrets.findOne({ key: m[1] });
      if (!s || s.status !== 'active') throw new LocalizedError('{label}: "{name}" cần bí mật "{secret}" nhưng kho bí mật không có (hoặc đã tắt).', { label: who.label, name: k, secret: m[1] });
      const ver = (s.versions ?? []).find((x) => x.version === s.currentVersion);
      if (!ver) throw new LocalizedError('{label}: bí mật "{secret}" không có phiên bản hiện tại.', { label: who.label, secret: m[1] });
      const value = decrypt(ver.cipher);
      v = v.split(m[0]).join(value);
      values.push(value);
      await c.secrets.updateOne({ _id: s._id }, { $set: { lastUsedAt: now() } });
      await logActivity({ actorType: 'system', action: 'secret.value.read', entityType: 'secret', entityId: s._id, summary: `${who.label} dùng bí mật ${s.key} (${k})`, details: { taskId: who.taskId ?? null } });
    }
    out[k] = v;
  }
  return { map: out, values };
}
