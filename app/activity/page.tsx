'use client';
// Nhật ký hoạt động: ai (bạn / agent / hệ thống) làm gì, lúc nào – lọc theo loại và tìm kiếm.
import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import clsx from 'clsx';
import { Bot, History, Search, Settings2, User } from 'lucide-react';
import type { ActivityEntry } from '@/lib/types';
import { localizedContent, m, t } from '@/lib/i18n';
import { fetcher } from '@/lib/client/api';
import { dateTime, timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Button, Card, EmptyState, Input, Segmented, Select, Skeleton } from '@/components/ui';

const TYPES = [
  { v: '', l: m('Tất cả') },
  { v: 'project', l: m('Dự án') },
  { v: 'task', l: m('Nhiệm vụ') },
  { v: 'department', l: m('Phòng ban') },
  { v: 'approval', l: m('Phê duyệt') },
  { v: 'budget', l: m('Ngân sách') },
  { v: 'routine', l: m('Lịch định kỳ') },
  { v: 'goal', l: m('Mục tiêu') },
  { v: 'skill', l: m('Kỹ năng') },
  { v: 'secret', l: m('Bí mật') },
  { v: 'company', l: m('Công ty') },
  { v: 'provider', l: m('Kết nối AI') },
];

const ACTOR_ICON = { user: User, agent: Bot, system: Settings2 } as const;

export default function ActivityPage() {
  const [entityType, setEntityType] = useState('');
  const [actorType, setActorType] = useState<'' | 'user' | 'agent' | 'system'>('');
  const [q, setQ] = useState('');
  const query = (before?: string) =>
    `/api/activity?${new URLSearchParams({ ...(entityType ? { entityType } : {}), ...(actorType ? { actorType } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(before ? { before } : {}), limit: '60' })}`;
  const { data, size, setSize, isLoading } = useSWRInfinite<ActivityEntry[]>((i, prev) => (i === 0 ? query() : prev?.length ? query(prev[prev.length - 1].createdAt) : null), fetcher);
  const rows = (data ?? []).flat();
  const more = (data?.[data.length - 1]?.length ?? 0) === 60;
  return (
    <Page>
      <PageHeader eyebrow={t('Vận hành')} title={t('Nhật ký hoạt động')} description={t('Mọi thay đổi quan trọng đều được ghi lại – ai làm, làm gì, lúc nào. Bí mật luôn được che.')} icon={<History className="size-7 text-accent" />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-auto">
          {TYPES.map((ty) => (
            <option key={ty.v} value={ty.v}>
              {t(ty.l)}
            </option>
          ))}
        </Select>
        <Segmented
          value={actorType}
          onChange={setActorType}
          options={[
            { value: '', label: t('Mọi người') },
            { value: 'user', label: t('Bạn') },
            { value: 'agent', label: t('Agent') },
            { value: 'system', label: t('Hệ thống') },
          ]}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tìm trong nhật ký…')} className="pl-9" />
        </div>
      </div>
      {isLoading && !data ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={<History className="size-6" />} title={t('Chưa có hoạt động')} description={t('Hoạt động của bạn và các agent sẽ hiện ở đây.')} />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((a) => {
            const Icon = ACTOR_ICON[a.actorType];
            return (
              <div key={a._id} className="flex items-start gap-3 px-4 py-3 text-[13.5px]">
                <span className={clsx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', a.actorType === 'user' ? 'bg-accent/12 text-accent' : a.actorType === 'agent' ? 'bg-[#4A86BD]/12 text-[#4A86BD]' : 'bg-surface-3 text-muted')}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div>
                    <b className="font-medium">{a.actorName ? t(a.actorName) : a.actorType === 'user' ? t('Bạn') : a.actorType === 'system' ? t('Hệ thống') : t('Agent')}</b> <span>{localizedContent(a.summary, { i18n: a.summaryI18n })}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-subtle">{a.action}</div>
                </div>
                <span className="shrink-0 text-[12px] text-subtle" title={dateTime(a.createdAt)}>
                  {timeAgo(a.createdAt)}
                </span>
              </div>
            );
          })}
        </Card>
      )}
      {more && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => setSize(size + 1)}>
            {t('Xem thêm')}
          </Button>
        </div>
      )}
    </Page>
  );
}
