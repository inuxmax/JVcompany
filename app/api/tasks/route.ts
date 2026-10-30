import type { Filter } from 'mongodb';
import { listTasks } from '@/lib/server/repo';
import { ok, route } from '@/lib/server/http';
import type { Task, TaskStatus } from '@/lib/types';

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const filter: Filter<Task> = {};
  const projectId = url.searchParams.get('projectId');
  const departmentId = url.searchParams.get('departmentId');
  const status = url.searchParams.get('status');
  if (projectId) filter.projectId = projectId;
  if (departmentId) filter.departmentId = departmentId;
  if (status) filter.status = { $in: status.split(',') as TaskStatus[] };
  const limit = Number(url.searchParams.get('limit') ?? 300);
  return ok(await listTasks(filter, Math.min(2000, Math.max(1, limit))));
});
