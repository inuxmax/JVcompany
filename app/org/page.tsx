'use client';
// Sơ đồ tổ chức: cấp trên – cấp dưới, trạng thái từng phòng; bấm một phòng để chỉnh cấp trên, heartbeat, ngân sách,
// kỹ năng, biến môi trường, quyền tuyển người và xem / khôi phục lịch sử cấu hình.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { AlarmClock, History, Network, RotateCcw, Save, Sparkles, Wallet } from 'lucide-react';
import type { Department, DepartmentRevision, HeartbeatConfig, Skill } from '@/lib/types';
import { api } from '@/lib/client/api';
import { formatDate, m, t } from '@/lib/i18n';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, DeptAvatar, Drawer, Field, Input, Segmented, Select, Skeleton, Switch, Textarea, confirmDialog, toast } from '@/components/ui';

type DeptRow = Department & { activeTasks: { status: string }[] };

const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: m('Đang làm việc'), color: '#5C9A68' },
  paused: { label: m('Tạm dừng'), color: '#C9952F' },
  error: { label: m('Lỗi'), color: '#C4483F' },
  terminated: { label: m('Đã nghỉ'), color: '#7A7268' },
  pending_approval: { label: m('Chờ duyệt tuyển'), color: '#8A7DAE' },
};

const HB_DEFAULT: HeartbeatConfig = { enabled: false, intervalSec: 3600, skipWhenNoWork: true, maxDailyRuns: 24, maxDailyCostUsd: 0, instructions: '' };
const INTERVALS = [900, 1800, 3600, 4 * 3600, 12 * 3600, 86400];

/** Chu kỳ heartbeat dạng chữ: "Mỗi 15 phút", "Mỗi 4 giờ", "Mỗi 1 ngày". */
function everyText(sec: number): string {
  if (sec % 86400 === 0) return t('Mỗi {n} ngày', { n: sec / 86400 });
  if (sec % 3600 === 0) return t('Mỗi {n} giờ', { n: sec / 3600 });
  return t('Mỗi {n} phút', { n: Math.round(sec / 60) });
}

/** Cấp trên hiệu lực: chưa đặt thì báo cáo cho giám đốc. */
function bossOf(d: Department, all: Department[]): string | null {
  if (d.reportsTo !== undefined) return d.reportsTo && all.some((x) => x._id === d.reportsTo) ? d.reportsTo : null;
  return d._id === 'director' || !all.some((x) => x._id === 'director') ? null : 'director';
}

function OrgNode({ d, all, onOpen }: { d: DeptRow; all: DeptRow[]; onOpen: (d: DeptRow) => void }) {
  const kids = all.filter((x) => x._id !== d._id && bossOf(x, all) === d._id);
  const status = !d.enabled && (!d.status || d.status === 'active') ? { label: m('Đang tắt'), color: '#958B7E' } : STATUS[d.status ?? 'active'];
  const busy = d.activeTasks.some((t) => t.status === 'running');
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onOpen(d)}
        className={clsx(
          'flex w-full max-w-[320px] items-center gap-3 rounded-2xl border bg-surface-solid/80 p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
          d.enabled ? 'border-line' : 'border-dashed border-line opacity-60',
        )}
      >
        <DeptAvatar icon={d.icon} color={d.color} busy={busy} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{t(d.name)}</span>
          <span className="block truncate text-[12px] text-muted">{t(d.title)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <Badge color={status.color} dot>
              {t(status.label)}
            </Badge>
            {d.heartbeat?.enabled && <Badge color="#4A86BD">Heartbeat</Badge>}
            {(d.budgetMonthlyUsd ?? 0) > 0 && <Badge color="#B8862B">{t('{amount}/th', { amount: `$${d.budgetMonthlyUsd}` })}</Badge>}
          </span>
        </span>
      </button>
      {kids.length > 0 && (
        <ul className="mt-2 ml-5 space-y-2 border-l border-line pl-5">
          {kids.map((k) => (
            <OrgNode key={k._id} d={k} all={all} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DeptPanel({ dept, all, onClose }: { dept: DeptRow; all: DeptRow[]; onClose: () => void }) {
  const [tab, setTab] = useState<'org' | 'heartbeat' | 'budget' | 'skills' | 'env' | 'history'>('org');
  const [form, setForm] = useState({
    reportsTo: bossOf(dept, all) ?? '',
    status: dept.status ?? 'active',
    canHire: Boolean(dept.permissions?.canHire),
    heartbeat: { ...HB_DEFAULT, ...dept.heartbeat },
    budget: String(dept.budgetMonthlyUsd ?? 0),
    skills: dept.skills ?? [],
    env: Object.entries(dept.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const { data: skills } = useSWR<Skill[]>(tab === 'skills' ? '/api/skills' : null);
  const { data: revisions } = useSWR<DepartmentRevision[]>(tab === 'history' ? `/api/departments/${dept._id}/revisions` : null);

  const save = async () => {
    setBusy(true);
    try {
      const env: Record<string, string> = {};
      for (const line of form.env.split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      await api.patch(`/api/departments/${dept._id}`, {
        reportsTo: form.reportsTo || null,
        status: form.status,
        permissions: { ...(dept.permissions ?? {}), canHire: form.canHire },
        heartbeat: { ...form.heartbeat, intervalSec: Number(form.heartbeat.intervalSec), maxDailyRuns: Number(form.heartbeat.maxDailyRuns), maxDailyCostUsd: Number(form.heartbeat.maxDailyCostUsd) },
        budgetMonthlyUsd: Math.max(0, Number(form.budget) || 0),
        skills: form.skills,
        env,
      });
      await Promise.all([mutate('/api/departments'), mutate(`/api/departments/${dept._id}/revisions`)]);
      toast.success(t('Đã lưu'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const wake = async () => {
    try {
      await api.post(`/api/departments/${dept._id}/wake`, {});
      toast.success(t('Đã đánh thức {name} – một lượt rà soát việc vừa được tạo.', { name: t(dept.name) }));
    } catch (e) {
      toast.error(e);
    }
  };
  const rollback = async (r: DepartmentRevision) => {
    const ok = await confirmDialog({ title: t('Khôi phục cấu hình?'), message: t('Đưa {keys} về giá trị trước lần sửa lúc {time}.', { keys: r.changedKeys.join(', '), time: formatDate(r.createdAt) }), confirmLabel: t('Khôi phục') });
    if (!ok) return;
    try {
      await api.post(`/api/departments/${dept._id}/revisions`, { revisionId: r._id });
      await Promise.all([mutate('/api/departments'), mutate(`/api/departments/${dept._id}/revisions`)]);
      toast.success(t('Đã khôi phục'));
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  const hb = form.heartbeat;
  const setHb = (p: Partial<HeartbeatConfig>) => setForm({ ...form, heartbeat: { ...hb, ...p } });
  return (
    <Drawer
      open
      onClose={onClose}
      title={t(dept.name)}
      subtitle={t(dept.title)}
      actions={
        tab !== 'history' ? (
          <>
            <Button variant="ghost" onClick={wake} icon={<AlarmClock className="size-4" />}>
              {t('Đánh thức ngay')}
            </Button>
            <Button variant="primary" onClick={save} loading={busy} icon={<Save className="size-4" />}>
              {t('Lưu')}
            </Button>
          </>
        ) : undefined
      }
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'org', label: t('Tổ chức') },
          { value: 'heartbeat', label: 'Heartbeat' },
          { value: 'budget', label: t('Ngân sách') },
          { value: 'skills', label: t('Kỹ năng') },
          { value: 'env', label: t('Biến môi trường') },
          { value: 'history', label: t('Lịch sử') },
        ]}
      />
      <div className="mt-5 space-y-4">
        {tab === 'org' && (
          <>
            <Field label={t('Báo cáo cho (cấp trên)')} hint={t('Mỗi phòng có đúng một cấp trên; không được tạo vòng lặp.')}>
              <Select value={form.reportsTo} onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}>
                <option value="">{t('(đứng đầu – không có cấp trên)')}</option>
                {all
                  .filter((d) => d._id !== dept._id)
                  .map((d) => (
                    <option key={d._id} value={d._id}>
                      {t(d.name)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('Trạng thái')} hint={t('Tạm dừng: không nhận lượt chạy mới. Đã nghỉ: ngừng hẳn.')}>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Department['status'] & string })}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v.label)}
                  </option>
                ))}
              </Select>
            </Field>
            {dept.pauseReason && <div className="rounded-xl bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t('Lý do tạm dừng: {reason}', { reason: dept.pauseReason })}</div>}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
              <span>
                <b>{t('Được tuyển nhân sự mới')}</b>
                <span className="block text-[12px] text-muted">{t('Phòng có thể đề nghị tạo phòng ban mới khi thiếu chuyên môn (công ty có thể bắt buộc bạn duyệt).')}</span>
              </span>
              <Switch checked={form.canHire} onChange={(v) => setForm({ ...form, canHire: v })} label={t('Quyền tuyển')} />
            </label>
          </>
        )}
        {tab === 'heartbeat' && (
          <>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
              <span>
                <b>{t('Tự thức dậy định kỳ')}</b>
                <span className="block text-[12px] text-muted">{t('Phòng tự rà soát việc đang mở, phát hiện việc bị kẹt và báo cáo.')}</span>
              </span>
              <Switch checked={hb.enabled} onChange={(v) => setHb({ enabled: v })} label={t('Bật heartbeat')} />
            </label>
            <Field label={t('Chu kỳ')}>
              <Select value={String(hb.intervalSec)} onChange={(e) => setHb({ intervalSec: Number(e.target.value) })}>
                {INTERVALS.map((sec) => (
                  <option key={sec} value={sec}>
                    {everyText(sec)}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={hb.skipWhenNoWork} onChange={(e) => setHb({ skipWhenNoWork: e.target.checked })} className="size-4 accent-[var(--accent)]" />
              {t('Bỏ qua khi phòng không có việc đang mở')}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Tối đa lượt / ngày')} hint={t('0 = không giới hạn')}>
                <Input type="number" value={String(hb.maxDailyRuns)} onChange={(e) => setHb({ maxDailyRuns: Number(e.target.value) })} />
              </Field>
              <Field label={t('Tối đa chi phí / ngày (USD)')} hint={t('0 = không giới hạn')}>
                <Input type="number" value={String(hb.maxDailyCostUsd)} onChange={(e) => setHb({ maxDailyCostUsd: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label={t('Lời nhắc khi thức dậy (tuỳ chọn)')}>
              <Textarea rows={3} value={hb.instructions ?? ''} onChange={(e) => setHb({ instructions: e.target.value })} placeholder={t('Để trống = rà soát việc đang mở và báo cáo.')} />
            </Field>
            {dept.lastHeartbeatAt && <div className="text-[12px] text-subtle">{t('Lần gần nhất: {time}', { time: timeAgo(dept.lastHeartbeatAt) })}</div>}
          </>
        )}
        {tab === 'budget' && (
          <>
            <Field label={t('Ngân sách mỗi tháng (USD)')} hint={t('0 = không giới hạn. Cảnh báo ở 80%; chạm 100% thì phòng tự tạm dừng và xin bạn duyệt vượt ngân sách.')}>
              <Input type="number" min={0} step="0.5" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
            </Field>
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Wallet className="size-3.5" /> {t('Chi tiết chi phí xem ở trang Chi phí & ngân sách.')}
            </p>
          </>
        )}
        {tab === 'skills' && (
          <div className="space-y-2">
            {!skills ? (
              <Skeleton className="h-24" />
            ) : (
              skills.map((s) => {
                const builtin = s.source.type === 'builtin';
                const on = builtin || form.skills.includes(s.key);
                return (
                  <label key={s._id} className={clsx('flex items-start gap-3 rounded-xl border px-3 py-2.5 text-[13px]', on ? 'border-accent/40 bg-accent/5' : 'border-line')}>
                    <input
                      type="checkbox"
                      disabled={builtin}
                      checked={on}
                      onChange={(e) => setForm({ ...form, skills: e.target.checked ? [...form.skills, s.key] : form.skills.filter((k) => k !== s.key) })}
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <b className="flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-accent" />
                        {s.name}
                        {builtin && <Badge color="#958B7E">{t('Mọi phòng')}</Badge>}
                      </b>
                      <span className="block text-[12px] text-muted">{s.description}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        )}
        {tab === 'env' && (
          <Field label={t('Biến môi trường khi phòng chạy agent')} hint={t('Mỗi dòng TEN=giá trị. Dùng TEN=secret:KHOA để lấy giá trị từ Kho bí mật (không lưu giá trị thật ở đây).')}>
            <Textarea rows={6} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} className="font-mono text-[12.5px]" placeholder={'GITHUB_TOKEN=secret:GITHUB_TOKEN\nAPP_ENV=staging'} />
          </Field>
        )}
        {tab === 'history' && (
          <div className="space-y-2">
            {!revisions ? (
              <Skeleton className="h-24" />
            ) : !revisions.length ? (
              <p className="text-[13px] text-muted">{t('Chưa có lần sửa nào.')}</p>
            ) : (
              revisions.map((r) => (
                <div key={r._id} className="rounded-xl border border-line px-3 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2">
                    <History className="size-3.5 text-subtle" />
                    <span className="font-medium">{r.source === 'rollback' ? t('Khôi phục') : t('Sửa')}</span>
                    <span className="text-muted">{r.changedKeys.join(', ')}</span>
                    <span className="ml-auto text-[12px] text-subtle">
                      {t(r.by)} · {timeAgo(r.createdAt)}
                    </span>
                  </div>
                  {r.before && (
                    <div className="mt-2 flex justify-end">
                      <Button size="xs" variant="outline" onClick={() => rollback(r)} icon={<RotateCcw className="size-3.5" />}>
                        {t('Khôi phục về trước lần này')}
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default function OrgPage() {
  const { data } = useSWR<DeptRow[]>('/api/departments');
  const [open, setOpen] = useState<string | null>(null);
  const all = data ?? [];
  const roots = all.filter((d) => !bossOf(d, all));
  const current = all.find((d) => d._id === open) ?? null;
  return (
    <Page>
      <PageHeader
        eyebrow={t('Công ty')}
        title={t('Sơ đồ tổ chức')}
        description={t('Ai báo cáo cho ai. Mỗi phòng có một cấp trên, trạng thái, heartbeat, ngân sách và kỹ năng riêng. Bấm một phòng để chỉnh.')}
        icon={<Network className="size-7 text-accent" />}
      />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="space-y-3">
          {roots.map((d) => (
            <OrgNode key={d._id} d={d} all={all} onOpen={(x) => setOpen(x._id)} />
          ))}
        </ul>
      )}
      {current && <DeptPanel key={current._id} dept={current} all={all} onClose={() => setOpen(null)} />}
    </Page>
  );
}
