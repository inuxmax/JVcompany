// Làm sạch các trường cấu hình mở rộng của kết nối (chế độ xác thực, biến môi trường, ô riêng theo loại…).
import { getPreset } from '@/lib/catalog';
import type { Provider } from '@/lib/types';

function cleanMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim();
    if (key && typeof val === 'string') out[key] = val;
  }
  return out;
}

/**
 * Trường mở rộng từ hộp thoại kết nối. Ô bí mật: chuỗi rỗng = giữ giá trị cũ, null = xoá.
 * `existing` là bản đang lưu (khi sửa) để gộp ô bí mật.
 */
export function cleanProviderInput(body: Partial<Provider> & { secretOptions?: Record<string, string | null> }, existing?: Provider | null): Partial<Provider> {
  const out: Partial<Provider> = {};
  const type = body.type ?? existing?.type;
  const fields = type ? (getPreset(type).fields ?? []) : [];
  if (body.authMode === 'subscription' || body.authMode === 'api_key') out.authMode = body.authMode;
  if (body.env !== undefined) out.env = cleanMap(body.env) ?? {};
  if (body.headers !== undefined) out.headers = cleanMap(body.headers) ?? {};
  if (body.cwd !== undefined) out.cwd = String(body.cwd ?? '').trim();
  if (body.timeoutSec !== undefined) {
    const n = Number(body.timeoutSec);
    out.timeoutSec = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (body.options && typeof body.options === 'object') {
    const opts: Record<string, string | number | boolean> = { ...(existing?.options ?? {}) };
    for (const f of fields.filter((x) => x.type !== 'secret')) {
      if (!(f.key in body.options)) continue;
      const v = body.options[f.key];
      if (f.type === 'toggle') opts[f.key] = Boolean(v);
      else if (f.type === 'number') opts[f.key] = Number(v) || 0;
      else opts[f.key] = String(v ?? '');
    }
    out.options = opts;
  }
  if (body.secretOptions && typeof body.secretOptions === 'object') {
    const secrets: Record<string, string> = { ...(existing?.secretOptions ?? {}) };
    for (const f of fields.filter((x) => x.type === 'secret')) {
      const v = body.secretOptions[f.key];
      if (v === null) delete secrets[f.key];
      else if (typeof v === 'string' && v.trim()) secrets[f.key] = v.trim();
    }
    out.secretOptions = secrets;
  }
  return out;
}
