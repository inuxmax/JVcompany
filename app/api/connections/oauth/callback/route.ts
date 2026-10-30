import { finishOAuth } from '@/lib/server/mcp-oauth';
import { LocalizedError } from '@/lib/server/http';
import { requestLocale, tl } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/locales';

const page = (title: string, body: string, ok: boolean, lang: Locale = 'vi', back = tl(lang, 'Quay lại Kết nối dịch vụ')) =>
  new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3efe6;color:#2b2724;font-family:system-ui,sans-serif}
.card{max-width:420px;margin:16px;padding:28px;border:1px solid #e2dacb;border-radius:24px;background:#fbf8f2}
h1{font-size:20px;margin:0 0 8px;color:${ok ? '#4f8a5b' : '#c4483f'}}p{margin:0;color:#6b6359;font-size:14px;line-height:1.5}a{display:inline-block;margin-top:14px;color:#b4532a;font-size:14px}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p><a href="/connections">← ${back}</a></div>
<script>var o=null;try{o=window.opener;o&&o.postMessage({type:'jv-oauth',ok:${ok}},location.origin)}catch(e){}
${ok ? "setTimeout(function(){if(o){window.close()}else{location.replace('/connections')}},1200)" : ''}</script></body></html>`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Nhà cung cấp chuyển về sau khi bạn đồng ý cấp quyền: đổi mã lấy token, lưu vào kho bí mật. */
export async function GET(req: Request) {
  // Trang hiện trong cửa sổ đăng nhập → dịch theo ngôn ngữ giao diện (cookie)
  const locale = await requestLocale();
  const url = new URL(req.url);
  const error = url.searchParams.get('error');
  if (error) return page(tl(locale, 'Chưa kết nối'), esc(url.searchParams.get('error_description') ?? error), false, locale);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!state || !code) return page(tl(locale, 'Chưa kết nối'), tl(locale, 'Thiếu mã xác nhận từ nhà cung cấp.'), false, locale);
  try {
    const conn = await finishOAuth(state, code);
    return page(tl(locale, 'Đã kết nối'), tl(locale, '{name} đã sẵn sàng cho agent dùng. Bạn có thể đóng tab này.', { name: esc(conn.name) }), true, locale);
  } catch (err) {
    const message = err instanceof LocalizedError ? tl(locale, err.key, err.vars) : tl(locale, err instanceof Error ? err.message : String(err));
    return page(tl(locale, 'Chưa kết nối'), esc(message), false, locale);
  }
}
