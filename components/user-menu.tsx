'use client';
// Menu tài khoản trên thanh điều hướng (chỉ hiện khi đã bật đăng nhập): vai trò, đổi mật khẩu, đăng xuất.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { KeyRound, LogOut, UserCog } from 'lucide-react';
import type { User, UserRole } from '@/lib/types';
import { api } from '@/lib/client/api';
import { Button, Field, Input, Modal, toast } from './ui';
import { localize, t } from '@/lib/i18n';

export const ROLE_LABEL: Record<UserRole, string> = localize({ owner: 'Chủ sở hữu', admin: 'Quản trị', member: 'Thành viên', viewer: 'Chỉ xem' });

export function useMe() {
  const { data } = useSWR<{ authEnabled: boolean; user: User | null }>('/api/auth/me', { revalidateOnFocus: false });
  return data;
}

/** `placement="up"`: bảng mở lên trên (ở chân thanh menu dọc). */
export function UserMenu({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!me?.authEnabled || !me.user) return null;
  const u = me.user;
  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => null);
    // Tải lại toàn trang (xoá dữ liệu đã đệm của phiên cũ)
    window.location.assign(new URL('/login', window.location.href));
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-full bg-fg font-display text-[14px] font-semibold text-bg"
        aria-label={t('Tài khoản: {name}', { name: u.name })}
        title={`${u.name} · ${ROLE_LABEL[u.role]}`}
      >
        {u.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className={`animate-vp-in absolute z-50 w-64 rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl ${placement === 'up' ? 'bottom-full left-0 mb-2' : 'top-12 right-0'}`}>
          <div className="px-3 py-2">
            <div className="truncate text-[14px] font-semibold">{u.name}</div>
            <div className="truncate text-[12px] text-muted">{u.email}</div>
            <div className="mt-1 text-[11.5px] font-medium text-accent">{ROLE_LABEL[u.role]}</div>
          </div>
          <div className="my-1 border-t border-line" />
          {(u.role === 'owner' || u.role === 'admin') && (
            <Link href="/accounts" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted hover:bg-surface-3 hover:text-fg">
              <UserCog className="size-4" /> {t('Tài khoản & phân quyền')}
            </Link>
          )}
          <button type="button" onClick={() => (setOpen(false), setPw(true))} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted hover:bg-surface-3 hover:text-fg">
            <KeyRound className="size-4" /> {t('Đổi mật khẩu')}
          </button>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted hover:bg-surface-3 hover:text-fg">
            <LogOut className="size-4" /> {t('Đăng xuất')}
          </button>
        </div>
      )}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </div>
  );
}

export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (next !== again) return toast.error(t('Hai lần nhập mật khẩu mới không khớp'));
    setBusy(true);
    try {
      await api.post('/api/auth/password', { current, next });
      toast.success(t('Đã đổi mật khẩu – các phiên đăng nhập khác đã bị đăng xuất'));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('Đổi mật khẩu')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!current || next.length < 8} onClick={save}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('Mật khẩu hiện tại')}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={t('Mật khẩu mới')} hint={t('Tối thiểu 8 ký tự.')}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label={t('Nhập lại mật khẩu mới')}>
          <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
