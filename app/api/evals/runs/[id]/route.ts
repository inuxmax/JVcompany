import { cancelEvalRun, deleteEvalRun } from '@/lib/server/evals';
import { type Ctx, ok, route } from '@/lib/server/http';

/** Dừng lượt đánh giá đang chạy. */
export const PATCH = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await cancelEvalRun(id);
  return ok({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteEvalRun(id);
  return ok({ ok: true });
});
