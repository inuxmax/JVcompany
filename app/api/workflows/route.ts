import { listWorkflows } from '@/lib/server/repo';
import { ok, route } from '@/lib/server/http';

// Các chế độ làm việc của dự án (giao cho giám đốc, quy trình 7 giai đoạn…).
export const GET = route(async () => ok(await listWorkflows()));
