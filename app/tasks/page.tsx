'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ListChecks } from 'lucide-react';
import type { Department, Project, Task } from '@/lib/types';
import { TASK_STATUS } from '@/lib/catalog';
import { timeAgo } from '@/lib/client/format';
import { t } from '@/lib/i18n';
import { Page, PageHeader } from '@/components/shell';
import { Card, DeptAvatar, EmptyState, Segmented, Select, Skeleton } from '@/components/ui';
import { ProviderLine, TaskStatusBadge, WaitingLimitNote } from '@/components/domain';

type Group = 'open' | 'active' | 'waiting' | 'done' | 'failed';

export default function TasksPage() {
  const { data: tasks } = useSWR<Task[]>('/api/tasks?limit=800');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const { data: projects } = useSWR<Project[]>('/api/projects');
  const [group, setGroup] = useState<Group>('open');
  const [dept, setDept] = useState('');

  const rows = useMemo(() => {
    const list = (tasks ?? []).filter((task) => {
      const g = TASK_STATUS[task.status].group;
      const okGroup = group === 'open' ? g === 'queue' || g === 'active' || g === 'waiting' : g === group;
      return okGroup && (!dept || task.departmentId === dept);
    });
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [tasks, group, dept]);
  const count = (g: Group) =>
    (tasks ?? []).filter((task) => {
      const x = TASK_STATUS[task.status].group;
      return g === 'open' ? x === 'queue' || x === 'active' || x === 'waiting' : x === g;
    }).length;
  const projectName = (id: string) => projects?.find((p) => p._id === id)?.name ?? '';

  return (
    <Page>
      <PageHeader title={t('Nhiệm vụ')} description={t('Mọi nhiệm vụ của các phòng ban trên tất cả dự án – theo dõi, lọc và mở chi tiết.')} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Group>
          value={group}
          onChange={setGroup}
          options={[
            { value: 'open', label: t('Đang mở'), count: count('open') },
            { value: 'active', label: t('Đang làm'), count: count('active') },
            { value: 'waiting', label: t('Đang chờ'), count: count('waiting') },
            { value: 'done', label: t('Hoàn thành'), count: count('done') },
            { value: 'failed', label: t('Lỗi / Hủy'), count: count('failed') },
          ]}
        />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-56">
          <option value="">{t('Tất cả phòng ban')}</option>
          {departments?.map((d) => (
            <option key={d._id} value={d._id}>
              {t(d.name)}
            </option>
          ))}
        </Select>
      </div>
      <Card className="overflow-hidden">
        {!tasks ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-5" />} title={t('Không có nhiệm vụ')} description={t('Nhiệm vụ xuất hiện khi dự án chạy hoặc khi bạn nhắn trực tiếp cho phòng ban.')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((task) => {
              const d = departments?.find((x) => x._id === task.departmentId);
              return (
                <li key={task._id}>
                  <Link href={`/projects/${task.projectId}?task=${task._id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    {d && <DeptAvatar icon={d.icon} color={d.color} size="sm" busy={task.status === 'running'} />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">{task.title}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                        <span>{d && t(d.name)}</span>
                        <span>· {projectName(task.projectId)}</span>
                        <WaitingLimitNote task={task} />
                      </div>
                    </div>
                    <div className="hidden w-48 text-right sm:block">
                      <ProviderLine task={task} />
                      <div className="text-[11.5px] text-subtle">{timeAgo(task.updatedAt)}</div>
                    </div>
                    <TaskStatusBadge status={task.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
}
