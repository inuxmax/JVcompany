import { floorOverview } from '@/lib/server/repo';
import { ok, route } from '@/lib/server/http';

/** Các tầng của toà nhà kèm dự án đang làm và hàng chờ dự án. */
export const GET = route(async () => ok(await floorOverview()));
