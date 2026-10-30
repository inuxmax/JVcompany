'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { FolderKanban, FolderOpen, Plus, Search } from 'lucide-react';
import type { Project, ProjectStatus, Workflow } from '@/lib/types';
import { PERMISSION_LEVELS, findPhase } from '@/lib/catalog';
import { timeAgo } from '@/lib/client/format';
import { t } from '@/lib/i18n';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Segmented, Skeleton } from '@/components/ui';
import { PhaseDots, ProjectStatusBadge } from '@/components/domain';

type Row = Project & { taskCounts: Record<string, number> };
type Filter = 'all' | 'running' | 'paused' | 'completed';

const MATCH: Record<Filter, ProjectStatus[]> = {
  all: ['draft', 'active', 'paused', 'completed', 'blocked', 'cancelled', 'waiting_floor'],
  running: ['active', 'blocked', 'waiting_floor'],
  paused: ['draft', 'paused'],
  completed: ['completed', 'cancelled'],
};

export default function ProjectsPage() {
  const { data, error } = useSWR<Row[]>('/api/projects');
  const { data: workflows } = useSWR<Workflow[]>('/api/workflows');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (p) => MATCH[filter].includes(p.status) && (!needle || `${p.name} ${p.goal} ${p.path ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [data, filter, q]);
  const count = (f: Filter) => (data ?? []).filter((p) => MATCH[f].includes(p.status)).length;

  return (
    <Page>
      <PageHeader
        title={t('Dự án')}
        description={t('Mỗi dự án gắn với một thư mục trên máy tính và đi qua quy trình 7 giai đoạn do các phòng ban AI thực hiện.')}
        actions={
          <Link href="/projects/new">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              {t('Dự án mới')}
            </Button>
          </Link>
        }
      />
      <ErrorNote error={error} className="mb-4" />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('Tất cả'), count: count('all') },
            { value: 'running', label: t('Đang chạy'), count: count('running') },
            { value: 'paused', label: t('Chưa chạy / tạm dừng'), count: count('paused') },
            { value: 'completed', label: t('Đã xong'), count: count('completed') },
          ]}
        />
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tìm dự án…')} className="pl-9" />
        </div>
      </div>

      {!data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title={data.length ? t('Không có dự án phù hợp') : t('Chưa có dự án nào')}
            description={t('Tạo dự án mới, chọn thư mục dự án trên máy tính (Windows, macOS, Linux) và để các phòng ban AI bắt đầu làm việc.')}
            action={
              <Link href="/projects/new">
                <Button variant="primary" icon={<Plus className="size-4" />}>
                  {t('Tạo dự án đầu tiên')}
                </Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const phase = findPhase(workflows, p.currentPhase);
            const perm = PERMISSION_LEVELS.find((x) => x.id === p.permission);
            const running = p.taskCounts.running ?? 0;
            const open =
              (p.taskCounts.queued ?? 0) +
              running +
              (p.taskCounts.waiting_children ?? 0) +
              (p.taskCounts.waiting_approval ?? 0) +
              (p.taskCounts.waiting_limit ?? 0) +
              (p.taskCounts.waiting_human ?? 0);
            return (
              <Link key={p._id} href={`/projects/${p._id}`} className="group">
                <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-line-strong">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="line-clamp-2 text-[16px] font-semibold tracking-tight">{p.name}</h3>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  <p className="mt-1.5 line-clamp-2 min-h-[40px] text-[13px] text-muted">{p.goal || p.description || t('Chưa có mô tả.')}</p>
                  <div className="mt-3 flex items-center gap-1.5 truncate font-mono text-[11.5px] text-subtle">
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="truncate">{p.path ?? t('Không gian làm việc riêng')}</span>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[12px]">
                      <span className="text-muted">{p.status === 'completed' ? t('Đã hoàn thành') : phase ? t(phase.name) : ''}</span>
                      <span className="text-subtle">{timeAgo(p.updatedAt)}</span>
                    </div>
                    <PhaseDots project={p} workflow={workflows?.find((w) => w._id === p.workflowId)} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {perm && <Badge color={perm.color}>{perm.short}</Badge>}
                    {p.autopilot && <Badge color="#8A7DAE">{t('Tự động')}</Badge>}
                    {p.floorId && <Badge color="#C4532A">{t('Tầng {n}', { n: p.floorId.replace('floor-', '') })}</Badge>}
                    <span className="ml-auto text-[12px] text-muted">
                      {open > 0 ? t('{n} việc đang mở', { n: open }) : t('{n} việc đã xong', { n: p.taskCounts.done ?? 0 })}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
