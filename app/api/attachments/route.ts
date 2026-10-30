import { MAX_ATTACHMENTS, saveAttachment } from '@/lib/server/attachments';
import { fail, failFrom, ok, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

// Tải ảnh đính kèm lên (dán/kéo-thả trong hội thoại). Trả về danh sách ảnh đã lưu.
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
  if (!files.length) return fail(m('Chưa chọn ảnh'));
  if (files.length > MAX_ATTACHMENTS) return fail(m('Tối đa {n} ảnh mỗi lần gửi'), 400, { n: MAX_ATTACHMENTS });
  try {
    return ok(await Promise.all(files.map((f) => saveAttachment(f))), 201);
  } catch (e) {
    return failFrom(e);
  }
});
