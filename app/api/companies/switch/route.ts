import { NextResponse } from 'next/server';
import { COMPANY_COOKIE, MAIN_COMPANY, getRootCollections } from '@/lib/server/db';
import { fail, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import { currentUser } from '@/lib/server/auth';

/** Chuyển sang làm việc ở một công ty khác (ghi cookie; trình duyệt tải lại trang). */
export const POST = route(async (req: Request) => {
  const { id } = await readJson<{ id?: string }>(req);
  const root = await getRootCollections();
  const target = id === MAIN_COMPANY ? { _id: MAIN_COMPANY, status: 'active' } : id ? await root.companies.findOne({ _id: id }) : null;
  if (!target) return fail(m('Không tìm thấy công ty'), 404);
  if (target.status === 'archived') return fail(m('Công ty đã lưu trữ – mở lại trước khi vào.'));
  const me = await currentUser();
  if (me?.companies.length && !me.companies.includes(target._id)) return fail(m('Tài khoản của bạn không được vào công ty này.'), 403);
  const res = NextResponse.json({ ok: true, current: target._id });
  res.cookies.set(COMPANY_COOKIE, target._id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 3600 });
  return res;
});
