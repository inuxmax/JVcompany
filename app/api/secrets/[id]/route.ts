import { deleteSecret, rotateSecret, updateSecret } from '@/lib/server/secrets';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** { value } = xoay vòng (phiên bản mới); { description } / { status: 'active' | 'disabled' } = sửa. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ value?: string; description?: string; status?: 'active' | 'disabled' }>(req);
  try {
    const s = body.value ? await rotateSecret(id, body.value) : await updateSecret(id, body);
    return s ? ok(s) : fail(m('Không tìm thấy bí mật'), 404);
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteSecret(id);
  return ok({ ok: true });
});
