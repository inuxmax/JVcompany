'use client';
// Thẻ yêu cầu phê duyệt thao tác (lệnh shell, ghi tệp ngoài dự án, điều khiển máy tính…).
import { useState } from 'react';
import Link from 'next/link';
import { mutate } from 'swr';
import { Cable, Check, FilePen, FolderSearch, MessageCircleQuestion, MousePointerClick, Terminal, UserPlus, Wallet, X } from 'lucide-react';
import type { Approval, Department } from '@/lib/types';
import { api } from '@/lib/client/api';
import { timeAgo } from '@/lib/client/format';
import { localize, localizedContent, t } from '@/lib/i18n';
import { Badge, Button, Card, DeptAvatar, Input, toast } from './ui';

const TYPE_META: Record<Approval['type'], { label: string; icon: typeof Terminal; color: string }> = localize({
  shell: { label: 'Chạy lệnh', icon: Terminal, color: '#4A86BD' },
  write: { label: 'Ghi tệp', icon: FilePen, color: '#C9952F' },
  read: { label: 'Đọc ngoài dự án', icon: FolderSearch, color: '#8A7DAE' },
  computer: { label: 'Điều khiển máy', icon: MousePointerClick, color: '#C4483F' },
  hire_agent: { label: 'Tuyển nhân sự', icon: UserPlus, color: '#5C9A68' },
  budget_override: { label: 'Vượt ngân sách', icon: Wallet, color: '#C4483F' },
  board_request: { label: 'Xin ý kiến', icon: MessageCircleQuestion, color: '#4A86BD' },
  mcp: { label: 'Dịch vụ (MCP)', icon: Cable, color: '#8A7DAE' },
});

export function ApprovalCard({
  approval,
  department,
  projectName,
}: {
  approval: Approval;
  department?: Pick<Department, 'name' | 'icon' | 'color'>;
  projectName?: string;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const meta = TYPE_META[approval.type];
  const pending = approval.status === 'pending';

  const governance = approval.type === 'hire_agent' || approval.type === 'budget_override' || approval.type === 'board_request';
  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const decide = async (decision: 'approve' | 'deny', scope: 'once' | 'task' = 'once') => {
    let amountUsd: number | undefined;
    // Vượt ngân sách: duyệt = nâng hạn mức → hỏi hạn mức mới
    if (approval.type === 'budget_override' && decision === 'approve') {
      const v = window.prompt(t('Hạn mức mới (USD) – phải lớn hơn số đã chi ${amount}', { amount: Number(payload.observed ?? 0).toFixed(2) }), String(payload.suggestedAmount ?? ''));
      if (!v) return;
      amountUsd = Number(v);
    }
    setBusy(decision + scope);
    try {
      await api.post(`/api/approvals/${approval._id}`, { decision, scope, note, amountUsd });
      await mutate((k) => typeof k === 'string' && (k.startsWith('/api/approvals') || k.startsWith('/api/projects')));
      toast.success(decision === 'approve' ? t('Đã cho phép') : t('Đã từ chối'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        {department ? <DeptAvatar icon={department.icon} color={department.color} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={meta.color}>
              <meta.icon className="size-3" />
              {meta.label}
            </Badge>
            {!pending && (
              <Badge color={approval.status === 'approved' ? '#5C9A68' : approval.status === 'denied' ? '#C4483F' : '#958B7E'}>
                {approval.status === 'approved' ? t('Đã cho phép') : approval.status === 'denied' ? t('Đã từ chối') : t('Hết hạn')}
              </Badge>
            )}
            <span className="text-[12px] text-subtle">{timeAgo(approval.createdAt)}</span>
          </div>
          <div className="mt-1 text-[14px] font-medium break-words">{localizedContent(approval.title, { i18n: approval.titleI18n })}</div>
          <div className="text-[12.5px] text-muted">
            {department?.name && t(department.name)}
            {projectName && approval.projectId && (
              <>
                {' · '}
                <Link href={`/projects/${approval.projectId}?task=${approval.taskId}`} className="hover:text-fg hover:underline">
                  {projectName}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
      <pre className="mx-4 mt-3 max-h-56 overflow-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap">
        {localizedContent(approval.detail, { i18n: approval.detailI18n })}
      </pre>
      {pending ? (
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Ghi chú cho agent (tùy chọn)')} className="h-9 sm:flex-1" />
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={() => decide('deny')} loading={busy === 'denyonce'} icon={<X className="size-3.5" />}>
              {t('Từ chối')}
            </Button>
            {!governance && (
              <Button variant="outline" size="sm" onClick={() => decide('approve', 'task')} loading={busy === 'approvetask'}>
                {t('Cho phép cả nhiệm vụ')}
              </Button>
            )}
            <Button variant="success" size="sm" onClick={() => decide('approve')} loading={busy === 'approveonce'} icon={<Check className="size-3.5" />}>
              {approval.type === 'hire_agent' ? t('Duyệt tuyển') : approval.type === 'budget_override' ? t('Nâng hạn mức & chạy tiếp') : approval.type === 'board_request' ? t('Đồng ý') : t('Cho phép')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-2 pb-4 text-[12px] text-subtle">{approval.note}</div>
      )}
    </Card>
  );
}
