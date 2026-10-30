'use client';
// Định dạng thời gian / số cho giao diện (theo ngôn ngữ đang chọn).
import { useEffect, useState } from 'react';
import { intlLocale, t } from '@/lib/i18n';

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s >= 0 && s < 10) return t('vừa xong');
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
  const abs = Math.abs(s);
  const sign = s < 0 ? 1 : -1;
  if (abs < 60) return rtf.format(sign * abs, 'second');
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  if (s < 0 || abs < 86400 * 30) return rtf.format(sign * Math.round(abs / 86400), 'day');
  return new Date(iso).toLocaleDateString(intlLocale());
}

export function dateTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(intlLocale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function clock(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function bytes(n?: number): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Màu chữ/nền nhạt từ màu thương hiệu của phòng ban. */
export function tint(color: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${a}` : color;
}

/** Thời điểm hiện tại, tự cập nhật định kỳ (tránh gọi Date.now() khi render). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
