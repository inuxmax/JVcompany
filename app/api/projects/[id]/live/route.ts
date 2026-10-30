import { liveTasks } from '@/lib/server/repo';
import { type Ctx, ok, route } from '@/lib/server/http';

// Câu trả lời các phòng đang viết dở (để hiện trực tiếp trong khung chat).
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return ok(await liveTasks(id));
});
