// Ảnh đính kèm trong hội thoại: lưu trong thư mục dữ liệu của ứng dụng (không ghi vào thư mục dự án của bạn).
// Kho dùng chung (không theo dự án) để gửi được ảnh ngay cả khi yêu cầu chưa thành dự án.
import fs from 'fs/promises';
import { mkdirSync } from 'fs';
import path from 'path';
import type { Attachment } from '../types';
import { newId } from './db';
import { appDataDir } from './platform';
import { LocalizedError } from './http';
import { m } from '../i18n';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
/** Giới hạn mỗi ảnh (Claude API nhận tối đa 5 MB/ảnh). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 6;
const ID = /^[a-f0-9]{24}$/;

export function attachmentDir(): string {
  const dir = path.join(appDataDir(), 'attachments');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function attachmentPath(a: Pick<Attachment, 'id' | 'mime'>): string {
  return path.join(attachmentDir(), `${a.id}.${EXT[a.mime] ?? 'bin'}`);
}

export async function saveAttachment(file: File): Promise<Attachment> {
  const mime = file.type;
  if (!EXT[mime]) throw new LocalizedError(m('"{name}" không phải ảnh PNG, JPG, WEBP hoặc GIF.'), { name: file.name });
  if (file.size > MAX_ATTACHMENT_BYTES) throw new LocalizedError(m('"{name}" lớn hơn 5 MB.'), { name: file.name });
  const a: Attachment = { id: newId(), name: (file.name || `anh.${EXT[mime]}`).slice(0, 120), mime, size: file.size };
  await fs.writeFile(attachmentPath(a), new Uint8Array(await file.arrayBuffer()));
  return a;
}

/** Tìm ảnh đã lưu theo id (chống truy cập ngoài thư mục). */
export async function findAttachment(id: string): Promise<{ path: string; mime: string } | null> {
  if (!ID.test(id)) return null;
  const dir = attachmentDir();
  const file = (await fs.readdir(dir)).find((f) => f.startsWith(`${id}.`));
  if (!file) return null;
  return { path: path.join(dir, file), mime: MIME[file.split('.').pop() ?? ''] ?? 'application/octet-stream' };
}

/** Chỉ giữ những ảnh có thật trên máy (dữ liệu gửi từ trình duyệt không đáng tin). */
export async function validAttachments(list: unknown): Promise<Attachment[]> {
  if (!Array.isArray(list)) return [];
  const out: Attachment[] = [];
  for (const raw of list.slice(0, MAX_ATTACHMENTS)) {
    const a = raw as Partial<Attachment>;
    if (typeof a?.id !== 'string') continue;
    const found = await findAttachment(a.id);
    if (!found) continue;
    out.push({ id: a.id, name: String(a.name ?? 'ảnh').slice(0, 120), mime: found.mime, size: Number(a.size) || 0 });
  }
  return out;
}

/** Đọc ảnh thành base64 để gửi thẳng cho model có khả năng xem ảnh. */
export async function loadImages(list: Attachment[] | undefined): Promise<{ mime: string; base64: string }[]> {
  const out: { mime: string; base64: string }[] = [];
  for (const a of list ?? []) {
    try {
      const buf = await fs.readFile(attachmentPath(a));
      if (buf.length <= MAX_ATTACHMENT_BYTES) out.push({ mime: a.mime, base64: buf.toString('base64') });
    } catch {
      /* ảnh đã bị xoá */
    }
  }
  return out;
}
