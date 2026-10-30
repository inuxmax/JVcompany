import { NextResponse } from 'next/server';
import { currentUser, updateUser, verifyPassword } from '@/lib/server/auth';
import { getRootCollections } from '@/lib/server/db';
import { SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/auth-token';
import { fail, failFrom, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Đổi mật khẩu của chính mình (cần mật khẩu hiện tại); cấp lại phiên mới. */
export const POST = route(async (req: Request) => {
  const me = await currentUser();
  if (!me) return fail(m('Cần đăng nhập'), 401);
  const { current, next } = await readJson<{ current?: string; next?: string }>(req);
  const c = await getRootCollections();
  const full = await c.users.findOne({ _id: me._id });
  if (!full || !verifyPassword(current ?? '', full.passwordHash)) return fail(m('Mật khẩu hiện tại không đúng.'));
  try {
    const u = await updateUser(me._id, { password: next ?? '' }, me);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, signSession(u._id, u.tokenVersion), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400 });
    return res;
  } catch (err) {
    return failFrom(err);
  }
});
