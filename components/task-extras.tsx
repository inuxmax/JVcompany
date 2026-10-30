'use client';
// Phần mở rộng của ngăn nhiệm vụ (theo Paperclip): câu hỏi chờ trả lời, duyệt nhiều bước, sản phẩm công việc,
// lượt chạy (kèm canh chừng im lặng), nhãn, người duyệt và bình luận.
import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { AlertTriangle, Check, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Globe, MessageSquare, Package, Plus, Send, ShieldCheck, Undo2, X } from 'lucide-react';
import type { Department, PermissionLevel, Run, Task, WorkProduct } from '@/lib/types';
import { PERMISSION_LEVELS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { compact, timeAgo } from '@/lib/client/format';
import { localize, t } from '@/lib/i18n';
import { Badge, Button, Select, Textarea, toast } from './ui';

type RunRow = Run & { silence: 'ok' | 'suspicious' | 'critical' };

const RUN_STATUS: Record<Run['status'], { label: string; color: string }> = localize({
  running: { label: 'Đang chạy', color: '#4A86BD' },
  succeeded: { label: 'Thành công', color: '#5C9A68' },
  failed: { label: 'Lỗi', color: '#C4483F' },
  cancelled: { label: 'Đã dừng', color: '#7A7268' },
  limited: { label: 'Hết hạn mức', color: '#CF6A3D' },
  waiting: { label: 'Chờ bạn', color: '#C06587' },
});

const WAKE: Record<string, string> = localize({
  assigned: 'Được giao',
  continue: 'Làm tiếp',
  retry: 'Chạy lại',
  heartbeat: 'Heartbeat',
  routine: 'Lịch định kỳ',
  comment: 'Bình luận',
  changes_requested: 'Yêu cầu sửa',
  question_answered: 'Bạn trả lời',
  review_requested: 'Nhờ duyệt',
  approval_resolved: 'Phê duyệt xong',
  board_request_resolved: 'Đề nghị được phản hồi',
  document_comment: 'Bình luận tài liệu',
});

const PRODUCT_ICON: Record<WorkProduct['type'], typeof Package> = {
  pull_request: GitPullRequest,
  commit: GitCommitHorizontal,
  branch: GitBranch,
  preview_url: Globe,
  file: Package,
  document: Package,
  other: Package,
};

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold tracking-wider text-subtle uppercase">{title}</h4>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Agent đang hỏi bạn → chọn / nhập câu trả lời để nhiệm vụ chạy tiếp. */
export function TaskQuestion({ task }: { task: Task }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (task.status !== 'waiting_human' || !task.question) return null;
  const answer = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${task._id}`, { action: 'answer', content: value });
      await mutate(`/api/tasks/${task._id}`);
      toast.success(t('Đã trả lời – nhiệm vụ chạy tiếp'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t('Agent đang hỏi bạn')}>
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-3">
        <div className="mb-2 text-[13.5px] font-semibold">{task.question.prompt}</div>
        <div className="flex flex-wrap gap-1.5">
          {task.question.options
            .filter((o) => !o.freeText)
            .map((o) => (
              <Button key={o.id} size="sm" variant="outline" disabled={busy} onClick={() => answer(o.label)}>
                {o.label}
              </Button>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Hoặc nhập câu trả lời…')} className="min-w-0 flex-1 text-[13px]" />
          <Button variant="primary" size="sm" className="self-end" disabled={busy || !text.trim()} onClick={() => answer(text)} icon={<Send className="size-3.5" />}>
            {t('Gửi')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** Duyệt nhiều bước: các bước, bước hiện tại, nút duyệt / yêu cầu sửa (khi đến lượt bạn), đặt người duyệt. */
export function TaskReview({ task, departments }: { task: Task; departments: Department[] }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const stages = task.reviewStages ?? [];
  const name = (r: string) => {
    if (r === 'user') return t('Bạn');
    const d = departments.find((x) => x._id === r);
    return d ? t(d.name) : r;
  };
  const pending = stages.find((s) => s.status === 'pending');
  const decide = async (decision: 'approve' | 'changes') => {
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${task._id}`, { action: 'review', decision, content: note });
      await mutate(`/api/tasks/${task._id}`);
      setNote('');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const setReviewers = async (list: string[]) => {
    try {
      await api.patch(`/api/tasks/${task._id}`, { action: 'reviewers', reviewers: list });
      await mutate(`/api/tasks/${task._id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  const editable = !['done', 'cancelled', 'in_review'].includes(task.status);
  if (!stages.length && !editable) return null;
  return (
    <Section title={t('Duyệt nhiều bước')}>
      {stages.length > 0 && (
        <ol className="mb-2 space-y-1.5">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 text-[13px]">
              <span className={clsx('flex size-5 items-center justify-center rounded-full text-[11px] font-semibold', s.status === 'approved' ? 'bg-ok text-white' : s.status === 'pending' ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-subtle')}>
                {s.status === 'approved' ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="font-medium">{name(s.reviewer)}</span>
              <span className="text-muted">{s.status === 'approved' ? t('đã duyệt') : s.status === 'pending' ? t('đang duyệt') : t('chờ tới lượt')}</span>
              {s.note && <span className="truncate text-[12px] text-subtle">– {s.note}</span>}
              {editable && (
                <button type="button" className="ml-auto text-subtle hover:text-danger" onClick={() => setReviewers(stages.filter((x) => x.id !== s.id).map((x) => x.reviewer))} aria-label={t('Bỏ bước')}>
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {task.status === 'in_review' && pending?.reviewer === 'user' && (
        <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent/5 p-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Góp ý (bắt buộc khi yêu cầu sửa)…')} className="text-[13px]" />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => decide('approve')} icon={<Check className="size-3.5" />}>
              {t('Duyệt')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => decide('changes')} icon={<Undo2 className="size-3.5" />}>
              {t('Yêu cầu sửa')}
            </Button>
          </div>
        </div>
      )}
      {editable && (
        <div className="flex items-center gap-1.5">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 w-56 text-[12.5px]">
            <option value="">{t('Thêm người duyệt…')}</option>
            <option value="user">{t('Bạn (chủ công ty)')}</option>
            {departments
              .filter((d) => d.enabled && d._id !== task.departmentId)
              .map((d) => (
                <option key={d._id} value={d._id}>
                  {t(d.name)}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              void setReviewers([...stages.map((s) => s.reviewer), adding]);
              setAdding('');
            }}
            icon={<Plus className="size-3.5" />}
          >
            {t('Thêm bước')}
          </Button>
        </div>
      )}
    </Section>
  );
}

export function TaskProducts({ task }: { task: Task }) {
  if (!task.workProducts?.length) return null;
  return (
    <Section title={t('Sản phẩm công việc ({n})', { n: task.workProducts.length })}>
      <div className="space-y-1.5">
        {task.workProducts.map((p, i) => {
          const Icon = PRODUCT_ICON[p.type] ?? Package;
          return (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px]">
              <Icon className="size-4 text-accent" />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              {p.url && (
                <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  {t('Mở')} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Lượt chạy của nhiệm vụ: kết nối, model, lý do thức dậy, token/chi phí, lỗi; cảnh báo im lặng kèm Tiếp tục / Hoãn / Bỏ qua / Dừng. */
export function TaskRuns({ task }: { task: Task }) {
  const key = `/api/runs?taskId=${task._id}&limit=20`;
  const { data } = useSWR<RunRow[]>(key, { refreshInterval: task.status === 'running' ? 15_000 : 0 });
  if (!data?.length) return null;
  const decide = async (id: string, action: 'continue' | 'snooze' | 'dismiss' | 'cancel') => {
    try {
      await api.post(`/api/runs/${id}`, { action, minutes: 60 });
      await mutate(key);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Section title={t('Lượt chạy ({n})', { n: data.length })}>
      <div className="space-y-1.5">
        {data.map((r) => {
          const st = RUN_STATUS[r.status];
          return (
            <div key={r._id} className={clsx('rounded-xl border px-3 py-2 text-[12.5px]', r.silence === 'critical' ? 'border-danger/40 bg-danger/5' : r.silence === 'suspicious' ? 'border-warn/40 bg-warn/5' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={st.color} dot>
                  {st.label}
                </Badge>
                <span className="text-muted">{WAKE[r.wakeReason] ?? r.wakeReason}</span>
                <span className="truncate text-subtle">
                  {r.providerName}
                  {r.model ? ` · ${r.model}` : ''}
                </span>
                <span className="ml-auto text-subtle">{timeAgo(r.startedAt)}</span>
              </div>
              {(r.usage.inputTokens > 0 || r.usage.costUsd > 0) && (
                <div className="mt-1 text-subtle">
                  {t('{input} vào · {output} ra', { input: compact(r.usage.inputTokens), output: compact(r.usage.outputTokens) })}{r.usage.costUsd ? ` · $${r.usage.costUsd.toFixed(4)}` : ''}
                  {r.billingType === 'subscription' ? ` (${t('gói đăng ký')})` : r.billingType === 'api' ? ' (API)' : ''}
                  {r.sessionAfter ? ` · ${t('phiên {id}', { id: r.sessionAfter.slice(-8) })}` : ''}
                </div>
              )}
              {r.error && <div className="mt-1 line-clamp-2 text-danger">{r.error}</div>}
              {r.silence !== 'ok' && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <AlertTriangle className={clsx('size-3.5', r.silence === 'critical' ? 'text-danger' : 'text-warn')} />
                  <span className={r.silence === 'critical' ? 'text-danger' : 'text-warn'}>{r.silence === 'critical' ? t('Im lặng hơn 15 phút') : t('Im lặng hơn 5 phút')}</span>
                  <Button size="xs" variant="outline" onClick={() => decide(r._id, 'continue')}>
                    {t('Tiếp tục (30 phút)')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => decide(r._id, 'snooze')}>
                    {t('Hoãn 1 giờ')}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => decide(r._id, 'dismiss')}>
                    {t('Bỏ qua')}
                  </Button>
                  <Button size="xs" variant="danger" onClick={() => decide(r._id, 'cancel')}>
                    {t('Dừng')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export interface PermissionBreakdown {
  effective: PermissionLevel;
  project: PermissionLevel;
  department: PermissionLevel;
  task: PermissionLevel | null;
  planner: boolean;
}

/**
 * Quyền thực tế của nhiệm vụ = thấp nhất của dự án, phòng và quyền cấp riêng cho việc.
 * Cho biết cái gì đang giới hạn và cho nâng quyền dự án ngay tại đây (thay vì nhắn agent "cấp quyền" – agent không tự đổi được quyền).
 */
export function TaskPermission({ task, permission }: { task: Task; permission: PermissionBreakdown | null | undefined }) {
  const [busy, setBusy] = useState(false);
  if (!permission) return null;
  const lv = (id: PermissionLevel) => PERMISSION_LEVELS.find((p) => p.id === id)!;
  const eff = lv(permission.effective);
  const limits: string[] = [];
  if (permission.planner) limits.push(t('giám đốc điều phối luôn chỉ đọc – việc cần sửa/chạy lệnh hãy để giám đốc giao cho phòng chuyên môn'));
  if (permission.project === permission.effective) limits.push(t('quyền của dự án ({level})', { level: lv(permission.project).label }));
  if (permission.department === permission.effective) limits.push(t('quyền tối đa của phòng ({level}) – đổi ở Sơ đồ tổ chức', { level: lv(permission.department).label }));
  if (permission.task && permission.task === permission.effective) limits.push(t('quyền người giao cấp cho việc này ({level})', { level: lv(permission.task).label }));
  const setProject = async (value: PermissionLevel) => {
    setBusy(true);
    try {
      await api.patch(`/api/projects/${task.projectId}`, { permission: value });
      await mutate(`/api/tasks/${task._id}`);
      toast.success(t('Đã đổi quyền dự án thành "{level}" – áp dụng từ lượt chạy kế tiếp', { level: lv(value).label }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t('Quyền khi chạy')}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge color={eff.color}>
          <ShieldCheck className="size-3" /> {eff.label}
        </Badge>
        <span className="text-muted">{eff.description}</span>
      </div>
      {limits.length > 0 && <div className="mt-1.5 text-[12.5px] text-subtle">{t('Đang bị giới hạn bởi: {list}.', { list: limits.join(' · ') })}</div>}
      {!permission.planner && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-muted">{t('Quyền của dự án:')}</span>
          <div className="w-56">
            <Select value={permission.project} disabled={busy} onChange={(e) => void setProject(e.target.value as PermissionLevel)} className="h-8 text-[12.5px]">
              {PERMISSION_LEVELS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {permission.effective === 'write' && <span className="text-subtle">{t('Mỗi lệnh shell sẽ tạo thẻ phê duyệt trong Hộp thư (duyệt “cả nhiệm vụ” để khỏi hỏi lại).')}</span>}
        </div>
      )}
    </Section>
  );
}

/** Nhãn + bình luận (bình luận vào việc đã xong sẽ mở lại để phòng làm tiếp). */
export function TaskComment({ task }: { task: Task }) {
  const [text, setText] = useState('');
  const [labels, setLabels] = useState((task.labels ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/tasks/${task._id}`, { action: 'comment', content: text });
      setText('');
      await mutate(`/api/tasks/${task._id}`);
      toast.success(['done', 'failed', 'cancelled'].includes(task.status) ? t('Đã bình luận – nhiệm vụ được mở lại để làm tiếp') : t('Đã bình luận'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const saveLabels = async () => {
    await api.patch(`/api/tasks/${task._id}`, { action: 'labels', labels: labels.split(',') });
    await mutate(`/api/tasks/${task._id}`);
  };
  return (
    <Section title={t('Bình luận & nhãn')}>
      <div className="flex gap-2">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Bình luận cho phòng phụ trách… (việc đã xong sẽ được mở lại)')} className="min-w-0 flex-1 text-[13px]" />
        <Button variant="primary" size="sm" className="self-end" loading={busy} disabled={!text.trim()} onClick={send} icon={<MessageSquare className="size-3.5" />}>
          {t('Gửi')}
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          onBlur={() => void saveLabels()}
          placeholder={t('Nhãn, cách nhau bởi dấu phẩy (vd giao-dien, gap)')}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] outline-none focus:border-line-strong"
        />
        {(task.labels ?? []).map((l) => (
          <Badge key={l} color="#8A7DAE">
            {l}
          </Badge>
        ))}
      </div>
    </Section>
  );
}
