'use client';
// Đăng nhập (chỉ cần khi đã tạo tài khoản ở "Tài khoản & phân quyền").
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { LogIn } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { t } from '@/lib/i18n';

function LoginForm() {
  const params = useSearchParams();
  const { data } = useSWR<{ authEnabled: boolean; user: unknown }>('/api/auth/me');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      // Tải lại toàn trang để mọi dữ liệu dùng phiên mới
      window.location.href = target;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="relative flex size-11 items-center justify-center rounded-2xl bg-fg font-display text-[18px] font-semibold text-bg italic">
            vp
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-[4px] bg-accent ring-2 ring-[var(--bg)]" />
          </span>
          <div>
            <div className="font-display text-[22px] leading-none font-semibold tracking-tight">Văn Phòng AI</div> {/* i18n-ignore: tên sản phẩm */}
            <div className="mt-1 text-[12px] tracking-[0.14em] text-subtle uppercase">{t('Đăng nhập')}</div>
          </div>
        </div>
        {data && !data.authEnabled ? (
          <div className="rounded-3xl border border-line bg-surface p-6 text-[14px]">
            <p className="text-muted">{t('Văn phòng chưa bật đăng nhập – ai dùng máy này cũng vào được. Tạo tài khoản ở “Tài khoản & phân quyền” để bật.')}</p>
            <Link href="/" className="mt-4 inline-block font-medium text-accent hover:underline">
              {t('Vào văn phòng →')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            </Field>
            <Field label={t('Mật khẩu')}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<LogIn className="size-4" />}>
              {t('Đăng nhập')}
            </Button>
            <p className="text-center text-[12px] text-subtle">{t('Quên mật khẩu? Nhờ Chủ sở hữu đặt lại trong “Tài khoản & phân quyền”.')}</p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
