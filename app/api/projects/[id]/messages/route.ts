import { getDepartment, listMessages } from '@/lib/server/repo';
import { chatWithDepartment } from '@/lib/server/agent/orchestrator';
import { validAttachments } from '@/lib/server/attachments';
import { type Ctx, fail, ok, readJson, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? 400);
  return ok(await listMessages(id, { taskId, limit: Math.min(2000, Math.max(10, limit)) }));
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { departmentId, content, attachments } = await readJson<{ departmentId?: string; content?: string; attachments?: unknown }>(req);
  const files = await validAttachments(attachments);
  if (!content?.trim() && !files.length) return fail(m('Nội dung trống'));
  if (!departmentId || !(await getDepartment(departmentId))) return fail(m('Chọn phòng ban nhận tin nhắn'));
  const task = await chatWithDepartment(id, departmentId, (content ?? '').trim(), files);
  return ok(task, 201);
});
