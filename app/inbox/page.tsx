'use client';
// Hộp thư: mọi thứ đang chờ bạn ở một chỗ – phê duyệt, câu hỏi của agent, việc chờ duyệt, ngân sách, lượt chạy im lặng…
// Xử lý ngay tại chỗ (trả lời, duyệt, tiếp tục…) hoặc mở chi tiết.
import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleHelp,
  ClipboardCheck,
  EyeOff,
  FileText,
  Flag,
  Inbox,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { Approval, ChatQuestion, Department, InboxItem, InboxKind } from '@/lib/types';
import { api } from '@/lib/client/api';
import { dateTime, timeAgo } from '@/lib/client/format';
import { Page, PageHeader } from '@/components/shell';
import { Badge, Button, Card, DeptAvatar, EmptyState, Input, Segmented, Skeleton, toast } from '@/components/ui';
import { ApprovalCard } from '@/components/approval-card';
import { m, t } from '@/lib/i18n';

// Nhãn đánh dấu m() và dịch lúc hiển thị (không dùng localize: biểu tượng lucide là đối tượng forwardRef, không nên bọc Proxy)
const KIND: Record<InboxKind, { label: string; icon: typeof Inbox; color: string }> = {
  approval: { label: m('Phê duyệt'), icon: ShieldCheck, color: '#C9952F' },
  question: { label: m('Câu hỏi'), icon: CircleHelp, color: '#C4532A' },
  review: { label: m('Chờ duyệt'), icon: ClipboardCheck, color: '#4A86BD' },
  manual: { label: m('Chuyển tiếp'), icon: Send, color: '#8A7DAE' },
  phase: { label: m('Giai đoạn'), icon: Flag, color: '#4A86BD' },
  budget: { label: m('Ngân sách'), icon: Wallet, color: '#C4483F' },
  silent_run: { label: m('Im lặng'), icon: Timer, color: '#CF6A3D' },
  failed_task: { label: m('Việc lỗi'), icon: XCircle, color: '#C4483F' },
  doc_reply: { label: m('Tài liệu'), icon: FileText, color: '#5C9A68' },
  chat_pairing: { label: 'Telegram', icon: MessageCircle, color: '#4A86BD' },
};

type View = 'action' | 'all' | 'dismissed';

const refresh = () => mutate((k) => typeof k === 'string' && (k.startsWith('/api/inbox') || k.startsWith('/api/approvals') || k.startsWith('/api/tasks')));

export default function InboxPage() {
  const [view, setView] = useState<View>('action');
  const { data } = useSWR<InboxItem[]>(view === 'dismissed' ? '/api/inbox?dismissed=1' : '/api/inbox', { refreshInterval: 30_000 });
  const { data: departments } = useSWR<Department[]>('/api/departments');
  const all = data ?? [];
  const list = view === 'action' ? all.filter((i) => i.actionable) : view === 'all' ? all : all.filter((i) => !i.actionable);
  const unread = all.filter((i) => !i.read);

  const mark = async (ids: string[], action: 'read' | 'dismiss' | 'restore') => {
    if (!ids.length) return;
    try {
      await api.post('/api/inbox', { action, ids });
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow={t('Việc của bạn')}
        title={t('Hộp thư')}
        description={t('Mọi thứ đang chờ bạn: phê duyệt, câu hỏi của agent, việc chờ duyệt, ngân sách, lượt chạy im lặng, việc lỗi. Xử lý ngay ở đây hoặc mở chi tiết.')}
        icon={<Inbox className="size-7 text-accent" />}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'action', label: t('Cần xử lý'), count: all.filter((i) => i.actionable).length },
                { value: 'all', label: t('Tất cả'), count: all.length },
                { value: 'dismissed', label: t('Thông báo') },
              ]}
            />
            <Button variant="outline" size="sm" disabled={!unread.length} onClick={() => mark(unread.map((i) => i.id), 'read')} icon={<CheckCheck className="size-3.5" />}>
              {t('Đã đọc tất cả')}
            </Button>
          </>
        }
      />
      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={<Inbox className="size-6" />}
            title={view === 'action' ? t('Không có gì chờ bạn') : t('Hộp thư trống')}
            description={view === 'action' ? t('Khi agent cần bạn duyệt, trả lời hoặc quyết định, việc đó sẽ hiện ở đây.') : t('Thông báo về việc lỗi, trả lời trên tài liệu… sẽ hiện ở đây.')}
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {list.map((item) =>
            item.kind === 'approval' && item.data?.approval ? (
              <div key={item.id} onClickCapture={() => !item.read && void mark([item.id], 'read')}>
                <ApprovalCard approval={item.data.approval as Approval} department={departments?.find((d) => d._id === item.departmentId)} projectName={item.projectName ?? undefined} />
              </div>
            ) : (
              <InboxRow key={item.id} item={item} department={departments?.find((d) => d._id === item.departmentId)} onMark={mark} dismissedView={view === 'dismissed'} />
            ),
          )}
        </div>
      )}
    </Page>
  );
}

function InboxRow({ item, department, onMark, dismissedView }: { item: InboxItem; department?: Department; onMark: (ids: string[], action: 'read' | 'dismiss' | 'restore') => Promise<void>; dismissedView: boolean }) {
  const meta = KIND[item.kind];
  const Icon = meta.icon;
  const read = () => !item.read && void onMark([item.id], 'read');
  return (
    <Card className={clsx('p-4', !item.read && 'ring-1 ring-accent/30')}>
      <div className="flex items-start gap-3" onClick={read}>
        {department ? (
          <DeptAvatar icon={department.icon} color={department.color} size="sm" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${meta.color}1f`, color: meta.color }}>
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!item.read && <span className="size-2 rounded-full bg-accent" aria-label={t('Chưa đọc')} />}
            <Badge color={meta.color}>
              <Icon className="size-3" /> {t(meta.label)}
            </Badge>
            {item.severity === 'critical' && (
              <Badge color="#C4483F">
                <AlertTriangle className="size-3" /> {t('Khẩn')}
              </Badge>
            )}
            {item.projectName && <span className="truncate text-[12px] text-muted">{item.projectName}</span>}
            <span className="ml-auto shrink-0 text-[12px] text-subtle" title={dateTime(item.createdAt)}>
              {timeAgo(item.createdAt)}
            </span>
          </div>
          <div className="mt-1 text-[14px] font-medium">{item.title}</div>
          {item.detail && <p className="mt-0.5 line-clamp-3 text-[13px] whitespace-pre-line text-muted">{item.detail}</p>}
          <ItemActions item={item} onDone={read} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.href && (
              <Link href={item.href} onClick={read} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
                {t('Mở chi tiết')} <ArrowUpRight className="size-3.5" />
              </Link>
            )}
            {!item.actionable &&
              (dismissedView ? (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onMark([item.id], 'restore')} icon={<Undo2 className="size-3" />}>
                  {t('Hiện lại')}
                </Button>
              ) : (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onMark([item.id], 'dismiss')} icon={<EyeOff className="size-3" />}>
                  {t('Ẩn')}
                </Button>
              ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Thao tác nhanh theo loại mục. */
function ItemActions({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      onDone();
      toast.success(msg);
      await refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const taskUrl = `/api/tasks/${item.taskId}`;
  switch (item.kind) {
    case 'question': {
      const q = item.data?.question as ChatQuestion | undefined;
      const answer = (v: string) => run('answer', () => api.patch(taskUrl, { action: 'answer', content: v }), t('Đã trả lời – nhiệm vụ chạy tiếp'));
      return (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1.5">
            {q?.options
              .filter((o) => !o.freeText)
              .map((o) => (
                <Button key={o.id} size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => answer(o.label)}>
                  {o.label}
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && void answer(text.trim())} placeholder={t('Hoặc nhập câu trả lời…')} className="h-9 text-[13px]" />
            <Button size="sm" variant="primary" loading={busy === 'answer'} disabled={!text.trim()} onClick={() => answer(text.trim())} icon={<Send className="size-3.5" />}>
              {t('Gửi')}
            </Button>
          </div>
        </div>
      );
    }
    case 'review':
      return (
        <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Góp ý (bắt buộc khi yêu cầu sửa)…')} className="h-9 min-w-[200px] flex-1 text-[13px]" />
          <Button size="sm" variant="success" loading={busy === 'approve'} onClick={() => run('approve', () => api.patch(taskUrl, { action: 'review', decision: 'approve', content: text }), t('Đã duyệt'))} icon={<Check className="size-3.5" />}>
            {t('Duyệt')}
          </Button>
          <Button size="sm" variant="outline" disabled={!text.trim() || Boolean(busy)} onClick={() => run('changes', () => api.patch(taskUrl, { action: 'review', decision: 'changes', content: text }), t('Đã yêu cầu sửa'))} icon={<Undo2 className="size-3.5" />}>
            {t('Yêu cầu sửa')}
          </Button>
        </div>
      );
    case 'silent_run': {
      const runId = String(item.data?.runId ?? '');
      const act = (action: string, label: string) => run(action, () => api.post(`/api/runs/${runId}`, { action, minutes: 60 }), label);
      return (
        <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="outline" loading={busy === 'continue'} onClick={() => act('continue', t('Tiếp tục canh chừng sau 30 phút'))}>
            {t('Tiếp tục (30 phút)')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => act('snooze', t('Đã hoãn 1 giờ'))}>
            {t('Hoãn 1 giờ')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => act('dismiss', t('Đã bỏ qua'))}>
            {t('Bỏ qua')}
          </Button>
          <Button size="xs" variant="danger" onClick={() => act('cancel', t('Đã dừng nhiệm vụ'))}>
            {t('Dừng')}
          </Button>
        </div>
      );
    }
    case 'failed_task':
      return (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="outline" loading={busy === 'retry'} onClick={() => run('retry', () => api.patch(taskUrl, { action: 'retry' }), t('Đã xếp hàng chạy lại'))} icon={<RotateCcw className="size-3" />}>
            {t('Chạy lại')}
          </Button>
        </div>
      );
    case 'budget': {
      const inc = item.data?.incident as { _id: string; amountObserved: number; threshold: string } | undefined;
      if (!inc) return null;
      const url = `/api/budgets/incidents/${inc._id}`;
      return (
        <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          {inc.threshold === 'hard' && (
            <>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Hạn mức mới (> ${amount})', { amount: inc.amountObserved.toFixed(2) })} className="h-8 w-48 text-[12.5px]" inputMode="decimal" />
              <Button size="xs" variant="primary" disabled={!(Number(text) > inc.amountObserved)} loading={busy === 'raise'} onClick={() => run('raise', () => api.post(url, { action: 'raise_and_resume', amountUsd: Number(text) }), t('Đã nâng hạn mức và chạy tiếp'))}>
                {t('Nâng hạn mức & chạy tiếp')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => run('keep', () => api.post(url, { action: 'keep_paused' }), t('Giữ tạm dừng'))}>
                {t('Giữ tạm dừng')}
              </Button>
            </>
          )}
          {inc.threshold !== 'hard' && (
            <Button size="xs" variant="ghost" onClick={() => run('dismiss', () => api.post(url, { action: 'dismiss' }), t('Đã đóng cảnh báo'))}>
              {t('Đóng cảnh báo')}
            </Button>
          )}
        </div>
      );
    }
    case 'chat_pairing': {
      const bindingId = String(item.data?.bindingId ?? '');
      const url = `/api/connectors/bindings/${bindingId}`;
      return (
        <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="success" loading={busy === 'approve'} onClick={() => run('approve', () => api.patch(url, { status: 'active' }), t('Đã duyệt cuộc trò chuyện'))} icon={<Check className="size-3" />}>
            {t('Duyệt')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => run('block', () => api.patch(url, { status: 'blocked' }), t('Đã chặn'))}>
            {t('Chặn')}
          </Button>
        </div>
      );
    }
    default:
      return null;
  }
}
