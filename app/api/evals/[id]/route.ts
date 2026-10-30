import { getCollections } from '@/lib/server/db';
import { deleteSuite, listEvalRuns, saveSuite } from '@/lib/server/evals';
import { type Ctx, fail, failFrom, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { EvalSuite } from '@/lib/types';

/** Bộ đánh giá kèm các lượt chạy gần đây. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const c = await getCollections();
  const suite = await c.evalSuites.findOne({ _id: id });
  if (!suite) return fail(m('Không tìm thấy bộ đánh giá'), 404);
  return ok({ suite, runs: await listEvalRuns(id) });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  try {
    return ok(await saveSuite(id, await readJson<Partial<EvalSuite>>(req)));
  } catch (err) {
    return failFrom(err);
  }
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteSuite(id);
  return ok({ ok: true });
});
