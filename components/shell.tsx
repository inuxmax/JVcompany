'use client';
// Khung ứng dụng: thanh menu dọc bên trái (máy tính, thu gọn được), thanh trên + thanh tab dưới (điện thoại).
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import clsx from 'clsx';
import {
  Activity,
  BookOpen,
  Briefcase,
  Cable,
  CalendarClock,
  ChevronDown,
  History,
  Network,
  Package,
  Sparkles,
  Target,
  Wallet,
  Building2,
  Ellipsis,
  FlaskConical,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  UserCog,
  X,
} from 'lucide-react';
import type { DashboardStats, SystemHealth } from '@/lib/types';
import { useLive } from '@/lib/client/live';
import { Dot } from './ui';
import { CompanySwitcher } from './company-switcher';
import { UserMenu } from './user-menu';
import { LanguageSwitch } from './language-switch';
import { m, t, tc } from '@/lib/i18n';

type BadgeKey = 'approvals' | 'inbox';
const NAV: { href: string; label: string; icon: typeof Inbox; badge?: BadgeKey }[] = [
  { href: '/', label: m('Tổng quan'), icon: LayoutDashboard },
  { href: '/inbox', label: m('Hộp thư'), icon: Inbox, badge: 'inbox' },
  { href: '/office', label: m('Văn phòng'), icon: Building2 },
  { href: '/projects', label: m('Dự án'), icon: FolderKanban },
  { href: '/tasks', label: m('Nhiệm vụ'), icon: ListChecks },
  { href: '/providers', label: m('Kết nối AI'), icon: PlugZap },
  { href: '/settings', label: m('Cài đặt'), icon: Settings },
  { href: '/guide', label: m('Hướng dẫn'), icon: BookOpen },
];
const MOBILE_PRIMARY = ['/', '/office', '/inbox', '/projects'];

/** Nhóm trang mới (theo Paperclip): công ty và vận hành. */
const GROUPS = [
  {
    label: m('Công ty'),
    icon: Briefcase,
    items: [
      { href: '/goals', label: m('Mục tiêu'), icon: Target },
      { href: '/org', label: m('Sơ đồ tổ chức'), icon: Network },
      { href: '/skills', label: m('Kỹ năng'), icon: Sparkles },
      { href: '/plugins', label: m('Kho kỹ năng & plugin'), icon: Package },
      { href: '/connections', label: m('Kết nối dịch vụ'), icon: Cable },
      { href: '/accounts', label: m('Tài khoản & phân quyền'), icon: UserCog },
      { href: '/company', label: m('Công ty & dữ liệu'), icon: Briefcase },
    ],
  },
  {
    label: m('Vận hành'),
    icon: Activity,
    items: [
      { href: '/approvals', label: m('Phê duyệt'), icon: ShieldCheck },
      { href: '/routines', label: m('Lịch định kỳ'), icon: CalendarClock },
      { href: '/costs', label: m('Chi phí & ngân sách'), icon: Wallet },
      { href: '/evals', label: m('Đánh giá agent'), icon: FlaskConical },
      { href: '/activity', label: m('Nhật ký hoạt động'), icon: History },
    ],
  },
];

/** Giá trị nhỏ lưu trong trình duyệt (trạng thái menu), đồng bộ giữa các thành phần và các tab. */
const storeListeners = new Set<() => void>();

function subscribeStore(cb: () => void) {
  storeListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    storeListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function useStored(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(subscribeStore, () => readStored(key, fallback), () => fallback);
  const set = (v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* bỏ qua */
    }
    storeListeners.forEach((l) => l());
  };
  return [value, set];
}

/** Một mục của thanh menu dọc. */
function SideLink({
  href,
  label,
  icon: Icon,
  badge = 0,
  active,
  collapsed,
  nested,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof Inbox;
  badge?: number;
  active: boolean;
  collapsed: boolean;
  nested?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'relative flex h-10 items-center gap-3 rounded-2xl text-[13.5px] font-medium transition-colors',
        collapsed ? 'justify-center' : nested ? 'pr-3 pl-9' : 'px-3',
        active ? 'bg-surface-solid text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface-3 hover:text-fg',
      )}
    >
      <Icon className={clsx('shrink-0', nested ? 'size-4' : 'size-[18px]', active && 'text-accent')} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {badge > 0 &&
        (collapsed ? (
          <span className="absolute top-0.5 right-1 min-w-4 rounded-full bg-warn px-1 text-center text-[9.5px] leading-4 font-bold text-[#1a1003]">{badge}</span>
        ) : (
          <span className="rounded-full bg-warn px-1.5 text-[10.5px] font-bold text-[#1a1003]">{badge}</span>
        ))}
    </Link>
  );
}

/** Nhóm trang trong thanh menu dọc: mở rộng tại chỗ; khi menu thu gọn thì hiện bảng nổi sang phải. */
function SideGroup({ group, pathname, collapsed }: { group: (typeof GROUPS)[number]; pathname: string; collapsed: boolean }) {
  const active = group.items.some((i) => pathname.startsWith(i.href));
  // '' = tự động (mở khi đang ở trang trong nhóm), '1' mở, '0' đóng – nhớ theo trình duyệt
  const [pref, setPref] = useStored(`jv-nav-group:${group.label}`, '');
  const open = pref === '' ? active : pref === '1';
  const [flyout, setFlyout] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flyout) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setFlyout(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [flyout]);

  if (collapsed) {
    return (
      <div ref={box} className="relative">
        <button
          type="button"
          onClick={() => setFlyout((o) => !o)}
          aria-expanded={flyout}
          title={t(group.label)}
          className={clsx(
            'flex h-10 w-full items-center justify-center rounded-2xl transition-colors',
            active ? 'bg-surface-solid text-accent shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface-3 hover:text-fg',
          )}
        >
          <group.icon className="size-[18px]" />
        </button>
        {flyout && (
          <div className="animate-jv-in absolute top-0 left-full z-50 ml-3 w-56 rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl">
            <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{t(group.label)}</div>
            {group.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setFlyout(false)}
                className={clsx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px]', pathname.startsWith(i.href) ? 'bg-surface-3 font-medium text-fg' : 'text-muted hover:bg-surface-3 hover:text-fg')}
              >
                <i.icon className="size-4" />
                {t(i.label)}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setPref(open ? '0' : '1')}
        aria-expanded={open}
        className={clsx('flex h-10 w-full items-center gap-3 rounded-2xl px-3 text-[13.5px] font-medium transition-colors hover:bg-surface-3', active ? 'text-fg' : 'text-muted hover:text-fg')}
      >
        <group.icon className={clsx('size-[18px] shrink-0', active && 'text-accent')} />
        <span className="flex-1 text-left">{t(group.label)}</span>
        <ChevronDown className={clsx('size-4 text-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.items.map((i) => (
            <SideLink key={i.href} href={i.href} label={t(i.label)} icon={i.icon} active={pathname.startsWith(i.href)} collapsed={false} nested />
          ))}
        </div>
      )}
    </div>
  );
}

/** Trạng thái hệ thống ở chân thanh menu dọc (bảng chi tiết bật lên phía trên / bên phải). */
function SideStatus({ collapsed }: { collapsed: boolean }) {
  const { ok, data } = useHealth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const active = data?.worker.activeTasks ?? 0;
  const text = active > 0 ? t('{n} agent đang làm', { n: active }) : ok ? t('Hệ thống sẵn sàng') : t('Kiểm tra hệ thống');
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={text}
        aria-label={t('Trạng thái hệ thống')}
        className={clsx('flex h-10 w-full items-center gap-2.5 rounded-2xl bg-surface-3 text-[12.5px] font-medium transition-colors hover:bg-line-strong', collapsed ? 'justify-center' : 'px-3')}
      >
        <Dot color={data ? (ok ? '#5C9A68' : '#C9952F') : '#958B7E'} pulse={active > 0} />
        {!collapsed && <span className="truncate">{text}</span>}
      </button>
      {open && (
        <div className={clsx('glass animate-jv-in absolute z-50 w-64 rounded-3xl p-4', collapsed ? 'left-full bottom-0 ml-3' : 'left-0 bottom-full mb-2')}>
          <div className="mb-3 text-[12px] font-semibold tracking-wider text-subtle uppercase">{t('Hệ thống')}</div>
          <StatusPanel />
        </div>
      )}
    </div>
  );
}

/** Thanh menu dọc bên trái (màn hình máy tính). Thu gọn thành cột biểu tượng; bề rộng lấy từ biến --jv-nav-w. */
function SideNav() {
  const pathname = usePathname();
  const badges = useBadges();
  const [nav, setNav] = useStored('jv-nav', 'open');
  const collapsed = nav === 'collapsed';
  useEffect(() => {
    document.documentElement.dataset.nav = collapsed ? 'collapsed' : 'open';
  }, [collapsed]);
  return (
    <aside
      aria-label={t('Điều hướng')}
      className="glass fixed top-3 bottom-3 left-3 z-40 hidden w-[calc(var(--jv-nav-w)-28px)] flex-col rounded-[28px] transition-[width] duration-200 lg:flex"
    >
      <div className={clsx('flex items-center gap-2 px-3 pt-3', collapsed ? 'flex-col' : 'justify-between')}>
        <Logo always={!collapsed} compact={collapsed} />
        <button
          type="button"
          onClick={() => setNav(collapsed ? 'open' : 'collapsed')}
          title={collapsed ? t('Mở rộng menu') : t('Thu gọn menu')}
          aria-label={collapsed ? t('Mở rộng menu') : t('Thu gọn menu')}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:bg-surface-3 hover:text-fg"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <div className="space-y-2 px-3 pt-3">
        {!collapsed && <CompanySwitcher block />}
        <Link
          href="/projects/new"
          title={t('Dự án mới')}
          className={clsx(
            'flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-accent text-[13.5px] font-semibold whitespace-nowrap text-accent-fg shadow-sm transition hover:brightness-110',
            !collapsed && 'px-4',
          )}
        >
          <Plus className="size-4" />
          {!collapsed && t('Dự án mới')}
        </Link>
      </div>
      <nav className={clsx('mt-3 flex-1 space-y-0.5 px-3 pb-3', !collapsed && 'overflow-y-auto [scrollbar-width:thin]')}>
        {NAV.map((item) => (
          <SideLink
            key={item.href}
            href={item.href}
            label={t(item.label)}
            icon={item.icon}
            badge={item.badge ? badges[item.badge] : 0}
            active={isActive(pathname, item.href)}
            collapsed={collapsed}
          />
        ))}
        <div className="my-2 border-t border-line" />
        {GROUPS.map((g) => (
          <SideGroup key={g.label} group={g} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>
      <div className="space-y-2 border-t border-line p-3">
        <div className={clsx('flex items-center gap-2', collapsed && 'flex-col')}>
          <UserMenu placement="up" />
          <div className={clsx('min-w-0', collapsed ? 'w-full' : 'flex-1')}>
            <SideStatus collapsed={collapsed} />
          </div>
        </div>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <ThemeSwitch vertical />
            <LanguageSwitch compact placement="right" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pl-1">
              <span className="text-[12.5px] text-subtle">{t('Giao diện')}</span>
              <ThemeSwitch />
            </div>
            <div className="flex items-center justify-between gap-2 pl-1">
              <span className="text-[12.5px] text-subtle">{t('Ngôn ngữ')}</span>
              <LanguageSwitch placement="up" />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

type ThemeChoice = 'dark' | 'light' | 'system';

function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

const themeListeners = new Set<() => void>();

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    themeListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function readTheme(): ThemeChoice {
  try {
    return (localStorage.getItem('jv-theme') as ThemeChoice) || 'light';
  } catch {
    return 'light';
  }
}

/**
 * Đổi giao diện có hiệu ứng: giao diện mới loang ra thành vòng tròn từ chỗ bấm (View Transitions – trang mới là
 * bản "sống" nên cảnh 3D cũng chuyển ngày → đêm ngay trong vòng tròn). Trình duyệt không hỗ trợ → màu chuyển mượt;
 * bật "giảm chuyển động" → đổi ngay.
 */
function switchTheme(choice: ThemeChoice, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  const apply = () => {
    applyTheme(choice);
    themeListeners.forEach((l) => l());
  };
  const next = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  if (root.dataset.theme === next || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return apply();
  if (typeof document.startViewTransition !== 'function') {
    root.classList.add('theme-fade');
    apply();
    window.setTimeout(() => root.classList.remove('theme-fade'), 650);
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.dataset.themeAnim = '1';
  const vt = document.startViewTransition(apply);
  vt.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => undefined);
  vt.finished.finally(() => delete root.dataset.themeAnim).catch(() => undefined);
}

function useTheme() {
  const choice = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as ThemeChoice);
  const set = (c: ThemeChoice, origin?: { x: number; y: number }) => {
    try {
      localStorage.setItem('jv-theme', c);
    } catch {
      /* bỏ qua */
    }
    switchTheme(c, origin);
  };
  return [choice, set] as const;
}

const THEME_OPTS: { v: ThemeChoice; icon: typeof Sun; label: string }[] = [
  { v: 'light', icon: Sun, label: m('Sáng') },
  { v: 'dark', icon: Moon, label: m('Tối') },
  { v: 'system', icon: Monitor, label: m('Theo hệ thống') },
];

function ThemeSwitch({ vertical }: { vertical?: boolean }) {
  const [choice, set] = useTheme();
  return (
    <div className={clsx('flex gap-0.5 rounded-full bg-surface-3 p-0.5', vertical && 'flex-col')}>
      {THEME_OPTS.map((o) => (
        <button
          key={o.v}
          type="button"
          title={t(o.label)}
          aria-label={t(o.label)}
          onClick={(e) => set(o.v, { x: e.clientX, y: e.clientY })}
          className={clsx(
            'flex size-7 items-center justify-center rounded-full transition-all',
            choice === o.v ? 'bg-surface-solid text-fg shadow' : 'text-subtle hover:text-fg',
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function Logo({ compact, always }: { compact?: boolean; always?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 pl-1">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-fg font-display text-[15px] font-semibold text-bg italic">
        jv
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-[3px] bg-accent ring-2 ring-[var(--surface)]" />
      </span>
      {!compact && (
        <span className={clsx('leading-none', always ? 'block' : 'hidden xl:block')}>
          <span className="block font-display text-[16px] font-semibold tracking-tight">JVCompany</span> {/* i18n-ignore: tên sản phẩm */}
          <span className="mt-0.5 block text-[10.5px] tracking-[0.14em] text-subtle uppercase">{t('Công ty AI Agent')}</span>
        </span>
      )}
    </Link>
  );
}

function useHealth() {
  const { data } = useSWR<SystemHealth>('/api/health', { refreshInterval: 10_000 });
  const { connected } = useLive();
  const ok = Boolean(data?.db.ok && data.worker.running && data.worker.enabled && connected);
  return { data, connected, ok };
}

function StatusPanel() {
  const { data, connected } = useHealth();
  const rows = [
    { label: 'MongoDB', ok: data?.db.ok, text: data ? (data.db.ok ? t('Đã kết nối') : t('Mất kết nối')) : '…' },
    {
      label: 'Agent worker',
      ok: data?.worker.running && data.worker.enabled,
      text: data ? (data.worker.enabled ? t('{n} đang chạy', { n: data.worker.activeTasks }) : tc('status', 'Tạm dừng')) : '…',
    },
    { label: 'Realtime', ok: connected, text: connected ? t('Trực tuyến') : t('Đang nối…') },
  ];
  return (
    <div className="space-y-2 text-[12.5px]">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-6">
          <span className="text-muted">{r.label}</span>
          <span className="flex items-center gap-1.5">
            <Dot color={r.ok == null ? '#958B7E' : r.ok ? '#5C9A68' : '#C4483F'} />
            {r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusButton() {
  const { ok, data } = useHealth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const active = data?.worker.activeTasks ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-surface-3 px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors hover:bg-line-strong"
        aria-label={t('Trạng thái hệ thống')}
        title={active > 0 ? t('{n} agent đang làm', { n: active }) : ok ? t('Sẵn sàng') : t('Kiểm tra hệ thống')}
      >
        <Dot color={data ? (ok ? '#5C9A68' : '#C9952F') : '#958B7E'} pulse={active > 0} />
        {/* Màn hình vừa: chỉ số agent; rộng: kèm chữ */}
        <span className="hidden sm:inline xl:hidden">{active > 0 ? active : ok ? 'OK' : '!'}</span>
        <span className="hidden xl:inline">{active > 0 ? t('{n} agent đang làm', { n: active }) : ok ? t('Sẵn sàng') : t('Kiểm tra')}</span>
      </button>
      {open && (
        <div className="glass animate-jv-in absolute top-12 right-0 z-50 w-64 rounded-3xl p-4">
          <div className="mb-3 text-[12px] font-semibold tracking-wider text-subtle uppercase">{t('Hệ thống')}</div>
          <StatusPanel />
        </div>
      )}
    </div>
  );
}

/** Số trên huy hiệu: phê duyệt đang chờ, mục hộp thư chưa đọc. */
function useBadges(): Record<BadgeKey, number> {
  const { data } = useSWR<{ stats: DashboardStats }>('/api/overview');
  const { data: inbox } = useSWR<{ unread: number }>('/api/inbox?summary=1', { refreshInterval: 60_000 });
  return { approvals: data?.stats.approvalsPending ?? 0, inbox: inbox?.unread ?? 0 };
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Thanh trên cho màn hình nhỏ (máy tính dùng thanh menu dọc bên trái). */
function TopBar() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 lg:hidden">
      <div className="glass mx-auto flex h-[60px] max-w-[1600px] items-center gap-2 rounded-full px-2.5">
        <Logo />
        <div className="hidden md:block">
          <CompanySwitcher />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusButton />
          <div className="hidden sm:block">
            <ThemeSwitch />
          </div>
          <div className="hidden sm:block">
            <LanguageSwitch compact placement="down" />
          </div>
          <Link
            href="/projects/new"
            title={t('Dự án mới')}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[13.5px] font-semibold whitespace-nowrap text-accent-fg shadow-sm transition hover:brightness-110"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{tc('new', 'Dự án')}</span>
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function MobileTabs() {
  const pathname = usePathname();
  const badges = useBadges();
  const [more, setMore] = useState(false);
  const primary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.href));
  const rest = [...NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href)), ...GROUPS.flatMap((g) => g.items)];
  const moreActive = rest.some((n) => isActive(pathname, n.href));
  return (
    <>
      <nav className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
        <div className="glass mx-auto flex h-16 max-w-md items-center justify-around rounded-full px-2">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx('relative flex w-16 flex-col items-center gap-0.5 rounded-full py-1.5 text-[10.5px] font-medium', active ? 'text-fg' : 'text-subtle')}
              >
                <span className={clsx('flex size-8 items-center justify-center rounded-full transition-all', active && 'bg-accent text-accent-fg')}>
                  <item.icon className="size-4" />
                </span>
                {t(item.label)}
                {item.badge && badges[item.badge] > 0 && (
                  <span className="absolute top-0 right-2 rounded-full bg-warn px-1 text-[9.5px] font-bold text-[#1a1003]">{badges[item.badge]}</span>
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMore(true)}
            className={clsx('flex w-16 flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium', moreActive ? 'text-fg' : 'text-subtle')}
          >
            <span className={clsx('flex size-8 items-center justify-center rounded-full', moreActive && 'bg-accent text-accent-fg')}>
              <Ellipsis className="size-4" />
            </span>
            {tc('nav', 'Khác')}
          </button>
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[#1a140e]/40 backdrop-blur-sm" onClick={() => setMore(false)} />
          <div className="animate-jv-in absolute inset-x-3 bottom-3 rounded-[28px] border border-line bg-surface-solid/95 p-4 shadow-2xl backdrop-blur-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[16px] font-semibold">{tc('nav', 'Thêm')}</span>
              <button type="button" aria-label={t('Đóng')} onClick={() => setMore(false)} className="rounded-full p-1.5 text-muted hover:bg-surface-3">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rest.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMore(false)}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 rounded-3xl border border-line p-3 text-[12px] font-medium',
                    isActive(pathname, item.href) ? 'bg-surface-3 text-fg' : 'text-muted',
                  )}
                >
                  <item.icon className="size-5" />
                  {t(item.label)}
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <CompanySwitcher compact />
            </div>
            <div className="mt-3 rounded-3xl border border-line p-4">
              <StatusPanel />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[13px] text-muted">{t('Giao diện')}</span>
              <ThemeSwitch />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[13px] text-muted">{t('Ngôn ngữ')}</span>
              <LanguageSwitch placement="up" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Cơ sở dữ liệu còn trống / đang thiết lập dở → chuyển tới màn hình thiết lập ban đầu. */
function useSetupGate(pathname: string): boolean {
  const router = useRouter();
  const { data } = useSWR<{ needsSetup: boolean }>('/api/setup', { revalidateOnFocus: false });
  const redirect = Boolean(data?.needsSetup) && !pathname.startsWith('/setup') && pathname !== '/login';
  useEffect(() => {
    if (redirect) router.replace('/setup');
  }, [redirect, router]);
  return redirect;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const redirecting = useSetupGate(pathname);
  // Màn hình thiết lập / đăng nhập chiếm trọn trang, không có thanh điều hướng
  if (pathname.startsWith('/setup') || pathname === '/login') return <main className="min-h-screen">{children}</main>;
  if (redirecting) return <div className="min-h-screen" />;
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="min-w-0 flex-1 pb-28 lg:pl-[var(--jv-nav-w)] lg:pb-10">{children}</main>
      <SideNav />
      <MobileTabs />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  breadcrumb,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  breadcrumb?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-2 text-[13px] text-muted">{breadcrumb}</div>}
        {eyebrow && <div className="mb-2 text-[11.5px] font-semibold tracking-[0.18em] text-accent uppercase">{eyebrow}</div>}
        <div className="flex items-center gap-3">
          {icon}
          <h1 className="font-display text-[30px] leading-[1.1] font-semibold tracking-tight sm:text-[36px]">{title}</h1>
        </div>
        {description && <p className="mt-2 max-w-2xl text-[14.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** `full`: dùng hết bề rộng màn hình (vd trang Toà nhà). */
export function Page({ children, wide, full }: { children: ReactNode; wide?: boolean; full?: boolean }) {
  return (
    <div
      className={clsx(
        'mx-auto w-full px-4 sm:px-6 lg:px-8',
        full ? 'max-w-none py-5 lg:py-6' : 'py-7 lg:py-9',
        !full && (wide ? 'max-w-[1600px]' : 'max-w-[1320px]'),
      )}
    >
      {children}
    </div>
  );
}
