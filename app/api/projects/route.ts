import { createProject, getSettings, listProjects, updateProject } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { defaultCompanyGoal } from '@/lib/server/company';
import { getCollections } from '@/lib/server/db';
import { startProject } from '@/lib/server/agent/orchestrator';
import { inspectProject } from '@/lib/server/fsbrowse';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { requestLocale } from '@/lib/i18n/server';
import { m } from '@/lib/i18n';
import { sysMsg } from '@/lib/i18n/format';
import type { PermissionLevel } from '@/lib/types';

export const GET = route(async () => {
  const c = await getCollections();
  const [projects, counts] = await Promise.all([
    listProjects(),
    c.tasks
      .aggregate<{ _id: { p: string; s: string }; n: number }>([{ $group: { _id: { p: '$projectId', s: '$status' }, n: { $sum: 1 } } }])
      .toArray(),
  ]);
  const byProject: Record<string, Record<string, number>> = {};
  for (const r of counts) (byProject[r._id.p] ??= {})[r._id.s] = r.n;
  return ok(projects.map((p) => ({ ...p, taskCounts: byProject[p._id] ?? {} })));
});

export const POST = route(async (req: Request) => {
  const body = await readJson<{
    name?: string;
    description?: string;
    goal?: string;
    path?: string | null;
    autopilot?: boolean;
    permission?: PermissionLevel;
    workflowId?: string;
    start?: boolean;
    goalIds?: string[];
  }>(req);
  const settings = await getSettings();
  let path = body.path?.trim() || null;
  if (path) {
    const info = await inspectProject(path);
    if (!info.exists || !info.isDirectory) return fail('Thư mục không tồn tại: {path}', 400, { path });
    path = info.path;
  }
  const name = body.name?.trim();
  if (!name) return fail(m('Cần nhập tên dự án'));
  const project = await createProject({
    name,
    description: body.description?.trim() ?? '',
    goal: body.goal?.trim() ?? '',
    path,
    autopilot: body.autopilot ?? true,
    permission: body.permission ?? settings.defaultPermission,
    workflowId: body.workflowId,
    // Agent trả lời bằng ngôn ngữ giao diện của người tạo dự án
    language: await requestLocale(),
  });
  // Dự án gắn mục tiêu (mặc định: mục tiêu gốc của công ty)
  const goalIds = body.goalIds?.length ? body.goalIds : [(await defaultCompanyGoal())?._id].filter((x): x is string => Boolean(x));
  if (goalIds.length) await updateProject(project._id, { goalIds });
  await logActivity({ action: 'project.created', entityType: 'project', entityId: project._id, projectId: project._id, summary: sysMsg('Tạo dự án "{name}"', { name: project.name }) });
  if (body.start) await startProject(project._id);
  return ok(project, 201);
});
