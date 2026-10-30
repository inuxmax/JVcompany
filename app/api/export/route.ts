import { getCollections } from '@/lib/server/db';
import { route } from '@/lib/server/http';

/** Xuất toàn bộ dữ liệu (không kèm API key) ra JSON để sao lưu. */
export const GET = route(async () => {
  const c = await getCollections();
  const [departments, providers, workflows, projects, tasks, messages, approvals, artifacts, settings] = await Promise.all([
    c.departments.find().toArray(),
    c.providers.find({}, { projection: { apiKey: 0 } }).toArray(),
    c.workflows.find().toArray(),
    c.projects.find().toArray(),
    c.tasks.find({}, { projection: { liveText: 0 } }).toArray(),
    c.messages.find().toArray(),
    c.approvals.find().toArray(),
    c.artifacts.find().toArray(),
    c.settings.find().toArray(),
  ]);
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), departments, providers, workflows, projects, tasks, messages, approvals, artifacts, settings },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vanphong-ai-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
