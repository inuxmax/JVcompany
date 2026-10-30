import { deleteConnector, publicConnector, saveConnector, testConnector } from '@/lib/server/telegram';
import { type Ctx, failFrom, ok, readJson, route } from '@/lib/server/http';
import type { ChatConnector } from '@/lib/types';

/** Sửa kênh chat; action "test" kiểm tra mã bot (getMe). */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<ChatConnector> & { token?: string; action?: string }>(req);
  try {
    if (body.action === 'test') return ok(publicConnector(await testConnector(id)));
    return ok(publicConnector(await saveConnector(id, body)));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteConnector(id);
  return ok({ ok: true });
});
