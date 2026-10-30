import { providerUsage } from '@/lib/server/runs';
import { ok, route } from '@/lib/server/http';

/** Token & chi phí của từng kết nối AI (5 giờ / hôm nay / 7 ngày / 30 ngày / từ trước tới nay). */
export const GET = route(async () => ok({ usage: await providerUsage() }));
