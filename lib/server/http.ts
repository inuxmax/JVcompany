// Tiện ích cho route handler: trả JSON, bắt lỗi thống nhất.
import { NextResponse } from 'next/server';
import { interpolate, type Vars } from '@/lib/i18n/format';

export type Ctx<T extends Record<string, string> = { id: string }> = { params: Promise<T> };

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Trả lỗi. `message` là câu tiếng Việt gốc (cũng là khoá dịch, xem lib/i18n): giao diện tự dịch theo ngôn ngữ đang chọn.
 * Câu có phần thay đổi → truyền `vars`: fail('Không tìm thấy dự án {id}', 404, { id }).
 */
export function fail(message: string, status = 400, vars?: Vars) {
  if (!vars) return NextResponse.json({ error: message }, { status });
  return NextResponse.json({ error: interpolate(message, vars, 'vi'), i18n: { key: message, vars } }, { status });
}

/** Lỗi cho người dùng xem, dịch được: throw new LocalizedError('Không tìm thấy {what}', { what }, 404). */
export class LocalizedError extends Error {
  key: string;
  vars?: Vars;
  status: number;
  constructor(key: string, vars?: Vars, status = 400) {
    super(interpolate(key, vars, 'vi'));
    this.key = key;
    this.vars = vars;
    this.status = status;
  }
}

/**
 * Trả lỗi từ một exception đã bắt (khối catch trong route): LocalizedError giữ khoá dịch + biến,
 * lỗi thường trả nguyên thông điệp (giao diện vẫn dịch được nếu là câu tĩnh có trong từ điển).
 */
export function failFrom(err: unknown, status = 400) {
  if (err instanceof LocalizedError) return fail(err.key, status, err.vars ?? {});
  return fail(err instanceof Error ? err.message : String(err), status);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Bọc handler: lỗi không lường trước → 500 kèm thông điệp. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof LocalizedError) return fail(err.key, err.status, err.vars ?? {});
      console.error('[jvcompany api]', err);
      const message = err instanceof Error ? err.message : String(err);
      const db = /ECONNREFUSED|MongoServerSelectionError|connect/i.test(message);
      return db ? fail('Không kết nối được MongoDB: {message}', 503, { message }) : fail(message, 500);
    }
  };
}
