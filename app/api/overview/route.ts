import { activeTasksByDepartment, dashboardStats, floorOverview, listDepartments, listProjects } from '@/lib/server/repo';
import { getCollections } from '@/lib/server/db';
import { ok, route } from '@/lib/server/http';

export const GET = route(async () => {
  const c = await getCollections();
  const [stats, projects, departments, active, recent, building] = await Promise.all([
    dashboardStats(),
    listProjects(),
    listDepartments(),
    activeTasksByDepartment(),
    c.messages
      .find({ kind: { $in: ['report', 'delegation', 'system', 'error', 'approval', 'chat'] } })
      .sort({ createdAt: -1 })
      .limit(40)
      .toArray(),
    floorOverview(),
  ]);
  return ok({
    stats,
    projects: projects.slice(0, 12),
    departments: departments.map(({ systemPrompt: _s, ...d }) => {
      void _s;
      return { ...d, activeTasks: active[d._id] ?? [] };
    }),
    recent,
    projectNames: Object.fromEntries(projects.map((p) => [p._id, p.name])),
    floors: building.floors,
    queue: building.queue,
  });
});
