import fs from 'fs/promises';
import { getProject } from '@/lib/server/repo';
import { listDir, readTextFile, resolveInside } from '@/lib/server/fsbrowse';
import { workspaceFor } from '@/lib/server/agent/runner';
import { type Ctx, fail, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

/** Duyệt / xem tệp trong thư mục dự án (chỉ đọc, giới hạn trong thư mục dự án). */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return fail(m('Không tìm thấy dự án'), 404);
  const ws = await workspaceFor(project);
  const rel = new URL(req.url).searchParams.get('path') ?? '';
  const abs = resolveInside(ws.root, rel || '.');
  if (!abs) return fail(m('Đường dẫn nằm ngoài thư mục dự án'), 403);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) return fail(m('Không tìm thấy'), 404);
  if (st.isDirectory()) {
    const listing = await listDir(abs, { files: true, hidden: true });
    return ok({ type: 'dir', root: ws.root, real: ws.real, path: abs, entries: listing.entries });
  }
  const file = await readTextFile(abs);
  return ok({ type: 'file', root: ws.root, real: ws.real, path: abs, ...file });
});
