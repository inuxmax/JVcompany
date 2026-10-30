import { listRuns, silence } from '@/lib/server/runs';
import { ok, route } from '@/lib/server/http';
import type { RunStatus } from '@/lib/types';

/** Lượt chạy của agent (lọc theo nhiệm vụ / phòng / dự án / trạng thái) kèm mức im lặng (canh chừng). */
export const GET = route(async (req: Request) => {
  const u = new URL(req.url);
  const runs = await listRuns({
    taskId: u.searchParams.get('taskId') ?? undefined,
    departmentId: u.searchParams.get('departmentId') ?? undefined,
    projectId: u.searchParams.get('projectId') ?? undefined,
    status: (u.searchParams.get('status') as RunStatus) ?? undefined,
    limit: Number(u.searchParams.get('limit') ?? 50),
  });
  const t = Date.now();
  return ok(runs.map((r) => ({ ...r, silence: silence(r, t) })));
});
