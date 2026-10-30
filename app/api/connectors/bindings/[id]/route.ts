import { deleteBinding, updateBinding } from '@/lib/server/telegram';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { ChatBinding } from '@/lib/types';

/** Duyệt / chặn cuộc trò chuyện, hoặc đổi dự án nhận tin. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ status?: ChatBinding['status']; projectId?: string | null }>(req);
  const b = await updateBinding(id, body);
  return b ? ok(b) : fail(m('Không tìm thấy cuộc trò chuyện'), 404);
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteBinding(id);
  return ok({ ok: true });
});
