// Danh sách ngôn ngữ giao diện. Khoá dịch là câu tiếng Việt gốc, nên 'vi' không cần từ điển.

export const LOCALES = [
  { code: 'en', label: 'English', short: 'EN', intl: 'en-US', ai: 'English' },
  { code: 'vi', label: 'Tiếng Việt', short: 'VI', intl: 'vi-VN', ai: 'Vietnamese (tiếng Việt)' },
  { code: 'zh', label: '简体中文', short: '中文', intl: 'zh-CN', ai: 'Simplified Chinese (简体中文)' },
  { code: 'ja', label: '日本語', short: '日本語', intl: 'ja-JP', ai: 'Japanese (日本語)' },
  { code: 'ko', label: '한국어', short: '한국어', intl: 'ko-KR', ai: 'Korean (한국어)' },
  { code: 'es', label: 'Español', short: 'ES', intl: 'es-ES', ai: 'Spanish (español)' },
  { code: 'fr', label: 'Français', short: 'FR', intl: 'fr-FR', ai: 'French (français)' },
  { code: 'de', label: 'Deutsch', short: 'DE', intl: 'de-DE', ai: 'German (Deutsch)' },
  { code: 'th', label: 'ไทย', short: 'ไทย', intl: 'th-TH', ai: 'Thai (ภาษาไทย)' },
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID', intl: 'id-ID', ai: 'Indonesian (Bahasa Indonesia)' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
/** Ngôn ngữ cần từ điển (mọi ngôn ngữ trừ tiếng Việt gốc). */
export type TargetLocale = Exclude<Locale, 'vi'>;

export const DEFAULT_LOCALE: Locale = 'en';
/** Cookie để máy chủ vẽ đúng ngôn ngữ ngay từ đầu; localStorage là nơi lưu chính (như 'vp-theme'). */
export const LOCALE_COOKIE = 'vp_lang';
export const LOCALE_STORAGE = 'vp-lang';

/** Một nhóm bản dịch: câu tiếng Việt gốc → câu dịch theo từng ngôn ngữ. */
export type Catalog = Record<string, Partial<Record<TargetLocale, string>>>;

export const TARGET_LOCALES =LOCALES.map((l) => l.code).filter((c): c is TargetLocale => c !== 'vi');

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && LOCALES.some((l) => l.code === v);
}

export function localeInfo(code: Locale) {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}
