'use client';
// Bộ thành phần giao diện dùng chung.
import {
  forwardRef,
  useEffect,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { t } from '@/lib/i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  Bot,
  Briefcase,
  ClipboardList,
  Code2,
  Cpu,
  Crown,
  Database,
  LineChart,
  Loader2,
  Megaphone,
  Network,
  Palette,
  Rocket,
  ShieldCheck,
  Users,
  Wrench,
  X,
  FlaskConical,
  Bug,
  TriangleAlert,
  CircleCheck,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import { tint } from '@/lib/client/format';

export { clsx as cx };

// ---------------- Button ----------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive' | 'success' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-sm hover:brightness-110',
  secondary: 'bg-surface-3 text-fg hover:bg-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-surface-3',
  outline: 'border border-line-strong bg-surface/60 text-fg backdrop-blur hover:bg-surface-3',
  danger: 'bg-danger/12 text-danger hover:bg-danger/20',
  destructive: 'bg-danger text-white shadow-sm hover:brightness-110',
  success: 'bg-ok text-white hover:brightness-110',
};
const SIZES: Record<Size, string> = {
  xs: 'h-7 px-3 text-xs gap-1.5 rounded-full',
  sm: 'h-8 px-3.5 text-[13px] gap-1.5 rounded-full',
  md: 'h-10 px-5 text-sm gap-2 rounded-full',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-full',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-150 select-none',
        'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------- Card ----------------

export function Card({
  className,
  children,
  as: As = 'div',
  ...rest
}: { className?: string; children?: ReactNode; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return (
    <As className={clsx('glass rounded-[26px]', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-3 px-6 pt-5 pb-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------- Badge / Dot ----------------

export function Badge({
  color,
  children,
  className,
  dot,
  pulse,
}: {
  color?: string;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  const c = color ?? '#958B7E';
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap', className)}
      style={{ background: tint(c, 0.14), color: c }}
    >
      {dot && <span className={clsx('size-1.5 rounded-full', pulse && 'animate-jv-pulse')} style={{ background: c }} />}
      {children}
    </span>
  );
}

export function Dot({ color, pulse, className }: { color: string; pulse?: boolean; className?: string }) {
  return (
    <span className={clsx('relative inline-flex size-2 shrink-0', className)}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

// ---------------- Form ----------------

const fieldBase =
  'w-full rounded-2xl border border-line-strong bg-surface-2 px-3.5 text-sm text-fg placeholder:text-subtle transition-all focus:border-accent focus:bg-surface-solid focus:outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldBase, 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={clsx(fieldBase, 'min-h-[96px] py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(fieldBase, 'h-11 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-line-strong ring-inset',
      )}
    >
      <span
        className={clsx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface-2 p-1 backdrop-blur', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-all',
            value === o.value ? 'bg-surface-solid text-fg shadow-md ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
          {o.count != null && (
            <span className={clsx('rounded-full px-1.5 text-[11px]', value === o.value ? 'bg-accent/15 text-accent' : 'bg-surface-3')}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------- Overlay ----------------

const noopSubscribe = () => () => {};

/** true khi đã chạy trên trình duyệt (portal cần document.body). */
function usePortal() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const mounted = usePortal();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#1a140e]/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'animate-jv-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface-solid/95 shadow-2xl backdrop-blur-2xl sm:rounded-[28px]',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton label={t('Đóng')} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  width?: string;
}) {
  const mounted = usePortal();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[#1a140e]/35 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={clsx(
          'animate-jv-in relative m-0 flex h-full w-full flex-col overflow-hidden border-l border-line bg-surface-solid/95 shadow-2xl backdrop-blur-2xl sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-[28px] sm:border',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold tracking-tight">{title}</div>
            {subtitle && <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1">
            {actions}
            <IconButton label={t('Đóng')} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

// ---------------- Misc ----------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin text-muted', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-14 items-center justify-center rounded-3xl bg-surface-3 text-accent">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {description && <p className="mt-1 max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-jv-pulse rounded-3xl bg-surface-2', className)} />;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('prose-jv', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className={clsx('rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger', className)}>{msg}</div>
  );
}

// ---------------- Phòng ban ----------------

const DEPT_ICONS: Record<string, LucideIcon> = {
  Crown,
  Palette,
  Code2,
  Users,
  ClipboardList,
  Network,
  ShieldCheck,
  Cpu,
  Briefcase,
  BookOpen,
  Megaphone,
  Database,
  Bot,
  Rocket,
  LineChart,
  Wrench,
  FlaskConical,
  Bug,
};

export function DeptIcon({ name, className }: { name: string; className?: string }) {
  const Icon = DEPT_ICONS[name] ?? Bot;
  return <Icon className={className} />;
}

export function DeptAvatar({
  icon,
  color,
  size = 'md',
  busy,
  className,
}: {
  icon: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  className?: string;
}) {
  const dim = { sm: 'size-8 rounded-xl', md: 'size-11 rounded-2xl', lg: 'size-14 rounded-[20px]' }[size];
  const ic = { sm: 'size-3.5', md: 'size-5', lg: 'size-7' }[size];
  return (
    <div
      className={clsx('relative flex shrink-0 items-center justify-center', dim, busy && 'animate-jv-ring', className)}
      style={{
        background: `linear-gradient(145deg, ${tint(color, 0.38)}, ${tint(color, 0.08)})`,
        color,
        boxShadow: `inset 0 1px 0 ${tint('#FFFFFF', 0.18)}, inset 0 0 0 1px ${tint(color, 0.35)}${busy ? `, 0 0 22px -4px ${tint(color, 0.8)}` : ''}`,
      }}
    >
      <DeptIcon name={icon} className={ic} />
      {busy && (
        <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full opacity-70" style={{ background: color }} />
          <span className="relative inline-flex size-2.5 rounded-full ring-2 ring-surface" style={{ background: color }} />
        </span>
      )}
    </div>
  );
}

// ---------------- Thông báo (toast) ----------------

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
const toastListeners = new Set<(item: ToastItem) => void>();
let toastId = 0;

export function toast(message: string, kind: ToastKind = 'info') {
  const item = { id: ++toastId, kind, message };
  toastListeners.forEach((l) => l(item));
}
toast.success = (m: string) => toast(m, 'success');
toast.error = (m: unknown) => toast(m instanceof Error ? m.message : String(m), 'error');

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (item: ToastItem) => {
      setItems((s) => [...s, item]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== item.id)), item.kind === 'error' ? 6000 : 3500);
    };
    toastListeners.add(l);
    return () => {
      toastListeners.delete(l);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-24 left-4 z-[60] lg:bottom-5 flex flex-col items-end gap-2 sm:left-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className={clsx(
            'animate-jv-in pointer-events-auto max-w-sm rounded-2xl border px-4 py-3 text-[13px] shadow-xl backdrop-blur-xl',
            item.kind === 'success' && 'border-ok/30 bg-surface text-fg',
            item.kind === 'error' && 'border-danger/40 bg-surface text-danger',
            item.kind === 'info' && 'border-line bg-surface text-fg',
          )}
        >
          {item.kind === 'success' && <span className="mr-1.5 text-ok">✓</span>}
          {item.message}
        </div>
      ))}
    </div>
  );
}

// ---------------- Hộp thoại xác nhận (thay cho confirm() của trình duyệt) ----------------

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = xoá/huỷ (nút đỏ), success = duyệt (nút xanh), primary = thao tác thường. */
  tone?: 'primary' | 'danger' | 'success';
}
interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}
const confirmListeners = new Set<(r: ConfirmRequest) => void>();
let confirmId = 0;

/** Hỏi xác nhận bằng hộp thoại của ứng dụng; trả về true nếu người dùng đồng ý. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Dự phòng khi trang chưa gắn ConfirmHost.
    if (!confirmListeners.size) return resolve(window.confirm(opts.title));
    const r = { ...opts, id: ++confirmId, resolve };
    confirmListeners.forEach((l) => l(r));
  });
}

const CONFIRM_TONE = {
  primary: { icon: CircleHelp, badge: 'bg-accent/12 text-accent', button: 'primary' as Variant },
  danger: { icon: TriangleAlert, badge: 'bg-danger/12 text-danger', button: 'destructive' as Variant },
  success: { icon: CircleCheck, badge: 'bg-ok/15 text-ok', button: 'success' as Variant },
};

/** Nơi hiển thị hộp thoại xác nhận (gắn một lần trong layout). */
export function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const mounted = usePortal();
  useEffect(() => {
    const l = (r: ConfirmRequest) => setQueue((q) => [...q, r]);
    confirmListeners.add(l);
    return () => {
      confirmListeners.delete(l);
    };
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      current.resolve(false);
      setQueue((q) => q.slice(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);
  if (!current || !mounted) return null;
  const done = (ok: boolean) => {
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  const tone = CONFIRM_TONE[current.tone ?? 'primary'];
  const Icon = tone.icon;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#1a140e]/45 backdrop-blur-sm" onClick={() => done(false)} />
      <div
        key={current.id}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="jv-confirm-title"
        className="animate-jv-in relative w-full max-w-[440px] rounded-[26px] border border-line bg-surface-solid p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start gap-4">
          <span className={clsx('flex size-11 shrink-0 items-center justify-center rounded-2xl', tone.badge)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id="jv-confirm-title" className="font-display text-[17px] leading-snug font-semibold text-fg">
              {current.title}
            </h2>
            {current.message && <div className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{current.message}</div>}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => done(false)} autoFocus={current.tone === 'danger'}>
            {current.cancelLabel ?? t('Huỷ')}
          </Button>
          <Button variant={tone.button} onClick={() => done(true)} autoFocus={current.tone !== 'danger'}>
            {current.confirmLabel ?? t('Đồng ý')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
