import { activeTasksByDepartment, createDepartment, listDepartments } from '@/lib/server/repo';
import { getCollections } from '@/lib/server/db';
import { fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';
import type { Department } from '@/lib/types';

export const GET = route(async () => {
  const c = await getCollections();
  const [departments, active, done] = await Promise.all([
    listDepartments(),
    activeTasksByDepartment(),
    c.tasks
      .aggregate<{ _id: string; n: number }>([{ $match: { status: 'done' } }, { $group: { _id: '$departmentId', n: { $sum: 1 } } }])
      .toArray(),
  ]);
  const doneMap = Object.fromEntries(done.map((d) => [d._id, d.n]));
  return ok(departments.map((d) => ({ ...d, activeTasks: active[d._id] ?? [], doneCount: doneMap[d._id] ?? 0 })));
});

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<Department>>(req);
  if (!body.name?.trim()) return fail(m('Cần nhập tên phòng ban'));
  return ok(await createDepartment({ ...body, name: body.name.trim() }), 201);
});
