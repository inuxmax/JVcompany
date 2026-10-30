import { listActivity } from '@/lib/server/activity';
import { ok, route } from '@/lib/server/http';

/** Nhật ký hoạt động: lọc theo loại đối tượng, đối tượng, dự án, người làm, từ khoá; phân trang bằng ?before=<thời điểm>. */
export const GET = route(async (req: Request) => {
  const u = new URL(req.url);
  const p = (k: string) => u.searchParams.get(k) || undefined;
  return ok(await listActivity({ entityType: p('entityType'), entityId: p('entityId'), projectId: p('projectId'), actorType: p('actorType'), q: p('q'), before: p('before'), limit: Number(p('limit') ?? 100) }));
});
