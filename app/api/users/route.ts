import { NextResponse } from 'next/server';
import { authEnabled, createUser, currentUser, listUsers } from '@/lib/server/auth';
import { SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/auth-token';
import { fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { UserRole } from '@/lib/types';

/** Danh sách tài khoản (Quản trị / Chủ sở hữu xem; khi chưa bật đăng nhập ai trên máy này cũng xem được). */
export const GET = route(async () => {
  const me = await currentUser();
  if (authEnabled() && me && me.role !== 'owner' && me.role !== 'admin') return fail(m('Cần quyền Quản trị'), 403);
  return ok({ authEnabled: authEnabled(), me, users: await listUsers() });
});

/**
 * Tạo tài khoản. Chưa có tài khoản nào → tài khoản đầu tiên là Chủ sở hữu, bật đăng nhập và đăng nhập luôn.
 * Sau đó chỉ Chủ sở hữu tạo được (proxy.ts chặn vai trò khác).
 */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ email?: string; name?: string; password?: string; role?: UserRole; companies?: string[] }>(req);
  const first = !authEnabled();
  try {
    const me = await currentUser();
    const user = await createUser({ email: body.email ?? '', name: body.name ?? '', password: body.password ?? '', role: body.role, companies: body.companies }, me);
    const res = NextResponse.json(user, { status: 201 });
    if (first) res.cookies.set(SESSION_COOKIE, signSession(user._id, user.tokenVersion), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch (err) {
    return failFrom(err);
  }
});
