'use client';
// Nhận từ điển của ngôn ngữ đang chọn từ layout gốc (máy chủ) và kích hoạt nó cho `t()` trước khi các thành phần con render.
import { createContext, useContext, type ReactNode } from 'react';
import { setActiveI18n } from './index';
import { LOCALE_COOKIE, LOCALE_STORAGE, type Locale } from './locales';
import type { Dict } from './format';

const LocaleContext = createContext<Locale>('vi');

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict; children: ReactNode }) {
  // Đặt ngay khi render (cha render trước con) để mọi lời gọi t() bên dưới – kể cả lúc máy chủ render – dùng đúng ngôn ngữ.
  setActiveI18n(locale, dict);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Ngôn ngữ giao diện hiện tại (trong component). */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Đổi ngôn ngữ: lưu vào trình duyệt + cookie (máy chủ vẽ đúng ngôn ngữ), báo cho agent, rồi tải lại trang. */
export function changeLocale(code: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE, code);
  } catch {
    /* bỏ qua */
  }
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
  // Ngôn ngữ trả lời mặc định của agent (lịch định kỳ, việc nền…); keepalive để yêu cầu không bị huỷ khi tải lại trang.
  fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: code }),
    keepalive: true,
  }).catch(() => undefined);
  window.location.reload();
}
