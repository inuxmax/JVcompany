'use client';
// Tài khoản & phân quyền: bật đăng nhập (tạo Chủ sở hữu), thêm người, đổi vai trò, khoá, đặt lại mật khẩu, giới hạn công ty.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Lock, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import type { Company, User, UserRole } from '@/lib/types';
import { api } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, confirmDialog, toast } from '@/components/ui';
import { ROLE_LABEL } from '@/components/user-menu';
import { localize, t } from '@/lib/i18n';

interface Resp {
  authEnabled: boolean;
  me: User | null;
  users: User[];
}

const ROLE_HELP: Record<UserRole, string> = localize({
  owner: 'Toàn quyền, kể cả quản lý tài khoản.',
  admin: 'Mọi thứ trừ tài khoản: kết nối AI, bí mật, cài đặt, phòng ban, ngân sách…',
  member: 'Làm việc hằng ngày: chat, dự án, nhiệm vụ, phê duyệt, tài liệu, đánh giá. Không đổi cấu hình công ty.',
  viewer: 'Chỉ xem, không thay đổi được gì.',
});
const ROLE_COLOR: Record<UserRole, string> = { owner: '#C4532A', admin: '#4A86BD', member: '#5C9A68', viewer: '#958B7E' };

export default function AccountsPage() {
  const { data, error } = useSWR<Resp>('/api/users');
  const { data: companies } = useSWR<{ companies: Company[] }>('/api/companies');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const isOwner = !data?.authEnabled || data.me?.role === 'owner';

  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Tài khoản & phân quyền')}
        description={t('Mỗi người một tài khoản với vai trò riêng. Khi đã có tài khoản, mọi người phải đăng nhập mới vào được văn phòng.')}
        icon={<UserCog className="size-7 text-accent" />}
        actions={
          data?.authEnabled && isOwner ? (
            <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>
              {t('Thêm tài khoản')}
            </Button>
          ) : undefined
        }
      />
      {error ? (
        <Card className="p-6 text-[14px] text-muted">{String(error.message ?? error)}</Card>
      ) : !data ? (
        <Skeleton className="h-48" />
      ) : !data.authEnabled ? (
        <EnableAuth />
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
              <div key={r} className="rounded-2xl border border-line p-3 text-[12.5px]">
                <Badge color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Badge>
                <p className="mt-1.5 text-muted">{ROLE_HELP[r]}</p>
              </div>
            ))}
          </div>
          <Card className="divide-y divide-line">
            {data.users.map((u) => (
              <div key={u._id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', u.status === 'disabled' && 'opacity-60')}>
                <span className="flex size-9 items-center justify-center rounded-full bg-fg font-display text-[14px] font-semibold text-bg">{u.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{u.name}</span>
                    <Badge color={ROLE_COLOR[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                    {u.status === 'disabled' && (
                      <Badge color="#958B7E">
                        <Lock className="size-3" /> {t('Đã khoá')}
                      </Badge>
                    )}
                    {u._id === data.me?._id && <Badge color="#8A7DAE">{t('bạn')}</Badge>}
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {u.email} · {u.companies.length ? t('{n} công ty', { n: u.companies.length }) : t('mọi công ty')} · {u.lastLoginAt ? t('đăng nhập {time}', { time: timeAgo(u.lastLoginAt) }) : t('chưa đăng nhập')}
                  </div>
                </div>
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                    {t('Sửa')}
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
      {adding && <UserForm companies={companies?.companies ?? []} onClose={() => setAdding(false)} />}
      {editing && <UserForm user={editing} me={data?.me ?? null} companies={companies?.companies ?? []} onClose={() => setEditing(null)} />}
    </Page>
  );
}

/** Chưa bật đăng nhập: tạo tài khoản Chủ sở hữu đầu tiên. */
function EnableAuth() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await api.post('/api/users', { name, email, password });
      toast.success(t('Đã bật đăng nhập – bạn đang đăng nhập bằng tài khoản Chủ sở hữu'));
      window.location.reload();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-xl p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <h3 className="text-[16px] font-semibold">{t('Chưa bật đăng nhập')}</h3>
          <p className="mt-1 text-[13.5px] text-muted">{t('Hiện ai dùng máy này (hoặc có khoá truy cập mạng LAN) cũng vào được văn phòng. Tạo tài khoản Chủ sở hữu đầu tiên để bắt buộc đăng nhập, rồi thêm tài khoản cho người khác với vai trò phù hợp.')}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        <Field label={t('Tên của bạn')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" required>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('Mật khẩu')} hint={t('Tối thiểu 8 ký tự. Ghi nhớ kỹ – nếu quên phải có Chủ sở hữu khác đặt lại.')} required>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button variant="primary" loading={busy} disabled={!name.trim() || !email.trim() || password.length < 8} onClick={create}>
          {t('Tạo Chủ sở hữu & bật đăng nhập')}
        </Button>
      </div>
    </Card>
  );
}

function UserForm({ user, me, companies, onClose }: { user?: User; me?: User | null; companies: Company[]; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'member');
  const [password, setPassword] = useState('');
  const [scope, setScope] = useState<string[]>(user?.companies ?? []);
  const [busy, setBusy] = useState(false);
  const self = user && me && user._id === me._id;
  const save = async (extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      if (user) await api.patch(`/api/users/${user._id}`, { name, role, companies: scope, ...(password ? { password } : {}), ...extra });
      else await api.post('/api/users', { name, email, password, role, companies: scope });
      await mutate('/api/users');
      toast.success(user ? t('Đã lưu tài khoản') : t('Đã tạo tài khoản – gửi email và mật khẩu cho người đó'));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!user || !(await confirmDialog({ title: t('Xoá tài khoản {name}?', { name: user.name }), message: t('Người này sẽ không đăng nhập được nữa. Nhật ký cũ vẫn giữ tên họ.'), confirmLabel: t('Xoá'), tone: 'danger' }))) return;
    try {
      await api.del(`/api/users/${user._id}`);
      await mutate('/api/users');
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={user ? t('Tài khoản {name}', { name: user.name }) : t('Thêm tài khoản')}
      footer={
        <>
          {user && !self && (
            <>
              <Button variant="ghost" className="mr-auto text-danger" onClick={remove} icon={<Trash2 className="size-4" />}>
                {t('Xoá')}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => save({ status: user.status === 'active' ? 'disabled' : 'active' })} icon={<Lock className="size-4" />}>
                {user.status === 'active' ? t('Khoá') : t('Mở khoá')}
              </Button>
            </>
          )}
          <Button variant="primary" loading={busy} disabled={!name.trim() || (!user && (!email.trim() || password.length < 8))} onClick={() => save()}>
            {user ? t('Lưu') : t('Tạo tài khoản')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('Tên hiển thị')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!user && (
          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <Field label={t('Vai trò')} hint={ROLE_HELP[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={Boolean(self)}>
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? t('Đặt lại mật khẩu') : t('Mật khẩu')} hint={user ? t('Để trống = giữ nguyên. Đặt lại sẽ đăng xuất người đó khỏi mọi thiết bị.') : t('Tối thiểu 8 ký tự.')}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        {companies.length > 1 && (
          <Field label={t('Công ty được vào')} hint={t('Không chọn = mọi công ty.')}>
            <div className="flex flex-wrap gap-1.5">
              {companies.map((c) => {
                const on = scope.includes(c._id);
                return (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => setScope((s) => (on ? s.filter((x) => x !== c._id) : [...s, c._id]))}
                    className={clsx('rounded-full border px-3 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface-2')}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
