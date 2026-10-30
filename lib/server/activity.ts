// Nhật ký hoạt động: mọi thay đổi quan trọng (ai làm gì, lúc nào) – chỉ thêm, không sửa.
import type { ActivityEntry } from '../types';
import { getCollections, newId, now } from './db';
import { emit } from './bus';
import type { sysMsg } from '../i18n/format';

export interface ActivityInput {
  actorType?: ActivityEntry['actorType'];
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  /** Chuỗi thường, hoặc sysMsg(key, vars) để nhật ký hiện theo ngôn ngữ người xem. */
  summary: string | ReturnType<typeof sysMsg>;
  details?: Record<string, unknown> | null;
}

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|passwd|auth|bearer|jwt|credential|private[_-]?key|cookie)/i;

/** Che giá trị nhạy cảm trong chi tiết ghi nhật ký. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v === 'string' && v ? '••••' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

/** Ghi một dòng nhật ký. Không bao giờ làm hỏng thao tác chính nếu ghi lỗi. */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    const c = await getCollections();
    // Đã bật đăng nhập → ghi tên tài khoản thay cho "Bạn"
    let userName: string | null = null;
    if ((input.actorType ?? 'user') === 'user' && !input.actorName) {
      const { actorName } = await import('./auth');
      userName = await actorName().catch(() => null);
    }
    const entry: ActivityEntry = {
      _id: newId(),
      actorType: input.actorType ?? 'user',
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? userName ?? (input.actorType === 'system' ? 'Hệ thống' : input.actorType === 'agent' ? null : 'Bạn'),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      projectId: input.projectId ?? null,
      ...(typeof input.summary === 'string' ? { summary: input.summary } : { summary: input.summary.content, summaryI18n: input.summary.i18n }),
      details: input.details ? (redact(input.details) as Record<string, unknown>) : null,
      createdAt: now(),
    };
    await c.activity.insertOne(entry);
    await emit('activity.logged', input.projectId ?? null, { id: entry._id, action: entry.action });
  } catch (err) {
    console.error('[jvcompany] Ghi nhật ký lỗi:', err);
  }
}

export async function listActivity(filter: { entityType?: string; entityId?: string; projectId?: string; actorType?: string; q?: string; before?: string; limit?: number } = {}): Promise<ActivityEntry[]> {
  const c = await getCollections();
  const q: Record<string, unknown> = {};
  if (filter.entityType) q.entityType = filter.entityType;
  if (filter.entityId) q.entityId = filter.entityId;
  if (filter.projectId) q.projectId = filter.projectId;
  if (filter.actorType) q.actorType = filter.actorType;
  if (filter.before) q.createdAt = { $lt: filter.before };
  if (filter.q) q.summary = { $regex: filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return c.activity
    .find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(500, filter.limit ?? 100))
    .toArray();
}
