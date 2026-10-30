'use client';
// Kết quả "Kiểm tra môi trường" của một kết nối: từng mục Đạt / Cảnh báo / Lỗi kèm gợi ý sửa (như Paperclip).
import { useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, ChevronDown, CircleAlert, Copy, Info, XCircle } from 'lucide-react';
import type { EnvTestResult } from '@/lib/types';
import { timeAgo } from '@/lib/client/format';
import { toast } from './ui';
import { localize, localizedContent, t } from '@/lib/i18n';
import type { LocalizedText } from '@/lib/i18n/format';

/** Câu do máy chủ tạo (mục kiểm tra, trạng thái kết nối): có khoá dịch (sysMsg) → dịch theo khoá; dữ liệu cũ / chữ thô → thử t(). */
export function checkText(text: string, i18n?: LocalizedText | null): string {
  return i18n ? localizedContent(text, { i18n }) : t(text);
}

const LEVEL = {
  info: { icon: Info, cls: 'text-muted' },
  warn: { icon: CircleAlert, cls: 'text-warn' },
  error: { icon: XCircle, cls: 'text-danger' },
} as const;

export const ENV_STATUS = localize({
  pass: { label: 'Đạt', color: '#5C9A68', icon: CheckCircle2 },
  warn: { label: 'Có cảnh báo', color: '#C9952F', icon: CircleAlert },
  fail: { label: 'Lỗi', color: '#C4483F', icon: XCircle },
} as const);

export function EnvTestView({ result, compact, defaultOpen }: { result: EnvTestResult; compact?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen) || result.status === 'fail');
  const s = ENV_STATUS[result.status];
  const Icon = s.icon;
  const counts = {
    error: result.checks.filter((c) => c.level === 'error').length,
    warn: result.checks.filter((c) => c.level === 'warn').length,
  };
  return (
    <div className={clsx('rounded-xl border', compact ? 'border-line/70' : 'border-line')}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]">
        <Icon className="size-4 shrink-0" style={{ color: s.color }} />
        <span className="font-medium" style={{ color: s.color }}>
          {t('Kiểm tra môi trường: {status}', { status: s.label })}
        </span>
        <span className="text-subtle">
          {counts.error ? `· ${t('{n} lỗi', { n: counts.error })} ` : ''}
          {counts.warn ? `· ${t('{n} cảnh báo', { n: counts.warn })} ` : ''}· {timeAgo(result.testedAt)}
        </span>
        <ChevronDown className={clsx('ml-auto size-4 text-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line/70 px-3 py-2.5">
          {result.checks.map((c, i) => {
            const L = LEVEL[c.level];
            const LI = L.icon;
            return (
              <div key={`${c.code}-${i}`} className="flex gap-2 text-[12.5px]">
                <LI className={clsx('mt-0.5 size-3.5 shrink-0', L.cls)} />
                <div className="min-w-0">
                  <div className={clsx(c.level !== 'info' && L.cls)}>{checkText(c.message, c.i18n)}</div>
                  {c.detail && <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-surface-2 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-muted">{c.detail}</pre>}
                  {c.hint && <div className="mt-0.5 text-[12px] text-subtle">→ {checkText(c.hint, c.hintI18n)}</div>}
                </div>
              </div>
            );
          })}
          {result.command && (
            <div className="rounded-lg bg-surface-2 px-2.5 py-2">
              <div className="mb-1 flex items-center justify-between text-[11.5px] text-subtle">
                <span>{t('Tự chạy thử trong terminal:')}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-fg"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.command!).then(() => toast.success(t('Đã sao chép lệnh')));
                  }}
                >
                  <Copy className="size-3" /> {t('Sao chép')}
                </button>
              </div>
              <code className="block font-mono text-[11.5px] break-all">{result.command}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
