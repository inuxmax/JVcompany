'use client';
// Các bảng của trang dự án: hội thoại, nhiệm vụ (kanban), tài liệu, tệp.
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import {
  ChevronRight,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  File,
  FileText,
  Folder,
  Hand,
  Trash2,
} from 'lucide-react';
import type { Artifact, Attachment, Department, FsEntry, Message, Project, Task } from '@/lib/types';
import { ARTIFACT_TYPES, TASK_STATUS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { bytes, timeAgo } from '@/lib/client/format';
import { localize, t, tc } from '@/lib/i18n';
import { Badge, Button, Card, DeptAvatar, EmptyState, Markdown, Skeleton, Spinner, confirmDialog, toast } from './ui';
import { MessageItem, ProviderLine, WaitingLimitNote } from './domain';
import { ChatComposer, RecipientPicker } from './chat-composer';

// ---------------- Hội thoại ----------------

/** Tên phòng ban (đã dịch) để điền vào ô nhắn; chưa chọn → "phòng ban". */
function deptName(departments: Department[], id: string): string {
  const d = departments.find((x) => x._id === id);
  return d ? t(d.name) : t('phòng ban');
}

export function ChatPanel({
  project,
  departments,
  tasks,
  defaultDept,
  onOpenTask,
}: {
  project: Project;
  departments: Department[];
  tasks: Task[];
  defaultDept: string;
  onOpenTask: (id: string) => void;
}) {
  const key = `/api/projects/${project._id}/messages?limit=600`;
  const { data } = useSWR<Message[]>(key);
  const [toSel, setTo] = useState('');
  const to = toSel || defaultDept;
  const [details, setDetails] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const shown = useMemo(
    () =>
      (data ?? []).filter(
        // Bỏ các dòng "…" trống agent gửi giữa các thao tác
        (m) => (details || (m.kind !== 'tool' && m.kind !== 'thought')) && !(m.kind === 'thought' && /^\s*(\.{3}|…)?\s*$/.test(m.content)),
      ),
    [data, details],
  );

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const running = tasks.filter((task) => task.status === 'running');
  const manual = tasks.filter((task) => task.status === 'waiting_human');

  const send = async (content: string, attachments: Attachment[]) => {
    if (!to) return false;
    try {
      await api.post(`/api/projects/${project._id}/messages`, { departmentId: to, content, attachments });
      stick.current = true;
      await mutate(key);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };

  return (
    <Card className="flex h-[calc(100vh-220px)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="text-[13px] text-muted">{data ? t('{n} tin nhắn', { n: data.length }) : t('Đang tải…')}</div>
        <Button variant="ghost" size="xs" onClick={() => setDetails((v) => !v)} icon={details ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}>
          {details ? t('Ẩn chi tiết thao tác') : t('Hiện chi tiết thao tác')}
        </Button>
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-24" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title={t('Chưa có trao đổi nào')}
            description={
              project.status === 'draft'
                ? t('Bấm "Khởi động" để Giám đốc AI bắt đầu, hoặc nhắn trực tiếp cho một phòng ban bên dưới.')
                : t('Nhắn cho một phòng ban để giao việc trực tiếp.')
            }
          />
        ) : (
          shown.map((m) => (
            <div
              key={m._id}
              className={clsx(m.taskId && 'cursor-pointer')}
              onClick={(e) => {
                if (m.taskId && !(e.target as HTMLElement).closest('a,button,summary,pre')) onOpenTask(m.taskId);
              }}
            >
              <MessageItem message={m} departments={departments} />
            </div>
          ))
        )}
      </div>

      {(running.length > 0 || manual.length > 0) && (
        <div className="space-y-1.5 border-t border-line bg-surface-2/40 px-4 py-2">
          {manual.map((task) => {
            const d = departments.find((x) => x._id === task.departmentId);
            return (
              <button
                key={task._id}
                type="button"
                onClick={() => onOpenTask(task._id)}
                className="flex w-full items-center gap-2 rounded-lg bg-[#C06587]/10 px-3 py-1.5 text-left text-[12.5px] text-[#C06587] hover:bg-[#C06587]/15"
              >
                <Hand className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t('{name} cần bạn chuyển tiếp qua trình duyệt:', { name: d ? t(d.name) : '' })} <b>{task.title}</b>
                </span>
                <ChevronRight className="ml-auto size-3.5 shrink-0" />
              </button>
            );
          })}
          {running.map((task) => {
            const d = departments.find((x) => x._id === task.departmentId);
            return (
              <button key={task._id} type="button" onClick={() => onOpenTask(task._id)} className="flex w-full items-center gap-2 text-left text-[12.5px] text-muted hover:text-fg">
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1.5 animate-vp-pulse rounded-full" style={{ background: d?.color, animationDelay: `${i * 0.2}s` }} />
                  ))}
                </span>
                <span className="truncate">
                  <b style={{ color: d?.color }}>{d ? t(d.name) : null}</b> {t('đang làm: {title}', { title: task.title })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ChatComposer
        onSend={send}
        placeholder={t('Nhắn {name}: giao việc, hỏi tiến độ… (dán ảnh bằng Ctrl+V)', { name: deptName(departments, to) })}
        left={<RecipientPicker departments={departments} value={to} onChange={setTo} />}
      />
    </Card>
  );
}

// ---------------- Nhiệm vụ (kanban) ----------------

const COLUMNS: { id: 'queue' | 'active' | 'waiting' | 'done' | 'failed'; label: string; color: string }[] = localize([
  { id: 'queue', label: 'Hàng đợi', color: '#958B7E' },
  { id: 'active', label: 'Đang làm', color: '#4A86BD' },
  { id: 'waiting', label: 'Đang chờ', color: '#C9952F' },
  { id: 'done', label: 'Hoàn thành', color: '#5C9A68' },
  { id: 'failed', label: 'Lỗi / Hủy', color: '#C4483F' },
]);

// Gọi lúc render (t() không chạy ở cấp module).
function kindShort(kind: Task['kind']): string {
  const labels: Record<Task['kind'], string> = {
    phase: t('Chủ trì'),
    delegated: t('Giao việc'),
    review: tc('task-kind', 'Duyệt'),
    chat: tc('task-kind', 'Trực tiếp'),
    heartbeat: t('Định kỳ'),
    routine: t('Lịch'),
  };
  return labels[kind];
}

export function TaskCard({ task, departments, onOpen }: { task: Task; departments: Department[]; onOpen: () => void }) {
  const d = departments.find((x) => x._id === task.departmentId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-line bg-surface p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-line-strong"
    >
      <div className="flex items-start gap-2.5">
        {d && <DeptAvatar icon={d.icon} color={d.color} size="sm" busy={task.status === 'running'} />}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-medium">{task.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">{d ? t(d.name) : task.departmentId}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge color={TASK_STATUS[task.status].color} dot pulse={task.status === 'running'}>
          {TASK_STATUS[task.status].label}
        </Badge>
        <Badge color="#958B7E">{kindShort(task.kind)}</Badge>
        {task.depth > 0 && <span className="text-[11px] text-subtle">{t('cấp {n}', { n: task.depth })}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <ProviderLine task={task} />
        <span className="shrink-0 text-[11px] text-subtle">{timeAgo(task.updatedAt)}</span>
      </div>
      <WaitingLimitNote task={task} />
    </button>
  );
}

export function TaskBoard({ tasks, departments, onOpenTask }: { tasks: Task[]; departments: Department[]; onOpenTask: (id: string) => void }) {
  const groups = useMemo(() => {
    const g: Record<string, Task[]> = { queue: [], active: [], waiting: [], done: [], failed: [] };
    for (const task of tasks) g[TASK_STATUS[task.status].group].push(task);
    g.done.reverse();
    g.failed.reverse();
    return g;
  }, [tasks]);
  if (!tasks.length) {
    return (
      <Card>
        <EmptyState title={t('Chưa có nhiệm vụ')} description={t('Nhiệm vụ sẽ xuất hiện khi dự án được khởi động hoặc khi bạn nhắn cho một phòng ban.')} />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {COLUMNS.map((c) => (
        <div key={c.id} className="flex min-h-[200px] flex-col rounded-2xl border border-line bg-surface-2/40">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="size-2 rounded-full" style={{ background: c.color }} />
            <span className="text-[13px] font-semibold">{c.label}</span>
            <span className="ml-auto rounded-full bg-surface-3 px-2 text-[11.5px] text-muted">{groups[c.id].length}</span>
          </div>
          <div className="max-h-[calc(100vh-300px)] flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {groups[c.id].map((task) => (
              <TaskCard key={task._id} task={task} departments={departments} onOpen={() => onOpenTask(task._id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Tài liệu ----------------

export function ArtifactsPanel({ projectId, departments }: { projectId: string; departments: Department[] }) {
  const key = `/api/projects/${projectId}/artifacts`;
  const { data } = useSWR<Artifact[]>(key);
  const [sel, setSel] = useState<string | null>(null);
  const current = data?.find((a) => a._id === sel) ?? data?.[0] ?? null;

  const download = (a: Artifact) => {
    const blob = new Blob([a.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${a.title.replace(/[\\/:*?"<>|]+/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const remove = async (a: Artifact) => {
    const ok = await confirmDialog({
      title: t('Xoá tài liệu này?'),
      message: t('Tài liệu {title} sẽ bị xoá khỏi dự án.', { title: a.title }),
      confirmLabel: t('Xoá tài liệu'),
      tone: 'danger',
    });
    if (!ok) return;
    await api.del(`${key}?artifactId=${a._id}`).catch(toast.error);
    await mutate(key);
  };

  if (!data) return <Skeleton className="h-96" />;
  if (!data.length)
    return (
      <Card>
        <EmptyState icon={<FileText className="size-5" />} title={t('Chưa có tài liệu')} description={t('Brief, spec, kế hoạch, báo cáo do các phòng ban tạo sẽ được lưu ở đây.')} />
      </Card>
    );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="max-h-[calc(100vh-240px)] overflow-y-auto p-2">
        {data.map((a) => {
          const d = departments.find((x) => x._id === a.departmentId);
          return (
            <button
              key={a._id}
              type="button"
              onClick={() => setSel(a._id)}
              className={clsx('w-full rounded-xl px-3 py-2.5 text-left transition-colors', current?._id === a._id ? 'bg-surface-3' : 'hover:bg-surface-2')}
            >
              <div className="line-clamp-2 text-[13px] font-medium">{a.title}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="size-1.5 rounded-full" style={{ background: d?.color }} />
                {d ? t(d.name) : a.departmentId} · {ARTIFACT_TYPES[a.type]} · {timeAgo(a.createdAt)}
              </div>
            </button>
          );
        })}
      </Card>
      {current && (
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{current.title}</div>
              <div className="text-[12px] text-muted">{ARTIFACT_TYPES[current.type]}</div>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                icon={<Clipboard className="size-3.5" />}
                onClick={() => navigator.clipboard.writeText(current.content).then(() => toast.success(t('Đã sao chép')))}
              >
                {t('Sao chép')}
              </Button>
              <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />} onClick={() => download(current)}>
                {t('Tải .md')}
              </Button>
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => remove(current)}>
                {t('Xóa')}
              </Button>
            </div>
          </div>
          <div className="max-h-[calc(100vh-300px)] overflow-y-auto px-5 py-4">
            <Markdown>{current.content}</Markdown>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------- Tệp ----------------

interface FilesResp {
  type: 'dir' | 'file';
  root: string;
  real: boolean;
  path: string;
  entries?: FsEntry[];
  content?: string;
  binary?: boolean;
  truncated?: boolean;
  size?: number;
}

export function FilesPanel({ projectId }: { projectId: string }) {
  const [dir, setDir] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const { data: listing, error } = useSWR<FilesResp>(`/api/projects/${projectId}/files?path=${encodeURIComponent(dir)}`);
  const { data: content, isLoading } = useSWR<FilesResp>(file !== null ? `/api/projects/${projectId}/files?path=${encodeURIComponent(file)}` : null);

  const rel = (abs: string) => {
    if (!listing) return abs;
    const r = abs.slice(listing.root.length).replace(/^[\\/]+/, '');
    return r;
  };
  const crumbs = dir ? dir.split(/[\\/]/).filter(Boolean) : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex max-h-[calc(100vh-240px)] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2 text-[12.5px]">
          <button type="button" className="font-medium hover:text-accent" onClick={() => setDir('')}>
            {listing?.real ? t('Dự án') : 'Workspace'}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-subtle" />
              <button type="button" className="hover:text-accent" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            </span>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <div className="p-4 text-[13px] text-danger">{(error as Error).message}</div>}
          {!listing && !error && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {listing?.entries?.length === 0 && <div className="p-4 text-[13px] text-muted">{t('Thư mục trống.')}</div>}
          {listing?.entries?.map((e) => (
            <button
              key={e.path}
              type="button"
              onClick={() => (e.type === 'dir' ? setDir(rel(e.path)) : setFile(rel(e.path)))}
              className={clsx(
                'flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left text-[13px] last:border-0 hover:bg-surface-2',
                file === rel(e.path) && 'bg-surface-3',
              )}
            >
              {e.type === 'dir' ? <Folder className="size-4 shrink-0 text-accent" /> : <File className="size-4 shrink-0 text-subtle" />}
              <span className={clsx('truncate', e.name.startsWith('.') && 'text-muted')}>{e.name}</span>
              {e.type === 'file' && <span className="ml-auto shrink-0 text-[11px] text-subtle">{bytes(e.size)}</span>}
            </button>
          ))}
        </div>
      </Card>
      <Card className="min-w-0 overflow-hidden">
        {file === null ? (
          <EmptyState icon={<File className="size-5" />} title={t('Chọn một tệp để xem')} description={t('Xem nhanh mã nguồn và tài liệu agent đã tạo/sửa (chỉ đọc).')} />
        ) : isLoading || !content ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="truncate font-mono text-[12.5px]">{file}</span>
              <span className="shrink-0 text-[12px] text-subtle">
                {bytes(content.size)}
                {content.truncated ? ` · ${t('đã cắt bớt')}` : ''}
              </span>
            </div>
            {content.binary ? (
              <div className="p-5 text-[13px] text-muted">{t('Tệp nhị phân – không hiển thị được.')}</div>
            ) : file.toLowerCase().endsWith('.md') ? (
              <div className="max-h-[calc(100vh-300px)] overflow-auto px-5 py-4">
                <Markdown>{content.content ?? ''}</Markdown>
              </div>
            ) : (
              <pre className="max-h-[calc(100vh-300px)] overflow-auto p-4 font-mono text-[12px] leading-relaxed">{content.content}</pre>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

