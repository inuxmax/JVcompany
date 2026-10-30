import { listSuites, saveSuite } from '@/lib/server/evals';
import { failFrom, ok, readJson, route } from '@/lib/server/http';
import type { EvalSuite } from '@/lib/types';

/** Bộ đánh giá agent (lọc theo phòng: ?departmentId=). */
export const GET = route(async (req: Request) => ok(await listSuites(new URL(req.url).searchParams.get('departmentId') ?? undefined)));

export const POST = route(async (req: Request) => {
  try {
    return ok(await saveSuite(null, await readJson<Partial<EvalSuite>>(req)), 201);
  } catch (err) {
    return failFrom(err);
  }
});
