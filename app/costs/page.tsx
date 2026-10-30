'use client';
// Chi phí & ngân sách: chi tiêu tháng, theo phòng / dự án / kết nối / model, 14 ngày; chính sách ngân sách và sự cố vượt ngân sách.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { AlertTriangle, Plus, Trash2, Wallet } from 'lucide-react';
import type { BudgetIncident, BudgetPolicy, Department, Project } from '@/lib/types';
import { api } from '@/lib/client/api';
import { t } from '@/lib/i18n';
import { timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Skeleton, Switch, confirmDialog, toast } from '@/components/ui';

interface Row {
  id: string;
  usd: number;
  tokens: number;
}
interface CostsResp {
  monthUsd: number;
  monthApiUsd: number;
  monthTokens: { input: number; output: number };
  byDepartment: Row[];
  byProject: Row[];
  byProvider: Row[];
  byModel: Row[];
  daily: { date: string; usd: number }[];
  policies: (BudgetPolicy & { spentUsd: number })[];
  incidents: BudgetIncident[];
  runs: { date: string; succeeded: number; failed: number; other: number; total: number }[];
}

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function Bars({ data, value, label }: { data: { date: string }[]; value: (i: number) => number[]; label: (i: number) => string }) {
  const totals = data.map((_, i) => value(i).reduce((s, v) => s + v, 0));
  const max = Math.max(...totals, 0.0001);
  const colors = ['#5C9A68', '#C4483F', '#958B7E'];
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d, i) => (
        <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={label(i)}>
          <div className="flex flex-col-reverse overflow-hidden rounded-md" style={{ height: `${Math.max(2, (totals[i] / max) * 100)}%` }}>
            {value(i).map((v, k) => (
              <div key={k} style={{ height: `${totals[i] ? (v / totals[i]) * 100 : 0}%`, background: value(i).length > 1 ? colors[k] : '#C9952F' }} />
            ))}
          </div>
          <div className="mt-1 text-center text-[9.5px] text-subtle">{d.date.slice(8)}</div>
        </div>
      ))}
    </div>
  );
}

function Breakdown({ title, rows, name }: { title: string; rows: Row[]; name: (id: string) => string }) {
  const max = Math.max(...rows.map((r) => r.usd), 0.0001);
  return (
    <Card>
      <CardHeader title={title} />
      <div className="space-y-2 px-6 pb-5">
        {!rows.length && <p className="text-[13px] text-muted">{t('Chưa có chi phí tháng này.')}</p>}
        {rows.slice(0, 8).map((r) => (
          <div key={r.id} className="text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{name(r.id)}</span>
              <span className="shrink-0 font-mono text-[12.5px]">
                {usd(r.usd)} <span className="text-subtle">· {tok(r.tokens)} token</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${(r.usd / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PolicyEditor({ departments, projects, onClose }: { departments: Department[]; projects: Project[]; onClose: () => void }) {
  const [form, setForm] = useState({ scopeType: 'company' as BudgetPolicy['scopeType'], scopeId: 'main', amountUsd: '50', windowKind: 'month' as BudgetPolicy['windowKind'], warnPercent: '80', hardStop: true, apiOnly: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/budgets', { ...form, amountUsd: Number(form.amountUsd), warnPercent: Number(form.warnPercent) });
      await mutate('/api/costs');
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
      title={t('Thêm ngân sách')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('Lưu')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Phạm vi')}>
            <Select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as BudgetPolicy['scopeType'], scopeId: e.target.value === 'company' ? 'main' : '' })}>
              <option value="company">{t('Cả công ty')}</option>
              <option value="department">{t('Một phòng ban')}</option>
              <option value="project">{t('Một dự án')}</option>
            </Select>
          </Field>
          {form.scopeType !== 'company' && (
            <Field label={form.scopeType === 'department' ? t('Phòng ban') : t('Dự án')}>
              <Select value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                <option value="">{t('(chọn)')}</option>
                {(form.scopeType === 'department' ? departments : projects).map((x) => (
                  <option key={x._id} value={x._id}>
                    {form.scopeType === 'department' ? t(x.name) : x.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('Hạn mức (USD)')}>
            <Input type="number" min={0} step="0.5" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} />
          </Field>
          <Field label={t('Kỳ')}>
            <Select value={form.windowKind} onChange={(e) => setForm({ ...form, windowKind: e.target.value as BudgetPolicy['windowKind'] })}>
              <option value="month">{t('Mỗi tháng (UTC)')}</option>
              <option value="lifetime">{t('Trọn đời')}</option>
            </Select>
          </Field>
          <Field label={t('Cảnh báo khi đạt (%)')}>
            <Input type="number" min={1} max={100} value={form.warnPercent} onChange={(e) => setForm({ ...form, warnPercent: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>{t('Chạm 100% thì tự tạm dừng và xin bạn duyệt')}</span>
          <Switch checked={form.hardStop} onChange={(v) => setForm({ ...form, hardStop: v })} label={t('Tự tạm dừng')} />
        </label>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>{t('Chỉ tính chi phí API (bỏ qua chi phí ước tính của gói đăng ký)')}</span>
          <Switch checked={form.apiOnly} onChange={(v) => setForm({ ...form, apiOnly: v })} label={t('Chỉ API')} />
        </label>
      </div>
    </Modal>
  );
}

export default function CostsPage() {
  const { data } = useSWR<CostsResp>('/api/costs');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const { data: projects } = useSWR<Project[]>('/api/projects');
  const [adding, setAdding] = useState(false);
  const deptName = (id: string) => {
    const name = departments?.find((d) => d._id === id)?.name;
    return name ? t(name) : id;
  };
  const projName = (id: string) => projects?.find((p) => p._id === id)?.name ?? id;
  const scopeName = (p: { scopeType: string; scopeId: string }) => (p.scopeType === 'company' ? t('Cả công ty') : p.scopeType === 'department' ? deptName(p.scopeId) : projName(p.scopeId));
  const company = data?.policies.find((p) => p.scopeType === 'company' && p.windowKind === 'month' && p.active);
  const open = data?.incidents.filter((i) => i.status === 'open') ?? [];

  const resolve = async (inc: BudgetIncident, action: 'raise_and_resume' | 'keep_paused' | 'dismiss') => {
    let amountUsd: number | undefined;
    if (action === 'raise_and_resume') {
      const v = window.prompt(t('Hạn mức mới (USD) – phải lớn hơn số đã chi {amount}', { amount: `$${inc.amountObserved.toFixed(2)}` }), String(Math.ceil(inc.amountObserved * 1.5)));
      if (!v) return;
      amountUsd = Number(v);
    }
    try {
      await api.post(`/api/budgets/incidents/${inc._id}`, { action, amountUsd });
      await mutate('/api/costs');
      toast.success(action === 'raise_and_resume' ? t('Đã nâng hạn mức và chạy tiếp') : t('Đã cập nhật'));
    } catch (e) {
      toast.error(e);
    }
  };
  const removePolicy = async (p: BudgetPolicy) => {
    const ok = await confirmDialog({ title: t('Xoá ngân sách?'), message: t('Bỏ hạn mức của {scope}.', { scope: scopeName(p) }), confirmLabel: t('Xoá'), tone: 'danger' });
    if (!ok) return;
    await api.del(`/api/budgets?id=${p._id}`);
    await mutate('/api/costs');
  };

  return (
    <Page>
      <PageHeader
        eyebrow={t('Vận hành')}
        title={t('Chi phí & ngân sách')}
        description={t('Mọi lượt chạy của agent được ghi token và chi phí. Đặt ngân sách cho công ty, phòng ban hoặc dự án – cảnh báo sớm và tự tạm dừng khi vượt.')}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>
            {t('Thêm ngân sách')}
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          {open.length > 0 && (
            <Card className="border-danger/30 p-4">
              {open.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center gap-2 py-1 text-[13.5px]">
                  <AlertTriangle className={clsx('size-4', i.threshold === 'hard' ? 'text-danger' : 'text-warn')} />
                  <b>{scopeName(i)}</b>
                  <span className="text-muted">
                    {i.threshold === 'hard' ? t('đã chạm hạn mức – đang tạm dừng') : t('sắp hết ngân sách')} ({usd(i.amountObserved)} / {usd(i.amountLimit)}) · {timeAgo(i.createdAt)}
                  </span>
                  <span className="ml-auto flex gap-1.5">
                    {i.threshold === 'hard' ? (
                      <>
                        <Button size="xs" variant="primary" onClick={() => resolve(i, 'raise_and_resume')}>
                          {t('Nâng hạn mức & chạy tiếp')}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => resolve(i, 'keep_paused')}>
                          {t('Giữ tạm dừng')}
                        </Button>
                      </>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => resolve(i, 'dismiss')}>
                        {t('Đã biết')}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <div className="text-[12.5px] text-muted">{t('Chi tháng này')}</div>
              <div className="mt-1 font-display text-[32px] font-semibold">{usd(data.monthUsd)}</div>
              {company && (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className={clsx('h-full rounded-full', data.monthUsd >= company.amountUsd ? 'bg-danger' : data.monthUsd >= company.amountUsd * (company.warnPercent / 100) ? 'bg-warn' : 'bg-ok')} style={{ width: `${Math.min(100, (data.monthUsd / company.amountUsd) * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-[12px] text-muted">{t('Ngân sách công ty {amount}/tháng', { amount: usd(company.amountUsd) })}</div>
                </>
              )}
            </Card>
            <Card className="p-5">
              <div className="text-[12.5px] text-muted">{t('Tính tiền theo API')}</div>
              <div className="mt-1 font-display text-[32px] font-semibold">{usd(data.monthApiUsd)}</div>
              <div className="mt-1 text-[12px] text-muted">{t('Phần còn lại là chi phí ước tính của gói đăng ký')}</div>
            </Card>
            <Card className="p-5">
              <div className="text-[12.5px] text-muted">{t('Token tháng này')}</div>
              <div className="mt-1 font-display text-[32px] font-semibold">{tok(data.monthTokens.input + data.monthTokens.output)}</div>
              <div className="mt-1 text-[12px] text-muted">
                {t('vào {input} · ra {output}', { input: tok(data.monthTokens.input), output: tok(data.monthTokens.output) })}
              </div>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('Chi phí 14 ngày')} />
              <div className="px-6 pb-5">
                <Bars data={data.daily} value={(i) => [data.daily[i].usd]} label={(i) => `${data.daily[i].date}: ${usd(data.daily[i].usd)}`} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('Lượt chạy 14 ngày')} description={t('Xanh: thành công · Đỏ: lỗi · Xám: khác (huỷ, hết hạn mức, chờ)')} />
              <div className="px-6 pb-5">
                <Bars data={data.runs} value={(i) => [data.runs[i].succeeded, data.runs[i].failed, data.runs[i].other]} label={(i) => `${data.runs[i].date}: ${t('{n} lượt', { n: data.runs[i].total })}`} />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title={t('Ngân sách')} description={t('Cảnh báo ở mức %; chạm 100% thì phạm vi đó tạm dừng và xin bạn duyệt vượt ngân sách.')} icon={<Wallet className="size-4" />} />
            <div className="space-y-2 px-6 pb-5">
              {!data.policies.length && <p className="text-[13px] text-muted">{t('Chưa đặt ngân sách nào.')}</p>}
              {data.policies.map((p) => {
                const pct = p.amountUsd ? Math.min(100, (p.spentUsd / p.amountUsd) * 100) : 0;
                return (
                  <div key={p._id} className="rounded-xl border border-line px-3 py-2.5 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{scopeName(p)}</b>
                      <Badge color="#958B7E">{p.windowKind === 'month' ? t('Mỗi tháng') : t('Trọn đời')}</Badge>
                      {!p.active && <Badge color="#7A7268">{t('Tắt')}</Badge>}
                      {p.hardStop && <Badge color="#C4483F">{t('Tự tạm dừng')}</Badge>}
                      {p.apiOnly && <Badge color="#4A86BD">{t('Chỉ API')}</Badge>}
                      <span className="ml-auto font-mono text-[12.5px]">
                        {usd(p.spentUsd)} / {usd(p.amountUsd)}
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => removePolicy(p)} icon={<Trash2 className="size-3.5" />} aria-label={t('Xoá')} />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= p.warnPercent ? 'bg-warn' : 'bg-ok')} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title={t('Theo phòng ban')} rows={data.byDepartment} name={deptName} />
            <Breakdown title={t('Theo dự án')} rows={data.byProject} name={projName} />
            <Breakdown title={t('Theo kết nối AI')} rows={data.byProvider} name={(x) => x} />
            <Breakdown title={t('Theo model')} rows={data.byModel} name={(x) => x} />
          </div>
        </div>
      )}
      {adding && <PolicyEditor departments={departments ?? []} projects={(projects ?? []).filter((p) => !p.internal)} onClose={() => setAdding(false)} />}
    </Page>
  );
}
