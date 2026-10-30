'use client';
// Nút chọn ngôn ngữ giao diện (chân thanh menu dọc, bảng "Khác" trên điện thoại, thanh trên màn hình vừa).
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { LOCALES, localeInfo, t, type Locale } from '@/lib/i18n';
import { changeLocale, useLocale } from '@/lib/i18n/provider';

/**
 * `placement`: hướng mở bảng chọn. `compact`: chỉ hiện biểu tượng (menu dọc thu gọn).
 */
export function LanguageSwitch({ placement = 'up', compact }: { placement?: 'up' | 'down' | 'right'; compact?: boolean }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Locale | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const current = localeInfo(locale);
  const label = t('Ngôn ngữ');
  const pick = (code: Locale) => {
    if (code === locale) return setOpen(false);
    setPending(code);
    changeLocale(code);
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        title={compact ? `${label}: ${current.label}` : undefined}
        className={clsx(
          'flex items-center rounded-full bg-surface-3 text-[12.5px] font-medium text-muted transition-colors hover:bg-line-strong hover:text-fg',
          compact ? 'size-8 justify-center' : 'h-8 gap-1.5 pr-2 pl-2.5',
        )}
      >
        <Languages className="size-3.5 shrink-0" />
        {!compact && (
          <>
            <span className="max-w-[7.5rem] truncate">{current.label}</span>
            <ChevronDown className={clsx('size-3.5 shrink-0 text-subtle transition-transform', open && 'rotate-180')} />
          </>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={clsx(
            'animate-vp-in absolute z-50 w-52 rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl',
            placement === 'up' && 'right-0 bottom-full mb-2',
            placement === 'down' && 'top-full right-0 mt-2',
            placement === 'right' && 'bottom-0 left-full ml-3',
          )}
        >
          <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{label}</div>
          <div className="max-h-[min(60vh,22rem)] overflow-y-auto [scrollbar-width:thin]">
            {LOCALES.map((l) => {
              const selected = l.code === locale;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  lang={l.code}
                  disabled={pending != null}
                  onClick={() => pick(l.code)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors',
                    selected ? 'bg-surface-3 font-medium text-fg' : 'text-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  <span className="w-7 shrink-0 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">{l.code}</span>
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-accent" />}
                  {pending === l.code && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
