'use client';
// Danh bạ kết nối dựng sẵn (giống "Connectors" của Claude): máy chủ MCP từ xa đăng nhập OAuth / token, hoặc chạy trên máy –
// thêm một chạm. Chữ cái đại diện thay cho logo thương hiệu.
import { useState } from 'react';
import { mutate } from 'swr';
import { Check, ExternalLink, KeyRound, LogIn, Plus, Search, Star } from 'lucide-react';
import type { Department, McpConnection } from '@/lib/types';
import { CONNECTOR_CATEGORIES, CONNECTOR_DIRECTORY, type ConnectorCategory, type DirectoryConnector } from '@/lib/connector-directory';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Modal, cx, toast } from './ui';

const KEY = '/api/connections';

export function ConnectorMonogram({ name, color, className }: { name: string; color: string; className?: string }) {
  const letters = name
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold', className)} style={{ background: `${color}1f`, color }}>
      {letters}
    </span>
  );
}

/**
 * Đăng nhập OAuth cho một kết nối: mở cửa sổ nhà cung cấp, chờ trang /api/connections/oauth/callback báo về (postMessage) hoặc cửa sổ đóng.
 * Mở cửa sổ ngay trong lần bấm (tránh bị chặn popup), sau đó mới gán địa chỉ.
 */
export async function oauthLogin(connId: string, name: string): Promise<boolean> {
  const popup = window.open('', 'jv-oauth', 'width=560,height=720');
  try {
    const { url } = await api.patch<{ url: string }>(`${KEY}/${connId}`, { action: 'oauth-start' });
    if (!popup) {
      // Trình duyệt chặn cửa sổ bật lên → đăng nhập ngay trong tab này; trang callback tự quay về Kết nối dịch vụ
      toast(t('Đang chuyển sang trang đăng nhập…'));
      window.location.assign(url);
      return false;
    }
    popup.location.replace(url);
  } catch (e) {
    popup?.close();
    toast.error(e);
    return false;
  }
  const ok = await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      resolve(v);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === 'jv-oauth') finish(Boolean(e.data.ok));
    };
    window.addEventListener('message', onMessage);
    // Đóng cửa sổ mà không báo → kiểm tra lại trạng thái từ máy chủ
    const timer = setInterval(() => {
      if (popup.closed) finish(false);
    }, 800);
  });
  const fresh = await api.get<McpConnection>(`${KEY}/${connId}`).catch(() => null);
  await mutate(KEY);
  if (ok || fresh?.oauth?.connectedAt) {
    toast.success(t('{name} đã kết nối – {n} thao tác', { name, n: fresh?.tools.length ?? 0 }));
    return true;
  }
  toast(t('Chưa đăng nhập {name}.', { name }));
  return false;
}

function AuthBadge({ dc }: { dc: DirectoryConnector }) {
  if (dc.auth === 'oauth') return <Badge color="#4A86BD">{t('Đăng nhập')}</Badge>;
  if (dc.auth === 'fields') return <Badge color="#9A7B3F">{t('Token / thông số')}</Badge>;
  return <Badge color="#5E8C61">{t('Dùng ngay')}</Badge>;
}

function AddModal({ dc, departments, onClose }: { dc: DirectoryConnector; departments: Department[]; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [depts, setDepts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ connection: McpConnection; needsOAuth: boolean; error?: string }>(KEY, { directoryId: dc.id, values, departments: depts });
      await mutate(KEY);
      onClose();
      if (r.needsOAuth) await oauthLogin(r.connection._id, dc.name);
      else if (r.error) toast.error(t('Đã thêm {name} nhưng chưa kết nối được: {error}', { name: dc.name, error: r.error }));
      else toast.success(t('{name} đã kết nối – {n} thao tác', { name: dc.name, n: r.connection.tools.length }));
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
      size="md"
      title={
        <span className="flex items-center gap-3">
          <ConnectorMonogram name={dc.name} color={dc.color} className="size-9 rounded-xl text-[13px]" />
          {dc.name}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} onClick={add} icon={dc.auth === 'oauth' ? <LogIn className="size-4" /> : <Plus className="size-4" />}>
            {dc.auth === 'oauth' ? t('Thêm & đăng nhập') : t('Thêm kết nối')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-muted">{dc.description}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <AuthBadge dc={dc} />
          <Badge>{dc.transport === 'http' ? t('Máy chủ từ xa') : t('Chạy trên máy')}</Badge>
          {dc.official && <Badge color="#5E8C61">{t('Chính chủ {vendor}', { vendor: dc.vendor })}</Badge>}
          <span className="font-mono text-[11.5px] text-subtle">mcp__{dc.key}__…</span>
        </div>
        {dc.auth === 'oauth' && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
            {t('Bấm thêm → cửa sổ đăng nhập của {vendor} mở ra → bạn đồng ý cấp quyền. Token được lưu mã hoá trong Kho bí mật và tự gia hạn.', { vendor: dc.vendor })}
          </p>
        )}
        {(dc.fields ?? []).map((f) => (
          <Field key={f.key} label={f.label} required={!f.optional} hint={f.help}>
            <Input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className={f.secret || f.target.url ? 'font-mono text-[12.5px]' : undefined}
            />
          </Field>
        ))}
        {dc.transport === 'stdio' && dc.command && (
          <div className="text-[12px] text-muted">
            {t('Lệnh chạy:')} <code className="font-mono break-all">{[dc.command, ...(dc.args ?? [])].join(' ')}</code>
          </div>
        )}
        {dc.note && <p className="text-[12.5px] text-muted">{dc.note}</p>}
        <Field label={t('Phòng được dùng')} hint={t('Không chọn phòng nào = mọi phòng.')}>
          <div className="flex flex-wrap gap-1.5">
            {departments
              .filter((d) => d.enabled)
              .map((d) => {
                const on = depts.includes(d._id);
                return (
                  <button
                    key={d._id}
                    type="button"
                    onClick={() => setDepts((s) => (on ? s.filter((x) => x !== d._id) : [...s, d._id]))}
                    className={cx('rounded-full border px-3 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface-2')}
                  >
                    {t(d.name)}
                  </button>
                );
              })}
          </div>
        </Field>
        <p className="text-[12px] text-subtle">{t('Mặc định mọi thao tác "Hỏi trước"; sau khi kết nối bạn chỉnh quyền từng thao tác ở thẻ kết nối.')}</p>
        {dc.docs && (
          <a href={dc.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
            {t('Tài liệu')} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </Modal>
  );
}

function ConnectorCard({ dc, added, onAdd }: { dc: DirectoryConnector; added: boolean; onAdd: () => void }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <ConnectorMonogram name={dc.name} color={dc.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold">{dc.name}</span>
          {dc.official && <Check className="size-3.5 shrink-0 text-ok" aria-label={t('Chính chủ')} />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{dc.description}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <AuthBadge dc={dc} />
          {dc.auth === 'fields' && <KeyRound className="size-3.5 text-subtle" />}
        </div>
      </div>
      <Button size="xs" variant={added ? 'outline' : 'secondary'} onClick={onAdd} aria-label={t('Thêm {name}', { name: dc.name })} icon={added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}>
        {added ? t('Thêm nữa') : t('Thêm')}
      </Button>
    </Card>
  );
}

export function ConnectorDirectory({ connections, departments }: { connections: McpConnection[]; departments: Department[] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ConnectorCategory | 'all'>('all');
  const [adding, setAdding] = useState<DirectoryConnector | null>(null);
  const added = new Set(connections.map((c) => c.directoryId).filter(Boolean));
  const query = q.trim().toLowerCase();
  const list = CONNECTOR_DIRECTORY.filter((d) => (cat === 'all' || d.category === cat) && (!query || `${d.name} ${d.vendor} ${d.description}`.toLowerCase().includes(query)));
  const popular = CONNECTOR_DIRECTORY.filter((d) => d.popular);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tìm kết nối…')} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...Object.keys(CONNECTOR_CATEGORIES)] as (ConnectorCategory | 'all')[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cx('rounded-full border px-3 py-1 text-[12.5px]', cat === c ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg')}
            >
              {c === 'all' ? t('Tất cả') : CONNECTOR_CATEGORIES[c]}
            </button>
          ))}
        </div>
      </div>
      {!query && cat === 'all' && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
            <Star className="size-4 text-accent" />
            {t('Kết nối phổ biến')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {popular.map((d) => (
              <ConnectorCard key={d.id} dc={d} added={added.has(d.id)} onAdd={() => setAdding(d)} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">{query || cat !== 'all' ? t('Kết quả ({n})', { n: list.length }) : t('Tất cả kết nối')}</h2>
        {!list.length ? (
          <p className="text-[13px] text-muted">{t('Không có kết nối phù hợp – dùng "Tự cấu hình" để thêm máy chủ MCP bất kỳ.')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => (
              <ConnectorCard key={d.id} dc={d} added={added.has(d.id)} onAdd={() => setAdding(d)} />
            ))}
          </div>
        )}
      </section>
      {adding && <AddModal dc={adding} departments={departments} onClose={() => setAdding(null)} />}
    </div>
  );
}
