import { currentUser, deleteUser, updateUser } from '@/lib/server/auth';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { User, UserRole } from '@/lib/types';

/** Đổi vai trò / khoá / mở khoá / đặt lại mật khẩu / giới hạn công ty (chỉ Chủ sở hữu – proxy.ts đã chặn vai trò khác). */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ name?: string; role?: UserRole; status?: User['status']; companies?: string[]; password?: string }>(req);
  try {
    return ok(await updateUser(id, body, await currentUser()));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  if (me?._id === id) return fail(m('Không tự xoá tài khoản của mình.'));
  try {
    await deleteUser(id, me);
    return ok({ ok: true });
  } catch (err) {
    return failFrom(err);
  }
});
