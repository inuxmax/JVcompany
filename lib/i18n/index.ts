// Đa ngôn ngữ phía giao diện. Khoá dịch chính là câu tiếng Việt gốc:
//   t('Dự án mới')                       → "New project" (en) / "新项目" (zh) / giữ nguyên (vi)
//   t('Đã giao {n} việc', { n: 3 })      → biến trong ngoặc nhọn, số nhiều: "{n, plural, one {# task} other {# tasks}}"
// Từ điển nằm ở lib/i18n/messages/*.ts (chỉ máy chủ đọc); layout gốc chỉ gửi từ điển của ngôn ngữ đang chọn
// xuống I18nProvider. Đổi ngôn ngữ = lưu lựa chọn + tải lại trang, nên `t()` dùng được ở mọi nơi khi render
// (component, hàm phụ, nhãn 3D) mà không cần hook. Kiểm tra câu chưa dịch: `node scripts/i18n-check.cjs`.
import { localeInfo, type Locale } from './locales';
import { interpolate, type Dict, type Vars } from './format';

export { LOCALES, DEFAULT_LOCALE, isLocale, localeInfo, type Locale } from './locales';
export type { Vars, Dict } from './format';

/** Ngôn ngữ đang dùng trong trình duyệt (I18nProvider đặt khi render). Mặc định: tiếng Việt gốc, không dịch. */
const active: { locale: Locale; dict: Dict } = { locale: 'vi', dict: {} };

export function setActiveI18n(locale: Locale, dict: Dict) {
  active.locale = locale;
  active.dict = dict;
}

/** Ngôn ngữ giao diện hiện tại. */
export function getLocale(): Locale {
  return active.locale;
}

/** Mã ngôn ngữ cho Intl (vd 'en-US', 'vi-VN'). */
export function intlLocale(): string {
  return localeInfo(active.locale).intl;
}

/** Dịch một câu tiếng Việt gốc sang ngôn ngữ đang chọn (không có bản dịch → giữ câu gốc). */
export function t(key: string, vars?: Vars): string {
  return interpolate(active.dict[key] ?? key, vars, active.locale);
}

/**
 * Như t() nhưng kèm ngữ cảnh, khi cùng một câu tiếng Việt cần dịch khác nhau tuỳ chỗ:
 * tc('nav', 'Khác') tra khoá 'nav::Khác' (vd "More"), không có thì giữ câu gốc.
 */
export function tc(ctx: string, key: string, vars?: Vars): string {
  return interpolate(active.dict[`${ctx}::${key}`] ?? key, vars, active.locale);
}

/** Đánh dấu câu cần dịch nhưng sẽ dịch sau, lúc hiển thị (vd hằng số cấp module: `label: m('Tổng quan')` rồi `t(item.label)`). */
export function m(key: string): string {
  return key;
}

const proxies = new WeakMap<object, object>();

/**
 * Bọc một hằng số (bảng nhãn, danh sách preset…): đọc thuộc tính chuỗi nào cũng tự đi qua `t()` lúc truy cập.
 * Giữ nguyên định danh đối tượng con (so sánh === vẫn đúng). Chuỗi không có trong từ điển (mã, màu…) giữ nguyên.
 */
export function localize<T extends object>(value: T): T {
  const cached = proxies.get(value);
  if (cached) return cached as T;
  const proxy = new Proxy(value, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v === 'string') return t(v);
      if (v && typeof v === 'object') return localize(v as object);
      return v;
    },
  });
  proxies.set(value, proxy);
  return proxy;
}

/** Ngày giờ theo ngôn ngữ giao diện. */
export function formatDate(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleString(intlLocale(), opts);
}

/** Số theo ngôn ngữ giao diện. */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(intlLocale(), opts);
}

/**
 * Nội dung tin nhắn theo ngôn ngữ giao diện: tin có `meta.i18n` (do máy chủ tạo bằng sysMsg) được dịch lại,
 * biến dạng chữ cũng thử dịch (tên giai đoạn, phòng ban, tầng có sẵn trong từ điển). Tin thường giữ nguyên.
 */
export function localizedContent(content: string, meta?: Record<string, unknown> | null): string {
  const i18n = meta?.i18n as { key?: unknown; vars?: Vars } | undefined;
  if (!i18n || typeof i18n.key !== 'string') return content;
  const vars = i18n.vars && Object.fromEntries(Object.entries(i18n.vars).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v]));
  return t(i18n.key, vars);
}
