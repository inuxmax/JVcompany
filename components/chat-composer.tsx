'use client';
// Khung soạn tin hội thoại: chọn phòng nhận, ô nhập tự giãn, dán / kéo-thả / đính kèm ảnh.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Crown, ImagePlus, Loader2, SendHorizonal, X } from 'lucide-react';
import type { Attachment, Department } from '@/lib/types';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import { DeptAvatar, IconButton, toast } from './ui';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILES = 6;
const MAX_BYTES = 5 * 1024 * 1024;

interface Pending {
  key: number;
  file: File;
  url: string;
  att?: Attachment;
  error?: string;
}

/** Người nhận đặc biệt: CEO tổng (nhận việc mới và giao cho tầng đang rảnh). */
export const CEO_RECIPIENT = '__ceo';

export function RecipientPicker({
  departments,
  value,
  onChange,
  withCeo,
}: {
  departments: Department[];
  value: string;
  onChange: (id: string) => void;
  /** Hiện lựa chọn "CEO tổng" ở đầu danh sách (giao việc mới cho tầng trống). */
  withCeo?: { freeFloors: number; totalFloors: number };
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const cur = departments.find((d) => d._id === value);
  const isCeo = value === CEO_RECIPIENT;
  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 max-w-full items-center gap-2 rounded-full border border-line bg-surface-2/70 py-1 pr-2.5 pl-1 text-[12.5px] transition-colors hover:border-line-strong"
      >
        {isCeo ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#25211c] text-[#E0B44A]">
            <Crown className="size-3.5" />
          </span>
        ) : (
          cur && <DeptAvatar icon={cur.icon} color={cur.color} size="sm" className="!size-7 !rounded-full" />
        )}
        <span className="text-muted">{t('Gửi')}</span>
        <span className="truncate font-medium">{isCeo ? t('CEO tổng') : cur ? t(cur.name) : t('Chọn phòng')}</span>
        <ChevronDown className={clsx('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" className="animate-vp-in absolute bottom-full left-0 z-30 mb-2 max-h-80 w-72 overflow-y-auto rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl">
          {withCeo && (
            <>
              <button
                type="button"
                role="option"
                aria-selected={isCeo}
                onClick={() => {
                  onChange(CEO_RECIPIENT);
                  setOpen(false);
                }}
                className={clsx('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3', isCeo && 'bg-accent/8')}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#25211c] text-[#E0B44A]">
                  <Crown className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{t('CEO tổng')}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {t('Việc mới → tầng đang rảnh ({free}/{total} tầng trống)', { free: withCeo.freeFloors, total: withCeo.totalFloors })}
                  </span>
                </span>
                {isCeo && <Check className="size-4 shrink-0 text-accent" />}
              </button>
              <div className="my-1 border-t border-line" />
            </>
          )}
          {departments
            .filter((d) => d.enabled)
            .map((d) => (
              <button
                key={d._id}
                type="button"
                role="option"
                aria-selected={d._id === value}
                onClick={() => {
                  onChange(d._id);
                  setOpen(false);
                }}
                className={clsx('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3', d._id === value && 'bg-accent/8')}
              >
                <DeptAvatar icon={d.icon} color={d.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{t(d.name)}</span>
                  <span className="block truncate text-[11.5px] text-muted">{t(d.title)}</span>
                </span>
                {d._id === value && <Check className="size-4 shrink-0 text-accent" />}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function ChatComposer({
  onSend,
  placeholder,
  left,
  autoFocus,
}: {
  /** Trả về true khi đã gửi được (để xoá nội dung đang soạn). */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  placeholder: string;
  /** Nút bên trái thanh công cụ (chọn phòng nhận, thư mục…). */
  left?: ReactNode;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  // Giải phóng ảnh xem trước khi rời trang
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  // Ô nhập tự giãn theo nội dung
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const uploading = pending.some((p) => !p.att && !p.error);
  const ready = pending.filter((p) => p.att);
  const canSend = !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  const addFiles = (list: File[]) => {
    const images = list.filter((f) => ACCEPT.includes(f.type));
    if (list.length && !images.length) return toast.error(t('Chỉ gửi được ảnh PNG, JPG, WEBP hoặc GIF.'));
    const tooBig = images.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast.error(t('Ảnh lớn hơn 5 MB: {files}', { files: tooBig.map((f) => f.name).join(', ') }));
    const room = MAX_FILES - pending.length;
    const ok = images.filter((f) => f.size <= MAX_BYTES).slice(0, Math.max(0, room));
    if (images.length - tooBig.length > room) toast.error(t('Tối đa {n} ảnh mỗi tin nhắn.', { n: MAX_FILES }));
    const items = ok.map((file) => ({ key: ++seq.current, file, url: URL.createObjectURL(file) }));
    if (!items.length) return;
    setPending((p) => [...p, ...items]);
    for (const it of items) {
      api
        .upload<Attachment[]>('/api/attachments', [it.file])
        .then(([att]) => setPending((p) => p.map((x) => (x.key === it.key ? { ...x, att } : x))))
        .catch((e: unknown) => setPending((p) => p.map((x) => (x.key === it.key ? { ...x, error: e instanceof Error ? e.message : String(e) } : x))));
    }
  };

  const remove = (key: number) => {
    setPending((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });
  };

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const sent = await onSend(text.trim(), ready.map((p) => p.att!));
    if (sent) {
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
      setText('');
    }
    setSending(false);
    ta.current?.focus();
  };

  return (
    <div className="@container border-t border-line p-3">
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={clsx(
          'relative rounded-[22px] border bg-surface shadow-sm transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent/10',
          dragging ? 'border-dashed border-accent' : 'border-line-strong',
        )}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {pending.map((p) => (
              <div key={p.key} className="group relative size-16 overflow-hidden rounded-xl border border-line bg-surface-2" title={p.error ?? p.file.name}>
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước cục bộ (blob:) */}
                <img src={p.url} alt={p.file.name} className="size-full object-cover" />
                {!p.att && !p.error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <Loader2 className="size-4 animate-spin text-white" />
                  </div>
                )}
                {p.error && <div className="absolute inset-0 flex items-center justify-center bg-danger/75 px-1 text-center text-[10.5px] font-medium text-white">{t('Lỗi tải')}</div>}
                <button
                  type="button"
                  aria-label={t('Bỏ ảnh {name}', { name: p.file.name })}
                  onClick={() => remove(p.key)}
                  className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            // Enter để gửi; không gửi khi đang gõ dấu tiếng Việt (IME) hoặc giữ Shift
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label={t('Nội dung tin nhắn')}
          className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] leading-relaxed text-fg outline-none placeholder:text-subtle"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          {left}
          <IconButton label={t('Đính kèm ảnh')} onClick={() => fileInput.current?.click()} disabled={pending.length >= MAX_FILES}>
            <ImagePlus className="size-[18px]" />
          </IconButton>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT.join(',')}
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <div className="min-w-0 flex-1" />
          <span className="hidden text-[11.5px] whitespace-nowrap text-subtle @xl:block">{t('Enter để gửi · Shift+Enter xuống dòng')}</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label={t('Gửi')}
            title={uploading ? t('Đang tải ảnh lên…') : t('Gửi')}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending || uploading ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
          </button>
        </div>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[22px] bg-accent/8 text-[13px] font-medium text-accent">
            {t('Thả ảnh vào đây để đính kèm')}
          </div>
        )}
      </div>
    </div>
  );
}
