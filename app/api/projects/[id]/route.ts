import { deleteProject, getProject, getWorkflow, listApprovals, listTasks, updateProject } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { cancelProject, switchWorkflow } from '@/lib/server/agent/orchestrator';
import { inspectProject } from '@/lib/server/fsbrowse';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Project } from '@/lib/types';

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return fail(m('Không tìm thấy dự án'), 404);
  const [workflow, tasks, approvals] = await Promise.all([
    getWorkflow(project.workflowId),
    listTasks({ projectId: id }, 1000),
    listApprovals({ projectId: id, status: 'pending' }),
  ]);
  return ok({ project, workflow, tasks, approvals });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<Partial<Project>>(req);
  const patch: Partial<Project> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === 'string') patch.description = body.description;
  if (typeof body.goal === 'string') patch.goal = body.goal;
  if (typeof body.autopilot === 'boolean') patch.autopilot = body.autopilot;
  if (body.permission && ['read', 'write', 'auto', 'full'].includes(body.permission)) patch.permission = body.permission;
  if (body.path !== undefined) {
    if (body.path) {
      const info = await inspectProject(body.path);
      if (!info.exists || !info.isDirectory) return fail(m('Thư mục không tồn tại: {path}'), 400, { path: body.path });
      patch.path = info.path;
    } else patch.path = null;
  }
  const p = await updateProject(id, patch);
  if (!p) return fail(m('Không tìm thấy dự án'), 404);
  if (typeof body.workflowId === 'string' && body.workflowId !== p.workflowId) await switchWorkflow(id, body.workflowId);
  if (Array.isArray(body.goalIds)) await updateProject(id, { goalIds: body.goalIds.map(String).slice(0, 10) });
  const changed = [...Object.keys(patch), ...(body.workflowId ? ['workflowId'] : []), ...(body.goalIds ? ['goalIds'] : [])];
  if (changed.length) await logActivity({ action: 'project.updated', entityType: 'project', entityId: id, projectId: id, summary: `Sửa dự án "${p.name}": ${changed.join(', ')}` });
  return ok(await getProject(id));
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = await getProject(id);
  await cancelProject(id);
  await deleteProject(id);
  await logActivity({ action: 'project.deleted', entityType: 'project', entityId: id, summary: `Xoá dự án "${p?.name ?? id}"` });
  return ok({ ok: true });
});
