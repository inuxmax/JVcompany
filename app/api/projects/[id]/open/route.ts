import { getProject } from '@/lib/server/repo';
import { openTarget } from '@/lib/server/computer';
import { workspaceFor } from '@/lib/server/agent/runner';
import { type Ctx, fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Mở thư mục dự án trong trình quản lý tệp của hệ điều hành. */
export const POST = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return fail(m('Không tìm thấy dự án'), 404);
  const ws = await workspaceFor(project);
  await openTarget(ws.root);
  return ok({ ok: true, path: ws.root });
});
