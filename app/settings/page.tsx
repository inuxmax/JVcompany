'use client';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Building2, Download, MousePointerClick, Save, Server, ShieldAlert, Timer, Workflow as WorkflowIcon } from 'lucide-react';
import type { Department, FloorView, PermissionLevel, Provider, Settings, SystemHealth, Workflow } from '@/lib/types';
import { PERMISSION_LEVELS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import { tint } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, CardHeader, Dot, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';

function NumberField({ label, hint, value, onChange, min = 1, max = 1000, step = 1 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <Field label={label} hint={hint}>
      <Input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function WorkflowEditor({ departments }: { departments: Department[] }) {
  const { data } = useSWR<Workflow>('/api/workflow');
  if (!data) return <Skeleton className="h-40" />;
  return <WorkflowForm key={data.updatedAt} workflow={data} departments={departments} />;
}

function WorkflowForm({ workflow, departments }: { workflow: Workflow; departments: Department[] }) {
  const [phases, setPhases] = useState<Workflow['phases']>(workflow.phases);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Workflow['phases'][number]>) => setPhases((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/workflow', { phases });
      await mutate('/api/workflow');
      toast.success(t('Đã lưu quy trình'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {phases.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-[11.5px] font-semibold">{i + 1}</span>
            <Input value={t(p.name)} onChange={(e) => update(i, { name: e.target.value })} className="h-8 max-w-xs font-semibold" />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
            <Field label={t('Phòng chủ trì')}>
              <Select value={p.lead} onChange={(e) => update(i, { lead: e.target.value })} className="h-9">
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {t(d.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('Phòng phải phê duyệt')}>
              <div className="flex flex-wrap gap-1.5">
                {departments.map((d) => {
                  const on = p.requiredApprovals.includes(d._id);
                  return (
                    <button
                      key={d._id}
                      type="button"
                      onClick={() => update(i, { requiredApprovals: on ? p.requiredApprovals.filter((x) => x !== d._id) : [...p.requiredApprovals, d._id] })}
                      className={clsx('rounded-full border px-2.5 py-1 text-[12px] transition-colors', on ? 'border-transparent' : 'border-line text-muted hover:text-fg')}
                      style={on ? { background: tint(d.color, 0.16), color: d.color } : undefined}
                    >
                      {/* i18n-ignore: chỉ bỏ tiền tố "Phòng " của tên tiếng Việt gốc */}
                      {t(d.name).replace('Phòng ', '')}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <Field label={t('Mô tả giai đoạn')} className="mt-3">
            <Input value={t(p.description)} onChange={(e) => update(i, { description: e.target.value })} className="h-9" />
          </Field>
          <Field label={t('Đầu ra bắt buộc (phân tách bằng dấu ;)')} className="mt-3">
            <Input
              value={p.outputs.map((o) => t(o)).join('; ')}
              onChange={(e) => update(i, { outputs: e.target.value.split(';').map((s) => s.trim()).filter(Boolean) })}
              className="h-9"
            />
          </Field>
        </div>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={busy} icon={<Save className="size-4" />}>
          {t('Lưu quy trình')}
        </Button>
      </div>
    </div>
  );
}

function FloorsCard() {
  const { data } = useSWR<{ floors: FloorView[] }>('/api/floors');
  const [names, setNames] = useState<Record<string, string>>({});
  const patch = async (id: string, body: { name?: string; enabled?: boolean }) => {
    try {
      await api.patch(`/api/floors/${id}`, body);
      await mutate('/api/floors');
      toast.success(t('Đã cập nhật tầng'));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card className="mt-6">
      <CardHeader
        icon={<Building2 className="size-4" />}
        title={t('Toà nhà & tầng')}
        description={t('Mỗi tầng làm trọn một dự án. Tắt tầng để giảm số dự án chạy song song (tầng đang làm sẽ làm nốt dự án hiện tại).')}
      />
      <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-5">
        {!data ? (
          <Skeleton className="h-24" />
        ) : (
          data.floors.map((f) => (
            <div key={f._id} className={clsx('rounded-2xl border p-3', f.enabled ? 'border-line' : 'border-dashed border-line-strong opacity-70')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-8 items-center justify-center rounded-xl bg-surface-3 font-display font-semibold">{f.number}</span>
                <Switch checked={f.enabled} onChange={(v) => patch(f._id, { enabled: v })} label={t('Bật {name}', { name: t(f.name) })} />
              </div>
              <Input
                className="mt-2 h-9"
                value={names[f._id] ?? t(f.name)}
                onChange={(e) => setNames((n) => ({ ...n, [f._id]: e.target.value }))}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && e.target.value.trim() !== t(f.name) && patch(f._id, { name: e.target.value })}
              />
              <div className="mt-1.5 truncate text-[12px] text-muted">{f.project ? t('Đang làm: {name}', { name: f.project.name }) : t('Trống')}</div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { data } = useSWR<Settings>('/api/settings');
  const { data: health } = useSWR<SystemHealth>('/api/health');
  const { data: prov } = useSWR<{ providers: Provider[] }>('/api/providers');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const [busy, setBusy] = useState(false);
  const form: Settings | null = data ? { ...data, ...edits } : null;

  const save = async (patch?: Partial<Settings>) => {
    if (!form) return;
    setBusy(true);
    try {
      const s = await api.patch<Settings>('/api/settings', patch ?? form);
      await mutate('/api/settings', s, { revalidate: false });
      setEdits({});
      await mutate('/api/health');
      toast.success(t('Đã lưu cài đặt'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return (
      <Page>
        <PageHeader title={t('Cài đặt')} />
        <Skeleton className="h-96" />
      </Page>
    );
  }
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setEdits((e) => ({ ...e, [k]: v }));

  return (
    <Page>
      <PageHeader
        title={t('Cài đặt')}
        description={t('Quyền điều khiển máy tính, vận hành agent, tự động chạy lại khi hết hạn mức và quy trình làm việc.')}
        actions={
          <Button variant="primary" onClick={() => save()} loading={busy} icon={<Save className="size-4" />}>
            {t('Lưu thay đổi')}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className={clsx(form.computerControl && 'border-danger/40')}>
          <CardHeader icon={<MousePointerClick className="size-4" />} title={t('Điều khiển máy tính')} description={t('Cho phép agent chụp màn hình, điều khiển chuột/bàn phím và mở ứng dụng.')} />
          <div className="space-y-4 px-5 pb-5">
            <div className={clsx('flex items-center justify-between gap-4 rounded-xl border p-4', form.computerControl ? 'border-danger/40 bg-danger/8' : 'border-line')}>
              <div>
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  <ShieldAlert className={clsx('size-4', form.computerControl ? 'text-danger' : 'text-subtle')} />
                  {t('Cho phép AI điều khiển máy tính')}
                </div>
                <p className="mt-1 text-[12.5px] text-muted">
                  {t('Ở quyền “Toàn quyền” agent tự thao tác; ở quyền thấp hơn, mỗi thao tác cần bạn phê duyệt. Trên macOS cần cấp quyền Accessibility & Screen Recording; Linux cần xdotool.')}
                </p>
              </div>
              <Switch checked={form.computerControl} onChange={(v) => set('computerControl', v)} />
            </div>
            <Field label={t('Quyền mặc định cho dự án mới')}>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSION_LEVELS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set('defaultPermission', p.id as PermissionLevel)}
                    className={clsx('rounded-xl border p-2.5 text-left', form.defaultPermission === p.id ? 'border-transparent' : 'border-line hover:border-line-strong')}
                    style={form.defaultPermission === p.id ? { background: tint(p.color, 0.08), boxShadow: `0 0 0 2px ${p.color}` } : undefined}
                  >
                    <div className="text-[13px] font-semibold" style={{ color: p.color }}>
                      {t(p.label)}
                    </div>
                    <div className="text-[11.5px] text-muted">{t(p.description)}</div>
                  </button>
                ))}
              </div>
            </Field>
            <NumberField label={t('Thời gian chờ phê duyệt (phút)')} value={form.approvalTimeoutMinutes} onChange={(v) => set('approvalTimeoutMinutes', v)} max={1440} />
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Timer className="size-4" />} title={t('Tự động chạy lại khi hết hạn mức')} description={t('Khi gói đăng ký/API báo hết hạn mức, nhiệm vụ chờ và tự chạy lại khi có lại hạn mức.')} />
          <div className="space-y-4 px-5 pb-5">
            <p className="rounded-xl bg-surface-2/60 p-3 text-[12.5px] text-muted">
              {t('Hệ thống đọc thời điểm reset từ thông báo lỗi (ví dụ “resets 3pm”, “try again in 2h”, header retry-after). Nếu không có, chờ lùi dần: {a} → {b} → {c}… tối đa {max} phút. Nếu phòng có kết nối dự phòng, nhiệm vụ chuyển sang ngay.', {
                a: form.retry.baseMinutes,
                b: form.retry.baseMinutes * 2,
                c: form.retry.baseMinutes * 4,
                max: form.retry.maxMinutes,
              })}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label={t('Chờ ban đầu (phút)')} value={form.retry.baseMinutes} min={0.5} step={0.5} onChange={(v) => set('retry', { ...form.retry, baseMinutes: v })} />
              <NumberField label={t('Chờ tối đa (phút)')} value={form.retry.maxMinutes} onChange={(v) => set('retry', { ...form.retry, maxMinutes: v })} max={1440} />
              <NumberField label={t('Số lần thử tối đa')} value={form.retry.maxAttempts} onChange={(v) => set('retry', { ...form.retry, maxAttempts: v })} max={200} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<WorkflowIcon className="size-4" />} title={t('Vận hành agent')} description={t('Giới hạn song song và giao việc để tránh vòng lặp vô hạn.')} />
          <div className="space-y-4 px-5 pb-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line p-3">
              <div>
                <div className="text-[13.5px] font-medium">{t('Worker đang chạy')}</div>
                <div className="text-[12.5px] text-muted">{t('Tắt để tạm dừng toàn bộ việc xử lý nhiệm vụ.')}</div>
              </div>
              <Switch checked={form.workerEnabled} onChange={(v) => set('workerEnabled', v)} />
            </div>
            <Field label={t('Kết nối AI mặc định')}>
              <Select value={form.defaultProviderId ?? ''} onChange={(e) => set('defaultProviderId', e.target.value || null)}>
                <option value="">{t('— Không đặt —')}</option>
                {prov?.providers.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label={t('Nhiệm vụ chạy song song')} value={form.concurrency} onChange={(v) => set('concurrency', v)} max={20} />
              <NumberField label={t('Song song mỗi dự án')} value={form.perProjectConcurrency} onChange={(v) => set('perProjectConcurrency', v)} max={10} />
              <NumberField label={t('Số tầng giao việc tối đa')} value={form.maxDepth} onChange={(v) => set('maxDepth', v)} max={10} />
              <NumberField label={t('Số lượt tổng hợp tối đa')} value={form.maxRounds} onChange={(v) => set('maxRounds', v)} max={10} />
              <NumberField label={t('Nhiệm vụ tối đa / dự án')} value={form.maxTasksPerProject} onChange={(v) => set('maxTasksPerProject', v)} max={2000} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Server className="size-4" />} title={t('Hệ thống')} description={t('Dữ liệu được lưu trong MongoDB.')} />
          <div className="space-y-3 px-5 pb-5 text-[13px]">
            <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <span className="text-muted">MongoDB</span>
              <span className="flex items-center gap-2">
                <Dot color={health?.db.ok ? '#5C9A68' : '#C4483F'} />
                <span className="font-mono text-[12px]">
                  {health?.db.uri}/{health?.db.name}
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <span className="text-muted">{t('Hệ điều hành')}</span>
              <span>{health?.platform}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
              <span className="text-muted">Worker</span>
              <Badge color={health?.worker.running ? '#5C9A68' : '#C4483F'} dot>
                {health?.worker.running ? t('Đang chạy · {n} nhiệm vụ', { n: health.worker.activeTasks }) : t('Không chạy')}
              </Badge>
            </div>
            <a href="/api/export" download>
              <Button variant="outline" icon={<Download className="size-4" />}>
                {t('Sao lưu dữ liệu (JSON)')}
              </Button>
            </a>
          </div>
        </Card>
      </div>

      <FloorsCard />

      <Card className="mt-6">
        <CardHeader title={t('Quy trình làm việc')} description={t('Các giai đoạn, phòng chủ trì và phòng phải phê duyệt. Áp dụng cho các giai đoạn bắt đầu sau khi lưu.')} />
        <div className="px-5 pb-5">{departments ? <WorkflowEditor departments={departments} /> : <Skeleton className="h-40" />}</div>
      </Card>
    </Page>
  );
}
