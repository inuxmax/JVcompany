import type { Filter } from 'mongodb';
import { listApprovals, listDepartments, listProjects } from '@/lib/server/repo';
import { ok, route } from '@/lib/server/http';
import type { Approval, ApprovalStatus } from '@/lib/types';

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const filter: Filter<Approval> = status ? { status: status as ApprovalStatus } : {};
  const [approvals, projects, departments] = await Promise.all([listApprovals(filter, 300), listProjects(), listDepartments()]);
  return ok({
    approvals,
    projectNames: Object.fromEntries(projects.map((p) => [p._id, p.name])),
    departmentNames: Object.fromEntries(departments.map((d) => [d._id, d.name])),
  });
});
