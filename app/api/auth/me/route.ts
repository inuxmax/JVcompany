import { authEnabled, currentUser } from '@/lib/server/auth';
import { ok, route } from '@/lib/server/http';

/** Đã bật đăng nhập chưa + tài khoản đang đăng nhập (null nếu chưa). */
export const GET = route(async () => ok({ authEnabled: authEnabled(), user: await currentUser() }));
