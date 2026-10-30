'use client';
// Lịch định kỳ: việc lặp lại theo lịch cron, webhook hoặc gọi API – mỗi lượt tạo một nhiệm vụ có người làm và lịch sử.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { CalendarClock, Copy, Pause, Play, Plus, RefreshCw, Trash2, Webhook, Zap } from 'lucide-react';
import type { Department, Project, Routine, RoutineRun, RoutineTrigger, Task } from '@/lib/types';
import { TASK_STATUS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { m, t, tc } from '@/lib/i18n';
import { dateTime, timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, EmptyState, Field, Input, Modal, Segmented, Select, Skeleton, Textarea, confirmDialog, toast } from '@/components/ui';

const PRESETS = [
  { cron: '0 9 * * *', label: m('Mỗi ngày 9:00') },
  { cron: '0 9 * * 1-5', label: m('Ngày làm việc 9:00') },
  { cron: '0 9 * * 1', label: m('Thứ Hai 9:00') },
  { cron: '0 * * * *', label: m('Mỗi giờ') },
  { cron: '*/15 * * * *', label: m('Mỗi 15 phút') },
  { cron: '0 8 1 * *', label: m('Ngày 1 hằng tháng 8:00') },
];

const RUN_STATUS: Record<string, { label: string; color: string }> = {
  received: { label: m('Đã nhận'), color: '#958B7E' },
  coalesced: { label: m('Gộp vào lượt trước'), color: '#8A7DAE' },
  skipped: { label: m('Bỏ qua (lượt trước còn chạy)'), color: '#958B7E' },
  task_created: { label: m('Đang làm'), color: '#4A86BD' },
  completed: { label: m('Xong'), color: '#5C9A68' },
  failed: { label: m('Lỗi'), color: '#C4483F' },
};

function cronText(cron?: string): string {
  const preset = PRESETS.find((p) => p.cron === cron);
  return preset ? t(preset.label) : `cron "${cron}"`;
}

function Editor({ routine, departments, projects, onClose }: { routine?: Routine | null; departments: Department[]; projects: Project[]; onClose: () => void }) {
  const sched = routine?.triggers.find((t) => t.kind === 'schedule');
  const [form, setForm] = useState({
    title: routine?.title ?? '',
    instructions: routine?.instructions ?? '',
    departmentId: routine?.departmentId ?? departments.find((d) => d.enabled)?._id ?? '',
    projectId: routine?.projectId ?? '',
    priority: routine?.priority ?? 'normal',
    concurrency: routine?.concurrency ?? 'coalesce_if_active',
    catchUp: routine?.catchUp ?? 'skip_missed',
    useSchedule: routine ? Boolean(sched) : true,
    cron: sched?.cron ?? '0 9 * * *',
    timezone: sched?.timezone ?? 'Asia/Ho_Chi_Minh',
    useWebhook: Boolean(routine?.triggers.some((t) => t.kind === 'webhook')),
    signingMode: routine?.triggers.find((t) => t.kind === 'webhook')?.signingMode ?? 'bearer',
    variables: (routine?.variables ?? []).map((v) => `${v.name}=${v.default ?? ''}`).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const prev = routine?.triggers ?? [];
      const triggers: Partial<RoutineTrigger>[] = [];
      if (form.useSchedule) triggers.push({ id: sched?.id, kind: 'schedule', enabled: true, cron: form.cron.trim(), timezone: form.timezone });
      const wh = prev.find((t) => t.kind === 'webhook');
      if (form.useWebhook) triggers.push({ id: wh?.id, kind: 'webhook', enabled: true, signingMode: form.signingMode as RoutineTrigger['signingMode'] });
      triggers.push({ id: prev.find((t) => t.kind === 'api')?.id, kind: 'api', enabled: true });
      const variables = form.variables
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, ...rest] = l.split('=');
          return { name: name.trim(), label: name.trim(), type: 'text' as const, default: rest.join('=').trim() };
        });
      const body = { ...form, projectId: form.projectId || null, triggers, variables };
      if (routine) await api.patch(`/api/routines/${routine._id}`, body);
      else await api.post('/api/routines', body);
      await mutate('/api/routines');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={routine ? t('Sửa lịch định kỳ') : t('Thêm lịch định kỳ')}
      description={t('Mỗi lượt tạo một nhiệm vụ cho phòng được chọn. Dùng {{date}}, {{timestamp}} hoặc {{tên_biến}} trong tiêu đề / hướng dẫn.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.title.trim() || !form.departmentId}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('Tên việc')}>
          <Input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('VD: Báo cáo tiến độ ngày {{date}}')} />
        </Field>
        <Field label={t('Hướng dẫn mỗi lượt')}>
          <Textarea rows={4} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder={t('Tổng hợp việc đã xong hôm qua, việc đang kẹt và kế hoạch hôm nay…')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('Phòng thực hiện')}>
            <Select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
              {departments
                .filter((d) => d.enabled)
                .map((d) => (
                  <option key={d._id} value={d._id}>
                    {t(d.name)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Thuộc dự án')}>
            <Select value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">{t('Việc chung công ty')}</option>
              {projects
                .filter((p) => !p.internal)
                .map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('Ưu tiên')}>
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value as Routine['priority'] })}>
              <option value="low">{t('Thấp')}</option>
              <option value="normal">{t('Bình thường')}</option>
              <option value="high">{t('Cao')}</option>
              <option value="critical">{t('Khẩn cấp')}</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-3 rounded-2xl border border-line p-3">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={form.useSchedule} onChange={(e) => set({ useSchedule: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            <CalendarClock className="size-4 text-accent" /> {t('Theo lịch')}
          </label>
          {form.useSchedule && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.cron} type="button" onClick={() => set({ cron: p.cron })} className={clsx('rounded-full border px-2.5 py-1 text-[12px]', form.cron === p.cron ? 'border-accent bg-accent/8 text-accent' : 'border-line text-muted hover:border-line-strong')}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('Cron (phút giờ ngày tháng thứ)')}>
                  <Input value={form.cron} onChange={(e) => set({ cron: e.target.value })} className="font-mono" />
                </Field>
                <Field label={t('Múi giờ')}>
                  <Input value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} className="font-mono" />
                </Field>
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={form.useWebhook} onChange={(e) => set({ useWebhook: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            <Webhook className="size-4 text-accent" /> {t('Webhook (dịch vụ khác gọi vào để kích hoạt)')}
          </label>
          {form.useWebhook && (
            <Field label={t('Xác thực webhook')}>
              <Segmented
                value={form.signingMode}
                onChange={(v) => set({ signingMode: v })}
                options={[
                  { value: 'bearer', label: 'Bearer token' },
                  { value: 'hmac_sha256', label: t('Chữ ký HMAC-SHA256') },
                  { value: 'none', label: t('Không') },
                ]}
              />
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Khi lượt trước còn chạy')}>
            <Select value={form.concurrency} onChange={(e) => set({ concurrency: e.target.value as Routine['concurrency'] })}>
              <option value="coalesce_if_active">{t('Gộp vào lượt đang chạy')}</option>
              <option value="skip_if_active">{t('Bỏ qua lượt mới')}</option>
              <option value="always_enqueue">{t('Luôn tạo lượt mới')}</option>
            </Select>
          </Field>
          <Field label={t('Lượt bị lỡ (máy tắt)')}>
            <Select value={form.catchUp} onChange={(e) => set({ catchUp: e.target.value as Routine['catchUp'] })}>
              <option value="skip_missed">{t('Bỏ qua')}</option>
              <option value="enqueue_missed">{t('Chạy bù (tối đa 25)')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('Biến (tuỳ chọn)')} hint={t('Mỗi dòng ten_bien=giá trị mặc định. Webhook / API có thể gửi giá trị khác.')}>
          <Textarea rows={2} value={form.variables} onChange={(e) => set({ variables: e.target.value })} className="font-mono text-[12.5px]" placeholder="khach_hang=ACME" />
        </Field>
      </div>
    </Modal>
  );
}

function RoutineDetail({ routine, onClose }: { routine: Routine; onClose: () => void }) {
  const { data } = useSWR<{ routine: Routine; runs: (RoutineRun & { task?: Pick<Task, '_id' | 'identifier' | 'status' | 'title'> | null })[] }>(`/api/routines/${routine._id}?secret=1`);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const wh = routine.triggers.find((t) => t.kind === 'webhook');
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success(t('Đã sao chép')));
  const rotate = async () => {
    const ok = await confirmDialog({ title: t('Đổi mã bí mật webhook?'), message: t('Dịch vụ đang dùng mã cũ sẽ bị từ chối cho tới khi cập nhật mã mới.'), confirmLabel: t('Đổi mã') });
    if (!ok) return;
    await api.patch(`/api/routines/${routine._id}`, { rotateSecret: true });
    await mutate(`/api/routines/${routine._id}?secret=1`);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={routine.title} description={t('Cách kích hoạt và lịch sử lượt chạy')}>
      <div className="space-y-4">
        {wh?.publicId && (
          <div className="space-y-2 rounded-2xl border border-line p-3 text-[12.5px]">
            <div className="flex items-center gap-1.5 font-medium">
              <Webhook className="size-4 text-accent" /> Webhook
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 font-mono">{`POST ${origin}/api/hooks/routines/${wh.publicId}`}</code>
              <Button size="xs" variant="ghost" onClick={() => copy(`${origin}/api/hooks/routines/${wh.publicId}`)} icon={<Copy className="size-3.5" />} aria-label={t('Sao chép')} />
            </div>
            {wh.signingMode !== 'none' && data?.routine.webhookSecret && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-muted">{wh.signingMode === 'bearer' ? 'Authorization: Bearer' : t('Khoá HMAC')}</span>
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 font-mono">{data.routine.webhookSecret}</code>
                <Button size="xs" variant="ghost" onClick={() => copy(data.routine.webhookSecret!)} icon={<Copy className="size-3.5" />} aria-label={t('Sao chép')} />
                <Button size="xs" variant="ghost" onClick={rotate} icon={<RefreshCw className="size-3.5" />} aria-label={t('Đổi mã')} />
              </div>
            )}
            <p className="text-muted">{t('Gửi JSON (vd {example}); header Idempotency-Key để tránh chạy trùng. Từ máy khác cần mở truy cập mạng LAN (JVCOMPANY_ACCESS_KEY).', { example: '{"variables": {"khach_hang": "ACME"}}' })}</p>
          </div>
        )}
        <div className="rounded-2xl border border-line p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Zap className="size-4 text-accent" /> {t('Gọi API')}
          </div>
          <code className="block truncate rounded-lg bg-surface-2 px-2 py-1 font-mono">{`POST ${origin}/api/routines/${routine._id}/run`}</code>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold">{t('Lượt chạy gần đây')}</div>
          {!data ? (
            <Skeleton className="h-20" />
          ) : !data.runs.length ? (
            <p className="text-[13px] text-muted">{t('Chưa có lượt nào.')}</p>
          ) : (
            <div className="space-y-1.5">
              {data.runs.map((r) => {
                const st = RUN_STATUS[r.status] ?? RUN_STATUS.received;
                return (
                  <div key={r._id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                    <Badge color={st.color} dot>
                      {t(st.label)}
                    </Badge>
                    <span className="text-muted">{r.source === 'schedule' ? t('Theo lịch') : r.source === 'webhook' ? 'Webhook' : r.source === 'api' ? 'API' : t('Chạy tay')}</span>
                    {r.task && (
                      <span className="min-w-0 flex-1 truncate">
                        {r.task.identifier} · {r.task.title} <span style={{ color: TASK_STATUS[r.task.status].color }}>({t(TASK_STATUS[r.task.status].label)})</span>
                      </span>
                    )}
                    {r.reason && !r.task && <span className="min-w-0 flex-1 truncate text-muted">{r.reason}</span>}
                    <span className="ml-auto shrink-0 text-subtle">{timeAgo(r.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function RoutinesPage() {
  const { data } = useSWR<Routine[]>('/api/routines');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const { data: projects } = useSWR<Project[]>('/api/projects');
  const [editing, setEditing] = useState<Routine | null | 'new'>(null);
  const [detail, setDetail] = useState<Routine | null>(null);
  const runNow = async (r: Routine) => {
    try {
      const run = await api.post<RoutineRun>(`/api/routines/${r._id}/run`, {});
      toast.success(run.status === 'task_created' ? t('Đã tạo nhiệm vụ cho lượt này') : t('Lượt chạy: {status}', { status: RUN_STATUS[run.status] ? t(RUN_STATUS[run.status].label) : run.status }));
      await mutate('/api/routines');
    } catch (e) {
      toast.error(e);
    }
  };
  const toggle = async (r: Routine) => {
    await api.patch(`/api/routines/${r._id}`, { status: r.status === 'active' ? 'paused' : 'active' });
    await mutate('/api/routines');
  };
  const remove = async (r: Routine) => {
    const ok = await confirmDialog({ title: t('Lưu trữ lịch định kỳ?'), message: t('"{title}" sẽ ngừng chạy (không thể bật lại).', { title: r.title }), confirmLabel: t('Lưu trữ'), tone: 'danger' });
    if (!ok) return;
    await api.del(`/api/routines/${r._id}`);
    await mutate('/api/routines');
  };
  const dept = (id: string) => departments?.find((d) => d._id === id);
  return (
    <Page>
      <PageHeader
        eyebrow={t('Vận hành')}
        title={t('Lịch định kỳ')}
        description={t('Việc lặp lại (báo cáo, chăm sóc khách hàng, đăng bài…) tự tạo nhiệm vụ theo lịch, webhook hoặc API – có người làm và lịch sử.')}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
            {t('Thêm lịch')}
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-40" />
      ) : !data.length ? (
        <Card>
          <EmptyState icon={<CalendarClock className="size-6" />} title={t('Chưa có lịch định kỳ')} description={t('Ví dụ: “Mỗi sáng 9:00 Phòng Quản Lý tổng hợp tiến độ các dự án”.')} action={<Button variant="primary" onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>{t('Thêm lịch')}</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((r) => {
            const d = dept(r.departmentId);
            const sched = r.triggers.find((t) => t.kind === 'schedule' && t.enabled);
            return (
              <Card key={r._id} className={clsx('p-4', r.status !== 'active' && 'opacity-70')}>
                <div className="flex items-start gap-3">
                  {d && <DeptAvatar icon={d.icon} color={d.color} size="sm" />}
                  <button type="button" onClick={() => setDetail(r)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14.5px] font-semibold">{r.title}</span>
                      <Badge color={r.status === 'active' ? '#5C9A68' : '#958B7E'} dot>
                        {r.status === 'active' ? t('Đang bật') : t('Tạm dừng')}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-muted">
                      {d ? t(d.name) : r.departmentId} · {sched ? cronText(sched.cron) : t('Không theo lịch')}
                      {r.triggers.some((t) => t.kind === 'webhook') && ' · Webhook'}
                    </div>
                    <div className="mt-1 text-[12px] text-subtle">
                      {sched?.nextRunAt && r.status === 'active' ? t('Lượt tới: {time}', { time: dateTime(sched.nextRunAt) }) : ''}
                      {r.lastTriggeredAt ? ` · ${t('Gần nhất {time}', { time: timeAgo(r.lastTriggeredAt) })}` : ''}
                    </div>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => runNow(r)} icon={<Play className="size-3.5" />}>
                    {t('Chạy ngay')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(r)} icon={r.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}>
                    {r.status === 'active' ? tc('action', 'Tạm dừng') : tc('action', 'Bật')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    {t('Sửa')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)} icon={<Trash2 className="size-3.5" />} className="ml-auto" aria-label={t('Lưu trữ')} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <Editor routine={editing === 'new' ? null : editing} departments={departments ?? []} projects={projects ?? []} onClose={() => setEditing(null)} />}
      {detail && <RoutineDetail routine={detail} onClose={() => setDetail(null)} />}
    </Page>
  );
}
