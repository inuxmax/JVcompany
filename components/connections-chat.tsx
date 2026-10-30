'use client';
// Kênh chat bên ngoài: bot Telegram ↔ cuộc trò chuyện của dự án (duyệt từng cuộc trò chuyện mới bằng mã ghép nối).
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Ban, Check, MessageCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { ChatBinding, ChatConnector, Project } from '@/lib/types';
import { api } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/format';
import { Badge, Button, Card, Dot, EmptyState, Field, Input, Modal, Segmented, Select, Skeleton, Switch, confirmDialog, toast } from './ui';
import { localize, t } from '@/lib/i18n';

const KEY = '/api/connectors';
const STATUS: Record<ChatBinding['status'], { label: string; color: string }> = localize({
  pending: { label: 'Chờ duyệt', color: '#C9952F' },
  active: { label: 'Đang dùng', color: '#5C9A68' },
  blocked: { label: 'Đã chặn', color: '#958B7E' },
});

export function ChatConnectors() {
  const { data } = useSWR<{ connectors: ChatConnector[]; bindings: ChatBinding[] }>(KEY, { refreshInterval: 15_000 });
  const { data: projects } = useSWR<Project[]>('/api/projects');
  const [adding, setAdding] = useState(false);
  const list = data?.connectors ?? [];
  const realProjects = (projects ?? []).filter((p) => !p.internal);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">
          {t('Nhắn văn phòng từ Telegram: tin nhắn thành yêu cầu cho giám đốc, câu trả lời và câu hỏi của agent được gửi lại. Mỗi cuộc trò chuyện mới cần bạn duyệt (mã ghép nối hiện trong Hộp thư).')}
        </p>
        <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>
          {t('Thêm bot Telegram')}
        </Button>
      </div>
      {!data ? (
        <Skeleton className="h-40" />
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={<MessageCircle className="size-6" />}
            title={t('Chưa có kênh chat')}
            description={t('Tạo bot với @BotFather trên Telegram (lệnh /newbot), sao chép mã bot rồi thêm ở đây.')}
            action={<Button variant="primary" onClick={() => setAdding(true)}>{t('Thêm bot Telegram')}</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <ConnectorCard key={c._id} conn={c} bindings={data.bindings.filter((b) => b.connectorId === c._id)} projects={realProjects} />
          ))}
        </div>
      )}
      {adding && <AddConnector onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddConnector({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Telegram');
  const [token, setToken] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const c = await api.post<ChatConnector>(KEY, { name, token, apiBase: apiBase || undefined, requirePairing: true });
      await api.patch(`${KEY}/${c._id}`, { action: 'test' }).catch(() => null);
      await mutate(KEY);
      toast.success(t('Đã thêm bot – nhắn thử cho bot trên Telegram'));
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
      title={t('Thêm bot Telegram')}
      description={t('Mở Telegram, nhắn @BotFather lệnh /newbot, đặt tên rồi sao chép mã bot (dạng 123456:ABC…).')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!token.trim()} onClick={save}>
            {t('Thêm & kiểm tra')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('Tên kênh')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Mã bot')} required hint={t('Lưu mã hoá trong Kho bí mật.')}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="123456789:AA…" />
        </Field>
        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] text-muted">{t('Nâng cao')}</summary>
          <Field label={t('Địa chỉ Bot API')} hint={t('Để trống = https://api.telegram.org (đổi khi dùng máy chủ Bot API riêng).')} className="mt-2">
            <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} className="font-mono" />
          </Field>
        </details>
      </div>
    </Modal>
  );
}

function ConnectorCard({ conn, bindings, projects }: { conn: ChatConnector; bindings: ChatBinding[]; projects: Project[] }) {
  const [token, setToken] = useState('');
  const [defaultProjectId, setDefaultProjectId] = useState(conn.defaultProjectId ?? '');
  const [forward, setForward] = useState(conn.forward);
  const [pairing, setPairing] = useState(conn.requirePairing);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = Boolean(token) || defaultProjectId !== (conn.defaultProjectId ?? '') || forward !== conn.forward || pairing !== conn.requirePairing;

  const patch = async (key: string, body: Record<string, unknown>, msg?: string) => {
    setBusy(key);
    try {
      await api.patch(`${KEY}/${conn._id}`, body);
      await mutate(KEY);
      if (msg) toast.success(msg);
      if (key === 'save') setToken('');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: t('Xoá kênh {name}?', { name: conn.name }), message: t('Các cuộc trò chuyện đã ghép cũng bị xoá. Bot trên Telegram vẫn còn – xoá ở @BotFather nếu không dùng nữa.'), confirmLabel: t('Xoá'), tone: 'danger' }))) return;
    await api.del(`${KEY}/${conn._id}`);
    await mutate(KEY);
  };
  const bind = async (b: ChatBinding, body: Record<string, unknown>) => {
    try {
      await api.patch(`${KEY}/bindings/${b._id}`, body);
      await mutate(KEY);
      await mutate('/api/inbox?summary=1');
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card className={clsx('p-5', !conn.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#4A86BD]/12 text-[#4A86BD]">
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{conn.name}</span>
            {conn.status?.botName && <Badge color="#4A86BD">{conn.status.botName}</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <Dot color={!conn.status ? '#958B7E' : conn.status.ok ? '#5C9A68' : '#C4483F'} pulse={conn.enabled && conn.status?.ok} />
            {conn.status ? `${t(conn.status.message)} · ${timeAgo(conn.status.checkedAt)}` : t('Chưa kiểm tra')}
          </div>
        </div>
        <Button size="sm" variant="outline" loading={busy === 'test'} onClick={() => patch('test', { action: 'test' }, t('Đã kiểm tra'))} icon={<RefreshCw className="size-3.5" />}>
          {t('Kiểm tra')}
        </Button>
        <Switch checked={conn.enabled} onChange={(v) => patch('toggle', { enabled: v })} label={t('Bật kênh')} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label={t('Tin nhắn chưa chọn dự án')} hint={t('Mỗi cuộc trò chuyện tự đổi dự án bằng lệnh /duan.')}>
          <Select value={defaultProjectId} onChange={(e) => setDefaultProjectId(e.target.value)}>
            <option value="">{t('Tạo dự án mới (như chat với CEO)')}</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Gửi về Telegram')}>
          <Segmented
            value={forward}
            onChange={setForward}
            options={[
              { value: 'replies', label: t('Câu trả lời & câu hỏi') },
              { value: 'all', label: t('Cả tiến độ') },
            ]}
          />
        </Field>
        <Field label={t('Đổi mã bot')} hint={conn.hasToken ? t('Để trống = giữ mã hiện tại.') : t('Chưa có mã bot.')}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={conn.hasToken ? '••••••' : '123456789:AA…'} />
        </Field>
        <div className="flex items-end justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={pairing} onChange={setPairing} label={t('Duyệt cuộc trò chuyện mới')} />
            {t('Duyệt cuộc trò chuyện mới (khuyên bật)')}
          </label>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="text-danger" onClick={remove} icon={<Trash2 className="size-3.5" />}>
              {t('Xoá')}
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => patch('save', { token: token || undefined, defaultProjectId: defaultProjectId || null, forward, requirePairing: pairing }, t('Đã lưu kênh chat'))} icon={<Save className="size-3.5" />}>
              {t('Lưu')}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">{t('Cuộc trò chuyện ({n})', { n: bindings.length })}</div>
        {!bindings.length ? (
          <p className="text-[13px] text-muted">{t('Chưa có ai nhắn bot. Mở bot trên Telegram và gửi /start.')}</p>
        ) : (
          <div className="divide-y divide-line rounded-2xl border border-line">
            {bindings.map((b) => (
              <div key={b._id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{b.chatTitle}</span>
                  <span className="ml-2 text-[12px] text-subtle">{b.lastMessageAt ? t('nhắn {time}', { time: timeAgo(b.lastMessageAt) }) : ''}</span>
                </span>
                <Badge color={STATUS[b.status].color}>{STATUS[b.status].label}</Badge>
                {b.status === 'pending' && <span className="font-mono text-[12px] text-muted">{t('mã {code}', { code: b.code })}</span>}
                <div className="w-56 shrink-0">
                  <Select value={b.projectId ?? ''} onChange={(e) => bind(b, { projectId: e.target.value || null })} className="h-8 text-[12.5px]">
                    <option value="">{t('Dự án mới cho yêu cầu kế tiếp')}</option>
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {b.status !== 'active' && (
                  <Button size="xs" variant="success" onClick={() => bind(b, { status: 'active' })} icon={<Check className="size-3" />}>
                    {t('Duyệt')}
                  </Button>
                )}
                {b.status !== 'blocked' && (
                  <Button size="xs" variant="ghost" onClick={() => bind(b, { status: 'blocked' })} icon={<Ban className="size-3" />}>
                    {t('Chặn')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-danger"
                  aria-label={t('Xoá cuộc trò chuyện')}
                  onClick={async () => {
                    await api.del(`${KEY}/bindings/${b._id}`);
                    await mutate(KEY);
                  }}
                  icon={<Trash2 className="size-3" />}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
