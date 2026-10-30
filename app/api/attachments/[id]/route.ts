import fs from 'fs/promises';
import { findAttachment } from '@/lib/server/attachments';
import { type Ctx, fail, route } from '@/lib/server/http';
import { m } from '@/lib/i18n';

// Xem ảnh đính kèm (ảnh không đổi nội dung nên cho phép trình duyệt lưu đệm lâu).
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const found = await findAttachment(id);
  if (!found) return fail(m('Không tìm thấy ảnh'), 404);
  return new Response(new Uint8Array(await fs.readFile(found.path)), {
    headers: { 'content-type': found.mime, 'cache-control': 'private, max-age=31536000, immutable' },
  });
});
