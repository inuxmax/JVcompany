'use client';
// Thành phần nghiệp vụ dùng lại: trạng thái, tiến trình giai đoạn, dòng tin nhắn, chọn thư mục…
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import clsx from 'clsx';
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  HardDrive,
  Hourglass,
  Info,
  Send,
  ShieldCheck,
  Terminal,
  Wrench,
  Crown,
} from 'lucide-react';
import type {
  ChatQuestion,
  Attachment,
  Department,
  FsListing,
  Message,
  Project,
  ProjectInspection,
  Task,
  TaskStatus,
  Workflow,
} from '@/lib/types';
import { PROJECT_STATUS, TASK_STATUS } from '@/lib/catalog';
import { desktop } from '@/lib/client/api';
import { clock, timeAgo, tint } from '@/lib/client/format';
import { localizedContent, t } from '@/lib/i18n';
import { Badge, Button, DeptAvatar, Input, Markdown, Modal, Spinner } from './ui';

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return (
    <Badge color={s.color} dot pulse={status === 'running'}>
      {s.label}
    </Badge>
  );
}

export function ProjectStatusBadge({ status }: { status: Project['status'] }) {
  const s = PROJECT_STATUS[status];
  return (
    <Badge color={s.color} dot pulse={status === 'active'}>
      {s.label}
    </Badge>
  );
}

/** Chọn chế độ làm việc của dự án: giao cho giám đốc hoặc quy trình nhiều giai đoạn. */
export function WorkflowPicker({ workflows, value, onChange }: { workflows: Workflow[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {workflows.map((w) => {
        const on = w._id === value;
        return (
          <button
            key={w._id}
            type="button"
            onClick={() => onChange(w._id)}
            className={clsx('rounded-2xl border p-3.5 text-left transition-all', on ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line hover:border-line-strong')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={clsx('text-[13.5px] font-semibold', on && 'text-accent')}>{t(w.name)}</span>
              <span className="text-[11.5px] text-subtle">{w.phases.length === 1 ? t('1 đầu mối') : t('{n} giai đoạn', { n: w.phases.length })}</span>
            </div>
            {w.description && <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(w.description)}</div>}
          </button>
        );
      })}
    </div>
  );
}

/** Thanh tiến trình các giai đoạn (dạng chấm, gọn). */
export function PhaseDots({ project, workflow }: { project: Project; workflow?: Workflow | null }) {
  const phases = workflow?.phases ?? [];
  if (!phases.length) return null;
  const idx = phases.findIndex((p) => p.id === project.currentPhase);
  return (
    <div className="flex items-center gap-1">
      {phases.map((p, i) => {
        const done = project.status === 'completed' || project.completedPhases.includes(p.id) || i < idx;
        const current = i === idx && project.status !== 'completed';
        return (
          <div
            key={p.id}
            title={t(p.name)}
            className={clsx(
              'h-1.5 flex-1 rounded-full transition-colors',
              done ? 'bg-accent-2' : current ? 'bg-accent' : 'bg-surface-3',
              current && project.status === 'active' && 'animate-vp-pulse',
            )}
          />
        );
      })}
    </div>
  );
}

/** Bước giai đoạn chi tiết (dùng ở trang dự án). */
export function PhaseStepper({
  project,
  workflow,
  departments,
}: {
  project: Project;
  workflow: Workflow;
  departments: Department[];
}) {
  const idx = workflow.phases.findIndex((p) => p.id === project.currentPhase);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {workflow.phases.map((p, i) => {
        const done = project.status === 'completed' || project.completedPhases.includes(p.id) || i < idx;
        const current = i === idx && project.status !== 'completed';
        const lead = departments.find((d) => d._id === p.lead);
        return (
          <li
            key={p.id}
            className={clsx(
              'relative rounded-xl border px-3 py-2.5 transition-colors',
              current ? 'border-accent/50 bg-accent/8' : done ? 'border-ok/25 bg-ok/5' : 'border-line bg-surface-2/40',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? 'bg-ok text-white' : current ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={clsx('truncate text-[13px] font-semibold', !done && !current && 'text-muted')}>{t(p.name)}</span>
            </div>
            {lead && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="size-1.5 rounded-full" style={{ background: lead.color }} />
                <span className="truncate">{t(lead.name).replace('Phòng ', '') /* i18n-ignore: bỏ tiền tố tên phòng tiếng Việt */}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ProviderLine({ task }: { task: Pick<Task, 'providerName' | 'model'> }) {
  if (!task.providerName) return null;
  return (
    <span className="truncate text-[11.5px] text-subtle">
      {task.providerName}
      {task.model ? ` · ${task.model}` : ''}
    </span>
  );
}

// ---------------- Tin nhắn ----------------

const KIND_ICON: Partial<Record<Message['kind'], typeof Info>> = {
  tool: Wrench,
  system: Info,
  error: CircleAlert,
  approval: ShieldCheck,
  delegation: Send,
};

export function MessageItem({
  message,
  departments,
  projectName,
  compact,
  onAnswer,
}: {
  message: Message;
  departments: Pick<Department, '_id' | 'name' | 'icon' | 'color'>[];
  projectName?: string;
  compact?: boolean;
  /** Tin nhắn có câu hỏi kèm lựa chọn → bấm chọn sẽ gửi câu trả lời (chỉ truyền khi câu hỏi còn chờ). */
  onAnswer?: (text: string) => Promise<boolean> | void;
}) {
  const dept = departments.find((d) => d._id === message.author.departmentId);
  const to = message.to ? departments.find((d) => d._id === message.to) : null;
  const meta = (message.meta ?? {}) as Record<string, unknown>;

  if (message.kind === 'tool') {
    const output = typeof meta.output === 'string' ? meta.output : null;
    return (
      <div className="flex gap-2 py-0.5 pl-12 text-[12.5px] text-muted">
        {meta.tool === 'run_command' || meta.tool === 'Bash' ? (
          <Terminal className="mt-0.5 size-3.5 shrink-0 text-subtle" />
        ) : (
          <Wrench className="mt-0.5 size-3.5 shrink-0 text-subtle" />
        )}
        <div className="min-w-0 flex-1">
          <Markdown className="[&_code]:text-[11.5px]">{localizedContent(message.content, message.meta)}</Markdown>
          {output && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11.5px] text-subtle hover:text-fg">{t('Xem kết quả')}</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                {output}
              </pre>
            </details>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-subtle">{clock(message.createdAt)}</span>
      </div>
    );
  }

  if (message.kind === 'system' || message.kind === 'error' || (message.kind === 'approval' && message.author.type !== 'agent')) {
    const Icon = KIND_ICON[message.kind] ?? Info;
    return (
      <div
        className={clsx(
          'my-1 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px]',
          message.kind === 'error' ? 'bg-danger/10 text-danger' : 'bg-surface-2/70 text-muted',
        )}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {projectName && <span className="mr-1.5 font-medium text-fg">{projectName}:</span>}
          <Markdown className="inline [&_p]:inline">{localizedContent(message.content, message.meta)}</Markdown>
        </div>
        <span className="shrink-0 text-[11px] opacity-70">{compact ? timeAgo(message.createdAt) : clock(message.createdAt)}</span>
      </div>
    );
  }

  const isUser = message.author.type === 'user';
  const isCeo = message.author.role === 'ceo';
  const color = isCeo ? '#B8862B' : (dept?.color ?? '#958B7E');
  const attachments = Array.isArray(meta.attachments) ? (meta.attachments as Attachment[]) : [];
  const label: Record<string, string> = {
    report: t('Báo cáo'),
    delegation: t('Giao việc'),
    thought: t('Đang làm'),
    approval: t('Xin phê duyệt'),
  };
  return (
    <div className={clsx('group flex gap-3 py-2', isUser && 'flex-row-reverse')}>
      {isUser ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-[13px] font-semibold text-accent-fg">
          {t('Bạn')}
        </div>
      ) : isCeo ? (
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#25211c] text-[#E0B44A]" title={t('CEO tổng')}>
          <Crown className="size-4" />
        </div>
      ) : (
        <DeptAvatar icon={dept?.icon ?? 'Bot'} color={color} size="sm" className="mt-0.5 size-9 rounded-xl" />
      )}
      <div className={clsx('min-w-0 max-w-[min(100%,760px)] flex-1', isUser && 'flex flex-col items-end')}>
        <div className={clsx('mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]', isUser && 'flex-row-reverse')}>
          <span className="font-semibold" style={{ color: isUser ? undefined : color }}>
            {isUser ? t('Bạn') : dept ? t(dept.name) : message.author.name ? t(message.author.name) : 'Agent'}
          </span>
          {to && (
            <span className="flex items-center gap-1 text-muted">
              <ChevronRight className="size-3" />
              <span style={{ color: to.color }}>{t(to.name)}</span>
            </span>
          )}
          {label[message.kind] && <Badge color={message.kind === 'report' ? '#5C9A68' : color}>{label[message.kind]}</Badge>}
          {typeof meta.decision === 'string' && (
            <Badge color={meta.decision === 'approve' ? '#5C9A68' : '#C4483F'}>{meta.decision === 'approve' ? t('Duyệt') : t('Từ chối')}</Badge>
          )}
          {projectName && <span className="text-muted">· {projectName}</span>}
          <span className="text-subtle">{compact ? timeAgo(message.createdAt) : clock(message.createdAt)}</span>
        </div>
        {attachments.length > 0 && (
          <div className={clsx('mb-1.5 flex flex-wrap gap-2', isUser && 'justify-end')}>
            {attachments.map((a) => (
              <a
                key={a.id}
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                title={t('{name} – mở ảnh gốc', { name: a.name })}
                className="block overflow-hidden rounded-2xl border border-line bg-surface-2 transition-opacity hover:opacity-90"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đính kèm phục vụ từ API cục bộ */}
                <img src={`/api/attachments/${a.id}`} alt={a.name} loading="lazy" className={clsx('block object-cover', compact ? 'max-h-20 max-w-[120px]' : 'max-h-56 max-w-[280px]')} />
              </a>
            ))}
          </div>
        )}
        {message.content && (
          <div
            className={clsx(
              'rounded-2xl px-3.5 py-2.5',
              isUser
                ? 'rounded-tr-md bg-accent/12 text-fg'
                : message.kind === 'thought'
                  ? 'rounded-tl-md border border-dashed border-line-strong bg-transparent text-muted'
                  : 'rounded-tl-md border border-line bg-surface-2/60',
            )}
            style={message.kind === 'delegation' ? { borderColor: tint(color, 0.35) } : undefined}
          >
            <Markdown className={clsx(compact && 'line-clamp-4')}>{localizedContent(message.content, message.meta)}</Markdown>
          </div>
        )}
        {onAnswer && isQuestion(meta.question) && <QuestionCard question={meta.question} onAnswer={onAnswer} />}
      </div>
    </div>
  );
}

function isQuestion(v: unknown): v is ChatQuestion {
  return Boolean(v && typeof v === 'object' && Array.isArray((v as ChatQuestion).options));
}

/** Thẻ câu hỏi kèm lựa chọn (vd câu hỏi mở đầu của giám đốc khi làm quen). */
function QuestionCard({ question, onAnswer }: { question: ChatQuestion; onAnswer: (text: string) => Promise<boolean> | void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const answer = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onAnswer(value.trim());
    } finally {
      setBusy(false);
    }
  };
  const opt = question.options.find((o) => o.id === picked);
  return (
    <div className="mt-2 w-full max-w-[560px] rounded-2xl border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 text-[13px] font-semibold">{t(question.prompt)}</div>
      <div className="space-y-1.5">
        {question.options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() => (o.freeText ? setPicked(o.id) : void answer(o.label))}
            className={clsx(
              'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors',
              picked === o.id ? 'border-accent bg-surface-solid' : 'border-line bg-surface-solid/60 hover:border-line-strong',
            )}
          >
            <ChevronRight className="size-3.5 shrink-0 text-accent" />
            {t(o.label)}
          </button>
        ))}
      </div>
      {opt?.freeText && (
        <div className="mt-2 flex gap-2">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void answer(text);
              }
            }}
            rows={2}
            placeholder={opt.placeholder ? t(opt.placeholder) : t('Nhập câu trả lời…')}
            className="min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface-solid px-3 py-2 text-[13px] outline-none focus:border-line-strong"
          />
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void answer(text)}
            className="self-end rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"
          >
            {t('Gửi')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- Chọn thư mục dự án ----------------

export function FolderPicker({
  open,
  onClose,
  onPick,
  initialPath,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
  initialPath?: string | null;
}) {
  const [path, setPathRaw] = useState<string | null>(initialPath ?? null);
  const [manualEdit, setManual] = useState<string | null>(null);
  const key = open ? `/api/fs/browse?path=${encodeURIComponent(path ?? '')}` : null;
  const { data, error, isLoading } = useSWR<FsListing>(key);
  const manual = manualEdit ?? data?.path ?? '';
  const setPath = (p: string | null) => {
    setPathRaw(p);
    setManual(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('Chọn thư mục dự án')}
      description={t('Duyệt ổ đĩa trên máy tính này (Windows, macOS, Linux) và chọn thư mục chứa dự án.')}
      footer={
        <>
          <span className="mr-auto truncate text-[12.5px] text-muted">{data?.path ?? t('Chưa chọn thư mục')}</span>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button variant="primary" disabled={!data?.path} onClick={() => data?.path && onPick(data.path)} icon={<Check className="size-4" />}>
            {t('Chọn thư mục này')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          <div className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">{t('Vị trí')}</div>
          {(data?.roots ?? []).map((r) => (
            <button
              key={r.path}
              type="button"
              onClick={() => setPath(r.path)}
              className={clsx(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                data?.path === r.path && 'bg-surface-2 font-medium',
              )}
            >
              <HardDrive className="size-4 shrink-0 text-subtle" />
              <span className="truncate">{r.name}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0">
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) setPath(manual.trim());
            }}
          >
            <Button
              variant="outline"
              size="md"
              disabled={!data?.parent}
              onClick={() => data?.parent && setPath(data.parent)}
              icon={<ArrowUp className="size-4" />}
              aria-label={t('Lên thư mục cha')}
            />
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t('Nhập hoặc dán đường dẫn…')} className="font-mono text-[12.5px]" />
            <Button type="submit" variant="secondary">
              {t('Đi')}
            </Button>
          </form>
          <div className="h-[380px] overflow-y-auto rounded-xl border border-line">
            {isLoading && (
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            )}
            {error && <div className="p-4 text-[13px] text-danger">{(error as Error).message}</div>}
            {!path && !isLoading && (
              <div className="p-6 text-center text-[13px] text-muted">{t('Chọn một vị trí bên trái để bắt đầu duyệt.')}</div>
            )}
            {data?.path && data.entries.length === 0 && <div className="p-6 text-center text-[13px] text-muted">{t('Thư mục trống.')}</div>}
            {data?.entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onDoubleClick={() => onPick(e.path)}
                onClick={() => setPath(e.path)}
                className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left text-[13px] last:border-0 hover:bg-surface-2"
              >
                <Folder className="size-4 shrink-0 text-accent" />
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-subtle">{t('Mẹo: nhấp đúp vào thư mục để chọn ngay.')}</p>
        </div>
      </div>
    </Modal>
  );
}

/** Nút chọn thư mục: dùng hộp thoại hệ điều hành trong app desktop, hoặc trình duyệt thư mục trên web. */
export function FolderField({ value, onChange }: { value: string | null; onChange: (p: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const { data: info, isLoading: loading } = useSWR<ProjectInspection>(value ? `/api/fs/inspect?path=${encodeURIComponent(value)}` : null);

  const pick = async () => {
    const d = desktop();
    if (d) {
      const p = await d.pickFolder(value ?? undefined);
      if (p) onChange(p);
      return;
    }
    setOpen(true);
  };

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line-strong bg-surface-2/60 px-3">
          <FolderOpen className="size-4 shrink-0 text-subtle" />
          <span className={clsx('truncate font-mono text-[12.5px]', !value && 'text-subtle')}>{value ?? t('Chưa chọn – agent sẽ dùng không gian làm việc riêng')}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={pick} icon={<FolderOpen className="size-4" />}>
            {t('Chọn thư mục')}
          </Button>
          {value && (
            <Button variant="ghost" onClick={() => onChange(null)}>
              {t('Bỏ chọn')}
            </Button>
          )}
        </div>
      </div>
      {loading && (
        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner className="size-3.5" /> {t('Đang phân tích thư mục…')}
        </div>
      )}
      {info && info.exists && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{info.name}</span>
            {info.stack.map((s) => (
              <Badge key={s} color="#4A86BD">
                {s}
              </Badge>
            ))}
            {info.gitBranch && (
              <span className="flex items-center gap-1 text-muted">
                <GitBranch className="size-3.5" />
                {info.gitBranch}
              </span>
            )}
            <span className="flex items-center gap-1 text-muted">
              <File className="size-3.5" />
              {t('{n} tệp', { n: info.fileCount >= 5000 ? '5000+' : info.fileCount })}
            </span>
          </div>
          {info.description && <p className="mt-1.5 text-muted">{info.description}</p>}
        </div>
      )}
      {open && (
        <FolderPicker
          open={open}
          onClose={() => setOpen(false)}
          initialPath={value}
          onPick={(p) => {
            onChange(p);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function WaitingLimitNote({ task }: { task: Task }) {
  if (task.status !== 'waiting_limit' || !task.retryAt) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-warn">
      <Hourglass className="size-3" /> {t('tự chạy lại {time}', { time: timeAgo(task.retryAt) })}
    </span>
  );
}

export function ProjectLink({ project }: { project: Pick<Project, '_id' | 'name'> }) {
  return (
    <Link href={`/projects/${project._id}`} className="font-medium hover:text-accent">
      {project.name}
    </Link>
  );
}
