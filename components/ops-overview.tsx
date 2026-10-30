'use client';
// Tổng quan vận hành (theo Paperclip): nhân sự, chi tiêu tháng so với ngân sách, sự cố ngân sách, lượt chạy 14 ngày,
// lượt chạy im lặng (có thể bị kẹt) và hoạt động gần đây.
import Link from 'next/link';
import useSWR from 'swr';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Bot, History, Wallet } from 'lucide-react';
import type { ActivityEntry, Task } from '@/lib/types';
import { timeAgo } from '@/lib/client/format';
import { localizedContent, t, tc } from '@/lib/i18n';
import { Card, CardHeader, Skeleton } from './ui';

interface Ops {
  company: { name: string; mission: string; status: string };
  agents: { active: number; running: number; paused: number; error: number };
  costs: { monthUsd: number; budgetUsd: number; spentVsBudget: number };
  incidents: number;
  runs: { date: string; succeeded: number; failed: number; other: number; total: number }[];
  stuck: { runId: string; level: 'suspicious' | 'critical'; task: Pick<Task, '_id' | 'identifier' | 'title' | 'projectId'> | null }[];
  activity: ActivityEntry[];
}

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

export function OpsOverview() {
  const { data } = useSWR<Ops>('/api/overview/ops', { refreshInterval: 30_000 });
  if (!data) return <Skeleton className="mt-6 h-48" />;
  const max = Math.max(...data.runs.map((r) => r.total), 1);
  const pct = data.costs.budgetUsd ? Math.min(100, (data.costs.spentVsBudget / data.costs.budgetUsd) * 100) : 0;
  return (
    <section className="mt-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] font-semibold tracking-tight">{t('Vận hành {name}', { name: data.company.name })}</h2>
          {data.company.mission && <p className="text-[13px] text-muted">{data.company.mission.split('\n')[0]}</p>}
        </div>
        {data.company.status === 'paused' && (
          <Link href="/company" className="rounded-full bg-warn/15 px-3 py-1 text-[12.5px] font-medium text-warn">
            {t('Công ty đang tạm dừng')}
          </Link>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Bot className="size-4" /> {t('Nhân sự AI')}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            {[
              { l: t('Hoạt động'), v: data.agents.active, c: '#5C9A68' },
              { l: t('Đang chạy'), v: data.agents.running, c: '#4A86BD' },
              { l: t('Tạm dừng'), v: data.agents.paused, c: '#C9952F' },
              { l: t('Lỗi'), v: data.agents.error, c: '#C4483F' },
            ].map((x) => (
              <div key={x.l}>
                <div className="font-display text-[24px] font-semibold" style={{ color: x.v ? x.c : undefined }}>
                  {x.v}
                </div>
                <div className="text-[11px] text-subtle">{x.l}</div>
              </div>
            ))}
          </div>
          <Link href="/org" className="mt-3 flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
            {t('Sơ đồ tổ chức')} <ArrowRight className="size-3" />
          </Link>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Wallet className="size-4" /> {t('Chi tiêu tháng này')}
          </div>
          <div className="mt-1 font-display text-[28px] font-semibold">{usd(data.costs.monthUsd)}</div>
          {data.costs.budgetUsd > 0 ? (
            <>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className={clsx('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-ok')} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-[12px] text-muted">
                {t('{pct}% ngân sách {budget}', { pct: Math.round(pct), budget: usd(data.costs.budgetUsd) })}
              </div>
            </>
          ) : (
            <div className="text-[12px] text-subtle">{t('Chưa đặt ngân sách công ty')}</div>
          )}
          <Link href="/costs" className={clsx('mt-2 flex items-center gap-1 text-[12.5px] hover:text-fg', data.incidents ? 'font-medium text-danger' : 'text-muted')}>
            {data.incidents ? t('{n} sự cố ngân sách đang mở', { n: data.incidents }) : t('Chi phí & ngân sách')} <ArrowRight className="size-3" />
          </Link>
        </Card>
        <Card className="p-5">
          <div className="text-[12.5px] text-muted">{t('Lượt chạy 14 ngày')}</div>
          <div className="mt-3 flex h-20 items-end gap-1">
            {data.runs.map((r) => (
              <div key={r.date} className="flex h-full flex-1 flex-col justify-end" title={t('{date}: {ok} xong, {failed} lỗi, {other} khác', { date: r.date, ok: r.succeeded, failed: r.failed, other: r.other })}>
                <div className="flex flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${Math.max(3, (r.total / max) * 100)}%` }}>
                  <div style={{ flex: r.succeeded, background: '#5C9A68' }} />
                  <div style={{ flex: r.failed, background: '#C4483F' }} />
                  <div style={{ flex: r.other, background: '#958B7E' }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[11.5px] text-subtle">{t('{n} lượt · {failed} lỗi', { n: data.runs.reduce((s, r) => s + r.total, 0), failed: data.runs.reduce((s, r) => s + r.failed, 0) })}</div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('Có thể bị kẹt')} description={t('Lượt chạy im lặng hơn 5 phút')} icon={<AlertTriangle className="size-4" />} />
          <div className="space-y-1.5 px-6 pb-5">
            {!data.stuck.length ? (
              <p className="text-[13px] text-muted">{t('Không có lượt chạy nào bị im lặng.')}</p>
            ) : (
              data.stuck.map((s) => (
                <Link key={s.runId} href={s.task ? `/projects/${s.task.projectId}?task=${s.task._id}` : '/tasks'} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px] hover:border-line-strong">
                  <AlertTriangle className={clsx('size-3.5', s.level === 'critical' ? 'text-danger' : 'text-warn')} />
                  <span className="truncate">
                    {s.task?.identifier} {s.task?.title ?? tc('fallback', 'Nhiệm vụ')}
                  </span>
                  <span className={clsx('ml-auto shrink-0 text-[12px]', s.level === 'critical' ? 'text-danger' : 'text-warn')}>{s.level === 'critical' ? t('> 15 phút') : t('> 5 phút')}</span>
                </Link>
              ))
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title={t('Hoạt động gần đây')}
            icon={<History className="size-4" />}
            actions={
              <Link href="/activity" className="flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
                {t('Tất cả')} <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="space-y-1.5 px-6 pb-5">
            {!data.activity.length ? (
              <p className="text-[13px] text-muted">{t('Chưa có hoạt động.')}</p>
            ) : (
              data.activity.map((a) => (
                <div key={a._id} className="flex gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium">{a.actorName ? t(a.actorName) : 'Agent'}</b> {localizedContent(a.summary, a.summaryI18n ? { i18n: a.summaryI18n } : null)}
                  </span>
                  <span className="shrink-0 text-[12px] text-subtle">{timeAgo(a.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
