import { createGoal, listGoals } from '@/lib/server/company';
import { listProjects } from '@/lib/server/repo';
import { logActivity } from '@/lib/server/activity';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Goal } from '@/lib/types';

export const GET = route(async () => {
  const [goals, projects] = await Promise.all([listGoals(), listProjects()]);
  return ok(
    goals.map((g) => ({
      ...g,
      projects: projects.filter((p) => p.goalIds?.includes(g._id)).map((p) => ({ _id: p._id, name: p.name, status: p.status })),
    })),
  );
});

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<Goal>>(req);
  if (!body.title?.trim()) return fail(m('Nhập tên mục tiêu'));
  const g = await createGoal({ title: body.title, description: body.description, level: body.level, status: body.status, parentId: body.parentId ?? null, ownerDepartmentId: body.ownerDepartmentId ?? null });
  await logActivity({ action: 'goal.created', entityType: 'goal', entityId: g._id, summary: `Thêm mục tiêu "${g.title}"` });
  return ok(g, 201);
});
