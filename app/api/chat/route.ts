import { handleUserChat } from '@/lib/server/chat';
import { actorName } from '@/lib/server/auth';
import { validAttachments } from '@/lib/server/attachments';
import { LocalizedError, fail, ok, readJson, route } from '@/lib/server/http';
import { requestLocale } from '@/lib/i18n/server';
import { m } from '@/lib/i18n';

/**
 * Chat ở trang Toà nhà.
 * - Chưa có cuộc trò chuyện: CEO tổng nhận yêu cầu, tạo dự án (giao cho giám đốc), tìm tầng trống và giao ngay.
 * - Đã có: nhắn tiếp cho giám đốc tầng (hoặc phòng được chọn) của dự án đó; dự án đã xong/dừng thì mở lại trên một tầng.
 */
export const POST = route(async (req: Request) => {
  const body = await readJson<{ content?: string; projectId?: string; departmentId?: string; path?: string | null; attachments?: unknown; floor?: number }>(req);
  const content = (body.content ?? '').trim();
  const files = await validAttachments(body.attachments);
  if (!content && !files.length) return fail(m('Nội dung trống'));
  try {
    const r = await handleUserChat({
      content,
      projectId: body.projectId,
      departmentId: body.departmentId,
      path: body.path,
      attachments: files,
      authorName: await actorName(),
      floorNumber: Number.isInteger(body.floor) ? body.floor : null,
      language: await requestLocale(),
    });
    return ok({ projectId: r.projectId, floorNumber: r.floorNumber }, r.created ? 201 : 200);
  } catch (err) {
    // Lỗi cho người dùng (dịch được) – route() trả về kèm khoá dịch
    if (err instanceof LocalizedError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/Không tìm thấy cuộc trò chuyện/.test(msg)) return fail(msg, 404);
    if (/Thư mục không tồn tại|Chưa có phòng ban|Nội dung trống/.test(msg)) return fail(msg);
    throw err;
  }
});
