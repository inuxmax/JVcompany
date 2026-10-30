'use client';
// Ngăn chi tiết nhiệm vụ: hướng dẫn, kết quả, nhật ký, chuyển tiếp thủ công (trình duyệt), hành động.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Ban, Clipboard, ExternalLink, Play, RotateCcw, Send, Zap } from 'lucide-react';
import type { Department, Message, Task } from '@/lib/types';
import { TASK_STATUS, WEB_TARGETS } from '@/lib/catalog';
import { api, desktop } from '@/lib/client/api';
import { compact, dateTime, timeAgo } from '@/lib/client/format';
import { t, tc } from '@/lib/i18n';
import { Badge, Button, DeptAvatar, Drawer, Markdown, Select, Skeleton, Textarea, toast } from './ui';
import { MessageItem, ProviderLine, TaskStatusBadge, WaitingLimitNote } from './domain';
import { TaskComment, TaskPermission, TaskProducts, TaskQuestion, TaskReview, TaskRuns, type PermissionBreakdown } from './task-extras';
import { TaskDocuments } from './task-documents';

// Gọi lúc render (t() không chạy ở cấp module).
function kindLabel(kind: Task['kind']): string {
  const labels: Record<Task['kind'], string> = {
    phase: t('Chủ trì giai đoạn'),
    delegated: t('Được giao'),
    review: tc('task-kind', 'Phê duyệt'),
    heartbeat: t('Heartbeat (tự rà soát)'),
    routine: t('Lịch định kỳ'),
    chat: t('Yêu cầu trực tiếp'),
  };
  return labels[kind];
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold tracking-wider text-subtle uppercase">{title}</h4>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ManualRelay({ task }: { task: Task }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task.manualPrompt ?? '');
      toast.success(t('Đã sao chép prompt'));
    } catch {
      toast.error(t('Không sao chép được – hãy chọn và sao chép thủ công'));
    }
  };
  const open = (url: string) => {
    const d = desktop();
    if (d) void d.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${task._id}`, { action: 'manual_response', content: reply });
      toast.success(t('Đã gửi kết quả cho hệ thống'));
      setReply('');
      await mutate(`/api/tasks/${task._id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t('Chuyển tiếp qua trình duyệt')}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-muted">
        <li>{t('Sao chép prompt chuẩn bên dưới.')}</li>
        <li>{t('Dán vào ChatGPT / Claude.ai / Gemini / Grok (gói đăng ký của bạn).')}</li>
        <li>{t('Sao chép toàn bộ câu trả lời (kèm khối {block}) và dán vào ô cuối.', { block: 'vp-result' })}</li>
      </ol>
      <div className="mb-2 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={copy} icon={<Clipboard className="size-3.5" />}>
          {t('Sao chép prompt ({n} ký tự)', { n: compact(task.manualPrompt?.length ?? 0) })}
        </Button>
        {WEB_TARGETS.map((w) => (
          <Button key={w.url} variant="outline" size="sm" onClick={() => open(w.url)} icon={<ExternalLink className="size-3.5" />}>
            {w.label}
          </Button>
        ))}
      </div>
      <details className="mb-3 rounded-xl border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-muted">{t('Xem prompt')}</summary>
        <pre className="max-h-72 overflow-auto border-t border-line p-3 font-mono text-[11.5px] whitespace-pre-wrap">{task.manualPrompt}</pre>
      </details>
      <Textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder={t('Dán câu trả lời từ AI vào đây…')}
        className="min-h-[180px] font-mono text-[12.5px]"
      />
      <div className="mt-2 flex justify-end">
        <Button variant="primary" onClick={submit} loading={busy} disabled={!reply.trim()} icon={<Send className="size-4" />}>
          {t('Gửi kết quả')}
        </Button>
      </div>
    </Section>
  );
}

export function TaskDrawer({
  taskId,
  departments,
  onClose,
  onOpenTask,
}: {
  taskId: string;
  departments: Department[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const key = `/api/tasks/${taskId}`;
  const { data } = useSWR<{ task: Task; messages: Message[]; children: Task[]; permission?: PermissionBreakdown | null }>(key, {
    refreshInterval: (d) => (d?.task.status === 'running' ? 1500 : 0),
  });
  const [reassign, setReassign] = useState('');
  const task = data?.task;
  const dept = departments.find((d) => d._id === task?.departmentId);
  const assigner = task ? departments.find((d) => d._id === task.assignedBy) : null;

  const act = async (action: string, extra?: Record<string, unknown>) => {
    try {
      await api.patch(key, { action, ...extra });
      await mutate(key);
      toast.success(t('Đã cập nhật nhiệm vụ'));
    } catch (e) {
      toast.error(e);
    }
  };

  const active = task && !['done', 'failed', 'cancelled'].includes(task.status);

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={
        task ? (
          <div className="flex items-start gap-3">
            {dept && <DeptAvatar icon={dept.icon} color={dept.color} busy={task.status === 'running'} />}
            <div className="min-w-0">
              <div className="line-clamp-2">
                {task.identifier && <span className="mr-2 font-mono text-[13px] text-subtle">{task.identifier}</span>}
                {task.title}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] font-normal">
                <TaskStatusBadge status={task.status} />
                <Badge color="#958B7E">{kindLabel(task.kind)}</Badge>
                <span className="text-muted">{dept ? t(dept.name) : null}</span>
              </div>
            </div>
          </div>
        ) : (
          t('Đang tải…')
        )
      }
    >
      {!task ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            {active && (
              <Button variant="danger" size="sm" onClick={() => act('cancel')} icon={<Ban className="size-3.5" />}>
                {t('Hủy')}
              </Button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'done') && (
              <Button variant="secondary" size="sm" onClick={() => act('retry')} icon={<RotateCcw className="size-3.5" />}>
                {t('Chạy lại')}
              </Button>
            )}
            {task.status === 'waiting_limit' && (
              <Button variant="secondary" size="sm" onClick={() => act('run_now')} icon={<Zap className="size-3.5" />}>
                {t('Thử ngay')}
              </Button>
            )}
            {(task.status === 'queued' || task.status === 'waiting_limit' || task.status === 'failed' || task.status === 'waiting_human') && (
              <div className="flex items-center gap-1.5">
                <Select value={reassign} onChange={(e) => setReassign(e.target.value)} className="h-8 w-48 text-[12.5px]">
                  <option value="">{t('Giao cho phòng khác…')}</option>
                  {departments
                    .filter((d) => d._id !== task.departmentId)
                    .map((d) => (
                      <option key={d._id} value={d._id}>
                        {t(d.name)}
                      </option>
                    ))}
                </Select>
                <Button size="sm" variant="outline" disabled={!reassign} onClick={() => act('reassign', { departmentId: reassign })} icon={<Play className="size-3.5" />}>
                  {t('Giao')}
                </Button>
              </div>
            )}
            <div className="ml-auto text-right text-[12px] text-subtle">
              <ProviderLine task={task} />
              <div>
                {t('Lần chạy: {n} · tạo {time}', { n: task.attempts, time: timeAgo(task.createdAt) })}
              </div>
            </div>
          </div>

          {task.status === 'waiting_limit' && (
            <div className="border-b border-line bg-warn/10 px-5 py-3 text-[13px] text-warn">
              ⏳ {task.error ?? t('Đang chờ hạn mức.')} <WaitingLimitNote task={task} />
              {task.retryAt && <span className="ml-1">({dateTime(task.retryAt)})</span>}
            </div>
          )}
          {task.status === 'failed' && task.error && (
            <div className="border-b border-line bg-danger/10 px-5 py-3 text-[13px] text-danger">{task.error}</div>
          )}

          {task.status === 'waiting_human' && task.manualPrompt && <ManualRelay task={task} />}
          <TaskQuestion task={task} />
          <TaskReview task={task} departments={departments} />
          <TaskProducts task={task} />
          <TaskPermission task={task} permission={data.permission} />
          <TaskDocuments task={task} departmentName={dept ? t(dept.name) : undefined} />

          {task.status === 'running' && task.liveText && (
            <Section title={t('Đang soạn…')}>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-dashed border-line-strong p-3 text-muted">
                <Markdown>{task.liveText}</Markdown>
              </div>
            </Section>
          )}

          {task.result && (
            <Section title={task.status === 'waiting_children' ? t('Báo cáo lượt trước') : t('Kết quả')}>
              {task.decision && (
                <Badge color={task.decision === 'approve' ? '#5C9A68' : '#C4483F'} className="mb-2">
                  {task.decision === 'approve' ? t('Phê duyệt') : t('Từ chối')}
                </Badge>
              )}
              <Markdown>{task.result}</Markdown>
              {task.output && task.output.trim() !== task.result.trim() && (
                <details className="mt-3 rounded-xl border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-muted">{t('Toàn văn đầu ra')}</summary>
                  <div className="border-t border-line p-3">
                    <Markdown>{task.output}</Markdown>
                  </div>
                </details>
              )}
            </Section>
          )}

          {data.children.length > 0 && (
            <Section title={t('Việc đã giao ({n})', { n: data.children.length })}>
              <div className="space-y-1.5">
                {data.children.map((c) => {
                  const cd = departments.find((d) => d._id === c.departmentId);
                  return (
                    <button
                      key={c._id}
                      type="button"
                      onClick={() => onOpenTask(c._id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2"
                    >
                      {cd && <DeptAvatar icon={cd.icon} color={cd.color} size="sm" busy={c.status === 'running'} />}
                      <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                      <TaskStatusBadge status={c.status} />
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title={t('Hướng dẫn nhiệm vụ')}>
            <div className="mb-2 text-[12.5px] text-muted">
              {t('Giao bởi:')}{' '}
              {task.assignedBy === 'user' ? t('Bạn') : task.assignedBy === 'system' ? t('Quy trình') : assigner ? t(assigner.name) : task.assignedBy} · {t('Ưu tiên: {p}', { p: task.priority })}
              {task.round > 0 && ` · ${t('Lượt {n}', { n: task.round + 1 })}`}
            </div>
            <details open={task.instructions.length < 1200}>
              <summary className="mb-2 cursor-pointer text-[12.5px] text-subtle">{t('Hiện/ẩn')}</summary>
              <Markdown>{task.instructions}</Markdown>
            </details>
          </Section>

          <TaskRuns task={task} />
          <TaskComment task={task} />

          <Section title={t('Nhật ký ({n})', { n: data.messages.length })}>
            {data.messages.length === 0 ? (
              <div className="text-[13px] text-muted">{t('Chưa có hoạt động.')}</div>
            ) : (
              data.messages.map((m) => <MessageItem key={m._id} message={m} departments={departments} />)
            )}
          </Section>

          {task.usage && (task.usage.inputTokens > 0 || task.usage.outputTokens > 0) && (
            <div className="px-5 py-3 text-[12px] text-subtle">
              {t('Token: {input} vào · {output} ra', { input: compact(task.usage.inputTokens), output: compact(task.usage.outputTokens) })}
              {task.usage.costUsd ? ` · ~$${task.usage.costUsd.toFixed(3)}` : ''} · {TASK_STATUS[task.status].label}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
