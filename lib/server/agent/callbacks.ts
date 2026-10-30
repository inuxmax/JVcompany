// Chờ agent bên ngoài (HTTP webhook) gọi lại kết quả qua /api/agent-callback/:runId.
import crypto from 'crypto';

export interface CallbackPayload {
  status?: 'done' | 'failed' | 'progress';
  result?: string;
  text?: string;
  summary?: string;
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

interface Waiter {
  token: string;
  onProgress: (text: string) => void;
  resolve: (p: CallbackPayload) => void;
  reject: (e: Error) => void;
}

const g = globalThis as unknown as { __vpCallbacks?: Map<string, Waiter> };
const waiters: Map<string, Waiter> = (g.__vpCallbacks ??= new Map());

export function newCallbackToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Đăng ký chờ kết quả cho một lượt chạy; tự huỷ khi hết giờ hoặc bị dừng. */
export function waitForCallback(runId: string, token: string, timeoutMs: number, signal: AbortSignal, onProgress: (text: string) => void): Promise<CallbackPayload> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      waiters.delete(runId);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Agent bên ngoài không gọi lại sau ${Math.round(timeoutMs / 60000)} phút.`));
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort);
    waiters.set(runId, {
      token,
      onProgress,
      resolve: (p) => {
        cleanup();
        resolve(p);
      },
      reject: (e) => {
        cleanup();
        reject(e);
      },
    });
  });
}

/** Nhận kết quả gọi lại. Trả về false nếu không có lượt chạy nào đang chờ hoặc sai mã. */
export function deliverCallback(runId: string, token: string, payload: CallbackPayload): 'ok' | 'not_found' | 'forbidden' {
  const w = waiters.get(runId);
  if (!w) return 'not_found';
  const a = Buffer.from(w.token);
  const b = Buffer.from(token || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'forbidden';
  if (payload.status === 'progress') {
    const t = payload.text ?? payload.summary ?? '';
    if (t) w.onProgress(t);
    return 'ok';
  }
  if (payload.status === 'failed') w.reject(new Error(payload.error || 'Agent bên ngoài báo lỗi.'));
  else w.resolve(payload);
  return 'ok';
}
