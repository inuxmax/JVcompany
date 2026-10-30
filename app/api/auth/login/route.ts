import { NextResponse } from 'next/server';
import { login } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/activity';
import { SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/auth-token';
import { fail, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

const attempts = new Map<string, { n: number; until: number }>();

/** Đăng nhập bằng email + mật khẩu → cookie phiên (HttpOnly). Sai 5 lần liền → khoá 5 phút. */
export const POST = route(async (req: Request) => {
  const { email, password } = await readJson<{ email?: string; password?: string }>(req);
  const key = (email ?? '').trim().toLowerCase();
  const a = attempts.get(key);
  if (a && a.until > Date.now()) return fail(m('Sai quá nhiều lần – thử lại sau ít phút.'), 429);
  const user = email && password ? await login(email, password) : null;
  if (!user) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return fail(m('Email hoặc mật khẩu không đúng.'), 401);
  }
  attempts.delete(key);
  await logActivity({ actorName: user.name, action: 'user.login', entityType: 'user', entityId: user._id, summary: `${user.name} đăng nhập` });
  const res = NextResponse.json({ ok: true, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, signSession(user._id, user.tokenVersion), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
  return res;
});
