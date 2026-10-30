// Bảo vệ truy cập: mặc định chỉ cho phép từ máy này (agent có thể điều khiển máy tính).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isPublicPath, readSnapshot, roleBlock, verifySession } from './lib/auth-token';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Cookie chọn công ty (trùng COMPANY_COOKIE trong lib/server/db.ts – không import db vào proxy). */
const COMPANY_COOKIE = 'vp_company';

export function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const key = process.env.VANPHONG_ACCESS_KEY;

  if (!LOCAL_HOST.test(host)) {
    if (!key) {
      return new NextResponse(
        'Văn Phòng AI chỉ cho phép truy cập từ chính máy này. Đặt VANPHONG_ACCESS_KEY trong .env.local để mở truy cập mạng LAN.',
        { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }
    const q = req.nextUrl.searchParams.get('key');
    if (q === key) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('key');
      const res = NextResponse.redirect(clean);
      res.cookies.set('vp_key', key, { httpOnly: true, sameSite: 'strict', maxAge: 30 * 24 * 3600, path: '/' });
      return res;
    }
    if (req.cookies.get('vp_key')?.value !== key) {
      return new NextResponse('Cần khóa truy cập (?key=...)', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  // Chống CSRF: yêu cầu thay đổi dữ liệu phải đến từ chính ứng dụng.
  if (req.nextUrl.pathname.startsWith('/api/') && !SAFE_METHODS.has(req.method)) {
    const origin = req.headers.get('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        /* origin lỗi */
      }
      if (originHost !== host) return NextResponse.json({ error: 'Nguồn yêu cầu không hợp lệ' }, { status: 403 });
    }
  }

  // Đăng nhập nhiều tài khoản (bật khi đã tạo tài khoản đầu tiên) – lớp kiểm tra THÊM sau khoá truy cập & chống CSRF.
  // Header x-vp-user chỉ do proxy gắn (xoá mọi giá trị gửi từ ngoài).
  const headers = new Headers(req.headers);
  headers.delete('x-vp-user');
  const auth = readSnapshot();
  const pathname = req.nextUrl.pathname;
  if (auth.enabled) {
    const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    const user = session ? auth.users[session.uid] : undefined;
    const valid = Boolean(session && user && user.status === 'active' && user.v === session.v);
    // Đường công khai (đăng nhập, cổng máy-gọi-máy có mã riêng): không bắt buộc phiên, chỉ gắn người dùng nếu có
    if (isPublicPath(pathname)) {
      if (valid) headers.set('x-vp-user', session!.uid);
      return NextResponse.next({ request: { headers } });
    }
    if (!session || !user || !valid) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Cần đăng nhập' }, { status: 401 });
      const login = req.nextUrl.clone();
      login.pathname = '/login';
      login.search = '';
      if (pathname !== '/') login.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
    const blocked = roleBlock(user.role, req.method, pathname);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
    // Tài khoản chỉ được vào một số công ty → luôn làm việc ở công ty được giao
    const company = req.cookies.get(COMPANY_COOKIE)?.value || 'main';
    if (user.companies.length && !user.companies.includes(company)) {
      const rest = (req.headers.get('cookie') ?? '').split(/;\s*/).filter((c) => c && !c.startsWith(`${COMPANY_COOKIE}=`));
      headers.set('cookie', [...rest, `${COMPANY_COOKIE}=${user.companies[0]}`].join('; '));
    }
    headers.set('x-vp-user', session.uid);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
