import { startEvalRun } from '@/lib/server/evals';
import { type Ctx, failFrom, ok, readJson, route } from '@/lib/server/http';

/** Chạy bộ đánh giá (cấu hình hiện tại của phòng, hoặc kết nối / model chỉ định để so sánh). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ providerId?: string | null; model?: string | null; caseIds?: string[] }>(req);
  try {
    return ok(await startEvalRun(id, body), 201);
  } catch (err) {
    return failFrom(err);
  }
});
