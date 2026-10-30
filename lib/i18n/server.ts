// Đa ngôn ngữ phía máy chủ: đọc ngôn ngữ từ cookie, ghép từ điển của một ngôn ngữ, dịch câu cho API / tin nhắn hệ thống.
// Chỉ import từ mã máy chủ (layout gốc, route handler, lib/server) – các tệp từ điển không được đóng gói xuống trình duyệt.
import { cookies } from 'next/headers';
import { CATALOGS } from './messages';
import { translate, type Dict, type Vars } from './format';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locales';

const cache = new Map<Locale, Dict>();

/** Từ điển phẳng của một ngôn ngữ (tiếng Việt: rỗng – khoá chính là câu gốc). */
export function dictionary(locale: Locale): Dict {
  if (locale === 'vi') return {};
  let dict = cache.get(locale);
  if (!dict) {
    dict = {};
    for (const catalog of CATALOGS) {
      for (const [key, entry] of Object.entries(catalog)) {
        const v = entry[locale];
        if (v && !(key in dict)) dict[key] = v;
      }
    }
    cache.set(locale, dict);
  }
  return dict;
}

/** Dịch câu tiếng Việt gốc sang một ngôn ngữ cụ thể. */
export function tl(locale: Locale, key: string, vars?: Vars): string {
  return translate(dictionary(locale), locale, key, vars);
}

/** Ngôn ngữ của yêu cầu hiện tại (cookie vp_lang), mặc định tiếng Anh. Dùng trong Server Component / route handler. */
export async function requestLocale(): Promise<Locale> {
  try {
    const v = (await cookies()).get(LOCALE_COOKIE)?.value;
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
