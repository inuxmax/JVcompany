import { uninstallPlugin } from '@/lib/server/plugins';
import { type Ctx, ok, route } from '@/lib/server/http';

/** Gỡ plugin (?removeSkills=1 để xoá luôn kỹ năng nó đã thêm). */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await uninstallPlugin(id, { removeSkills: new URL(req.url).searchParams.get('removeSkills') === '1' });
  return ok({ ok: true });
});
