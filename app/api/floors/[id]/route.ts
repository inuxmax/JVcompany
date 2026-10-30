import { updateFloor } from '@/lib/server/repo';
import { assignQueuedProjects } from '@/lib/server/agent/orchestrator';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Đổi tên / bật-tắt một tầng. Tầng đang làm dự án vẫn làm nốt khi bị tắt. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ name?: string; enabled?: boolean }>(req);
  const patch: { name?: string; enabled?: boolean } = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 40);
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  const floor = await updateFloor(id, patch);
  if (!floor) return fail(m('Không tìm thấy tầng'), 404);
  if (patch.enabled) await assignQueuedProjects();
  return ok(floor);
});
