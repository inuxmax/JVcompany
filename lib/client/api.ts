'use client';
// Gọi API phía client + fetcher cho SWR.
import { t, type Vars } from '@/lib/i18n';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // Máy chủ gửi kèm khoá dịch + biến (xem lib/server/http.ts) → hiện lỗi theo ngôn ngữ giao diện
    const body = data && typeof data === 'object' ? (data as { error?: unknown; i18n?: { key: string; vars?: Vars } }) : null;
    const msg = body?.i18n?.key ? t(body.i18n.key, body.i18n.vars) : body && 'error' in body ? t(String(body.error)) : t('Lỗi {status}', { status: res.status });
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const fetcher = <T>(url: string): Promise<T> => fetch(url, { cache: 'no-store' }).then((r) => parse<T>(r));

function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((r) => parse<T>(r));
}

export const api = {
  get: <T>(url: string) => fetcher<T>(url),
  post: <T>(url: string, body?: unknown) => send<T>('POST', url, body ?? {}),
  /** Tải tệp lên (multipart, trường "files"). */
  upload: <T>(url: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return fetch(url, { method: 'POST', body: form }).then((r) => parse<T>(r));
  },
  patch: <T>(url: string, body?: unknown) => send<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => send<T>('DELETE', url),
};

/** Cầu nối với ứng dụng desktop (Electron) nếu có. */
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  revealPath: (p: string) => Promise<void>;
}

export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { vanphong?: DesktopBridge }).vanphong ?? null) as DesktopBridge | null;
}
