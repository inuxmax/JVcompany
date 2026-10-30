'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { ShieldCheck } from 'lucide-react';
import type { Approval, Department } from '@/lib/types';
import { t } from '@/lib/i18n';
import { Page, PageHeader } from '@/components/shell';
import { Card, EmptyState, Segmented, Skeleton } from '@/components/ui';
import { ApprovalCard } from '@/components/approval-card';

interface Resp {
  approvals: Approval[];
  projectNames: Record<string, string>;
  departmentNames: Record<string, string>;
}

export default function ApprovalsPage() {
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const { data } = useSWR<Resp>(view === 'pending' ? '/api/approvals?status=pending' : '/api/approvals');
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const list = (data?.approvals ?? []).filter((a) => (view === 'pending' ? a.status === 'pending' : a.status !== 'pending'));

  return (
    <Page>
      <PageHeader
        title={t('Phê duyệt')}
        description={t('Khi agent muốn chạy lệnh, ghi tệp ngoài dự án hoặc điều khiển máy tính vượt quyền được cấp, yêu cầu sẽ chờ bạn ở đây.')}
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'pending', label: t('Đang chờ') },
              { value: 'history', label: t('Lịch sử') },
            ]}
          />
        }
      />
      {!data ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title={view === 'pending' ? t('Không có yêu cầu nào đang chờ') : t('Chưa có lịch sử')}
            description={t('Mức quyền của từng dự án quyết định thao tác nào cần hỏi bạn. Đổi trong Cài đặt dự án.')}
          />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {list.map((a) => (
            <ApprovalCard
              key={a._id}
              approval={a}
              department={departments?.find((d) => d._id === a.departmentId)}
              projectName={data.projectNames[a.projectId]}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
