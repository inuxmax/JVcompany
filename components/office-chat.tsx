'use client';
// Chat ngay tại trang Toà nhà (kiểu ChatGPT/Claude): bạn nhắn yêu cầu → CEO tổng tìm tầng trống và giao cho giám đốc tầng;
// mỗi cuộc trò chuyện là một dự án, câu trả lời của các phòng hiện trực tiếp khi đang viết.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import {
  Ban,
  Building2,
  Check,
  ChevronDown,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Play,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import type { Attachment, Department, FloorView, Message, Project, Task } from '@/lib/types';
import { PROJECT_STATUS } from '@/lib/catalog';
import { api } from '@/lib/client/api';
import { useLiveEvent } from '@/lib/client/live';
import { timeAgo } from '@/lib/client/format';
import { localizedContent, m, t } from '@/lib/i18n';
import { Button, DeptAvatar, IconButton, Markdown, Skeleton, confirmDialog, toast } from './ui';
import { FolderPicker, MessageItem as MessageItemBase } from './domain';

/** Tin nhắn đã gửi không vẽ lại mỗi lần chữ đang viết cập nhật (khung chat mượt khi agent đang trả lời). */
const MessageItem = memo(MessageItemBase);
import { CEO_RECIPIENT, ChatComposer, RecipientPicker } from './chat-composer';

type LiveTask = Pick<Task, '_id' | 'departmentId' | 'title' | 'liveText' | 'updatedAt' | 'kind'>;

const WRITING_RESULT = m('_✍️ Đang soạn kết quả và kế hoạch giao việc…_');
/** Khoá trong khối kết quả máy đọc (vp-result) – không hiện thô cho người đọc. */
const PROTOCOL_KEY = /["{,]\s*"(summary|decision|delegate|artifacts|files|step|after|to|title|instructions|priority|permission)"\s*:/;

/** Câu trả lời đang viết: bỏ khối kết quả máy đọc (JSON), chỉ giữ đoạn cuối phần chữ cho người đọc. */
function liveTail(text: string): string {
  const fence = text.lastIndexOf('```vp-result');
  let body = fence >= 0 ? text.slice(0, fence) : text;
  const writingResult = fence >= 0 || PROTOCOL_KEY.test(body);
  if (fence < 0 && writingResult) {
    // Đoạn đẩy tới có thể bắt đầu giữa khối JSON: chỉ giữ phần chữ trước "{"summary"… nếu thấy, còn lại bỏ hết.
    const start = body.search(/\{\s*"(summary|decision|delegate)"\s*:/);
    body = start >= 0 ? body.slice(0, start) : '';
  }
  body = body.trim();
  return writingResult ? `${body}${body ? '\n\n' : ''}${t(WRITING_RESULT)}` : body;
}

function ThreadPicker({ projects, current, onPick, preferFloor }: { projects: Project[]; current: Project | null; onPick: (id: string | null) => void; preferFloor?: number | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] font-semibold">{current ? current.name : t('Cuộc trò chuyện mới')}</span>
          <span className="block truncate text-[11.5px] text-muted">
            {current
              ? `${t(PROJECT_STATUS[current.status].label)} · ${timeAgo(current.updatedAt)}`
              : preferFloor
                ? t('Nhắn CEO tổng để giao việc cho tầng {n}', { n: preferFloor })
                : t('Nhắn CEO tổng để giao việc cho tầng đang trống')}
          </span>
        </span>
        <ChevronDown className={clsx('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" className="animate-vp-in absolute top-full left-0 z-30 mt-1 max-h-96 w-full min-w-[280px] overflow-y-auto rounded-2xl border border-line bg-surface-solid p-1.5 shadow-xl">
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-accent hover:bg-accent/8"
          >
            <MessageSquarePlus className="size-4" />
            {t('Cuộc trò chuyện mới')}
          </button>
          {projects.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{t('Gần đây')}</div>}
          {projects.map((p) => (
            <button
              key={p._id}
              type="button"
              role="option"
              aria-selected={p._id === current?._id}
              onClick={() => {
                onPick(p._id);
                setOpen(false);
              }}
              className={clsx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-surface-3', p._id === current?._id && 'bg-surface-3')}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: PROJECT_STATUS[p.status].color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="block truncate text-[11.5px] text-muted">
                  {t(PROJECT_STATUS[p.status].label)}
                  {p.floorId ? ` · ${t('Tầng {n}', { n: p.floorId.replace('floor-', '') })}` : ''} · {timeAgo(p.updatedAt)}
                </span>
              </span>
              {p._id === current?._id && <Check className="size-4 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Thanh điều khiển dự án của cuộc trò chuyện: dừng ngay / tiếp tục / huỷ / chạy lại. */
function ThreadControls({ project, working }: { project: Project; working: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: 'stop' | 'resume' | 'cancel' | 'start') => {
    if (action === 'stop') {
      const ok = await confirmDialog({
        title: t('Dừng dự án?'),
        message: t('Mọi phòng đang làm sẽ ngừng ngay và tầng được trả lại. Bấm "Tiếp tục" để giao lại từ giai đoạn hiện tại – tài liệu và hội thoại vẫn giữ.'),
        confirmLabel: t('Dừng dự án'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (action === 'cancel') {
      const ok = await confirmDialog({ title: t('Huỷ dự án?'), message: t('Dự án kết thúc và tầng được trả lại. Có thể chạy lại từ đầu sau.'), confirmLabel: t('Huỷ dự án'), cancelLabel: t('Không'), tone: 'danger' });
      if (!ok) return;
    }
    setBusy(action);
    try {
      await api.post(`/api/projects/${project._id}/action`, { action });
      await Promise.all([mutate('/api/projects'), mutate('/api/floors'), mutate(`/api/projects/${project._id}/messages?limit=400`)]);
      toast.success(action === 'stop' ? t('Đã dừng dự án') : action === 'resume' ? t('Dự án tiếp tục') : action === 'cancel' ? t('Đã huỷ dự án') : t('Đã chạy lại dự án'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const running = project.status === 'active' || project.status === 'blocked' || project.status === 'waiting_floor';
  const s = PROJECT_STATUS[project.status];
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12.5px]">
      <span className="relative flex size-2 shrink-0">
        {running && working > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: s.color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: s.color }} />
      </span>
      <span className="min-w-0 flex-1 truncate text-muted">
        {running ? (working > 0 ? t('Đang làm việc · {n} phòng', { n: working }) : t(s.label)) : t(s.label)}
      </span>
      {running && (
        <Button size="xs" variant="outline" onClick={() => act('stop')} loading={busy === 'stop'} icon={<Square className="size-3 fill-current" />}>
          {t('Dừng')}
        </Button>
      )}
      {project.status === 'paused' && (
        <>
          <Button size="xs" variant="ghost" onClick={() => act('cancel')} loading={busy === 'cancel'} icon={<Ban className="size-3.5" />}>
            {t('Huỷ')}
          </Button>
          <Button size="xs" variant="primary" onClick={() => act('resume')} loading={busy === 'resume'} icon={<Play className="size-3.5" />}>
            {t('Tiếp tục')}
          </Button>
        </>
      )}
      {(project.status === 'completed' || project.status === 'cancelled' || project.status === 'draft') && (
        <Button size="xs" variant="outline" onClick={() => act('start')} loading={busy === 'start'} icon={<RotateCcw className="size-3.5" />}>
          {project.status === 'draft' ? t('Khởi động') : t('Chạy lại từ đầu')}
        </Button>
      )}
    </div>
  );
}

export function OfficeChat({
  departments,
  floors,
  threadId,
  onThread,
  onAssigned,
  onGoFloor,
  preferFloor = null,
  wide,
  onToggleWide,
}: {
  departments: Department[];
  floors: FloorView[];
  threadId: string | null;
  onThread: (id: string | null) => void;
  /** Yêu cầu mới vừa được giao cho tầng này (đi thang máy tới và lên phòng họp giao việc). */
  onAssigned: (floorNumber: number) => void;
  /** Xem tầng đang làm cuộc trò chuyện này. */
  onGoFloor: (floorNumber: number) => void;
  /** Tầng trống đang xem trong cảnh 3D – yêu cầu mới giao cho tầng này trước. */
  preferFloor?: number | null;
  /** Khung chat đang mở rộng (rộng hơn cảnh 3D) – bấm để mở rộng / thu gọn. */
  wide?: boolean;
  onToggleWide?: () => void;
}) {
  const { data: projectList } = useSWR<Project[]>('/api/projects');
  const projects = useMemo(() => [...(projectList ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projectList]);
  const thread = projects.find((p) => p._id === threadId) ?? null;
  const msgKey = thread ? `/api/projects/${thread._id}/messages?limit=400` : null;
  const { data: messages } = useSWR<Message[]>(msgKey);
  // Hỏi câu trả lời đang viết khi dự án chưa kết thúc (kể cả lúc bị chặn – các phòng khác vẫn có thể đang làm)
  const open = thread && !['completed', 'cancelled', 'draft'].includes(thread.status);
  const { data: live } = useSWR<LiveTask[]>(open ? `/api/projects/${thread._id}/live` : null, { refreshInterval: 1200 });
  const [details, setDetails] = useState(false);
  const [toSel, setTo] = useState('');
  const director = departments.find((d) => d._id === 'director' && d.enabled) ?? departments.find((d) => d.enabled);
  const to = toSel || director?._id || '';
  const [path, setPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const shown = useMemo(
    () =>
      (messages ?? [])
        .filter(
          (m) => (details || (m.kind !== 'tool' && m.kind !== 'thought')) && !(m.kind === 'thought' && /^\s*(\.{3}|…)?\s*$/.test(m.content)),
        )
        // Tin hệ thống do máy chủ tạo (meta.i18n) hiện theo ngôn ngữ giao diện; giữ nguyên đối tượng khi không đổi (MessageItem memo)
        .map((msg) => {
          const content = localizedContent(msg.content, msg.meta);
          return content === msg.content ? msg : { ...msg, content };
        }),
    [messages, details],
  );
  // Chữ đang viết đẩy trực tiếp từ server (mượt hơn hỏi lại định kỳ)
  const [pushed, setPushed] = useState<Record<string, { text: string | null; departmentId: string; at: number }>>({});
  useLiveEvent((ev) => {
    if (ev.type !== 'task.live' || !thread || ev.projectId !== thread._id) return;
    const d = ev.data as { taskId: string; departmentId: string; text: string | null };
    setPushed((p) => ({ ...p, [d.taskId]: { text: d.text, departmentId: d.departmentId, at: Date.now() } }));
  });
  const merged = (live ?? []).map((tk) => {
    const p = pushed[tk._id];
    return p ? { ...tk, liveText: p.text } : tk;
  });
  // Việc vừa bắt đầu viết nhưng danh sách chưa kịp cập nhật
  for (const [taskId, p] of Object.entries(pushed)) {
    if (p.text && !merged.some((tk) => tk._id === taskId)) merged.push({ _id: taskId, departmentId: p.departmentId, title: '', liveText: p.text, updatedAt: '', kind: 'delegated' });
  }
  const streaming = merged.filter((tk) => tk.liveText?.trim());
  const working = merged.filter((tk) => !tk.liveText?.trim());
  const liveSig = streaming.map((tk) => tk.liveText?.length ?? 0).join(',');

  // Tự cuộn xuống khi có tin mới / câu trả lời dài thêm (trừ khi bạn đang cuộn đọc phía trên)
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, liveSig, threadId]);

  const freeFloors = floors.filter((f) => f.enabled && !f.project).length;
  const toDept = departments.find((d) => d._id === to);

  const send = async (content: string, attachments: Attachment[]) => {
    try {
      const toCeo = Boolean(thread) && to === CEO_RECIPIENT;
      const r = await api.post<{ projectId: string; floorNumber: number | null }>(
        '/api/chat',
        // Gửi CEO tổng: tạo yêu cầu mới (cùng thư mục dự án đang xem) và giao cho tầng đang rảnh
        thread && !toCeo
          ? { projectId: thread._id, departmentId: to, content, attachments }
          : { content, attachments, path: toCeo ? (thread?.path ?? null) : path, floor: preferFloor ?? undefined },
      );
      stick.current = true;
      if (toCeo) {
        await Promise.all([mutate('/api/projects'), mutate('/api/floors')]);
        setTo('');
        onThread(r.projectId);
        if (r.floorNumber) onAssigned(r.floorNumber);
        toast.success(r.floorNumber ? t('CEO tổng đã giao việc mới cho tầng {n}', { n: r.floorNumber }) : t('Các tầng đều bận – việc mới đang xếp hàng chờ tầng trống'));
      } else if (thread) {
        // Dự án đã xong được mở lại trên một tầng → CEO đi tới tầng đó
        await Promise.all([msgKey ? mutate(msgKey) : null, r.floorNumber ? mutate('/api/floors') : null]);
        if (r.floorNumber) onAssigned(r.floorNumber);
      } else {
        await Promise.all([mutate('/api/projects'), mutate('/api/floors')]);
        setPath(null);
        onThread(r.projectId);
        if (r.floorNumber) onAssigned(r.floorNumber);
      }
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };

  const floorNo = thread?.floorId ? Number(thread.floorId.replace('floor-', '')) : null;

  /** Thẻ câu hỏi còn chờ: câu hỏi mở đầu (dự án chưa khởi động) hoặc câu hỏi của một nhiệm vụ – chỉ khi chưa có tin của bạn sau đó. */
  const answerFor = (m: Message): ((text: string) => Promise<boolean>) | undefined => {
    if (!m.meta?.question) return undefined;
    const idx = shown.findIndex((x) => x._id === m._id);
    if (shown.slice(idx + 1).some((x) => x.author.type === 'user')) return undefined;
    const taskId = typeof m.meta.taskId === 'string' ? m.meta.taskId : null;
    if (taskId) {
      return async (text: string) => {
        try {
          await api.patch(`/api/tasks/${taskId}`, { action: 'answer', content: text });
          if (msgKey) await mutate(msgKey);
          return true;
        } catch (e) {
          toast.error(e);
          return false;
        }
      };
    }
    return thread?.status === 'draft' && idx === shown.length - 1 ? (text: string) => send(text, []) : undefined;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <ThreadPicker projects={projects} current={thread} onPick={onThread} preferFloor={preferFloor} />
        {floorNo && (
          <button
            type="button"
            onClick={() => onGoFloor(floorNo)}
            title={t('Đi thang máy tới tầng {n}', { n: floorNo })}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2.5 text-[12px] font-medium text-accent hover:bg-accent/15"
          >
            <Building2 className="size-3.5" />
            {t('Tầng {n}', { n: floorNo })}
          </button>
        )}
        {onToggleWide && (
          <IconButton label={wide ? t('Thu gọn khung chat') : t('Mở rộng khung chat')} onClick={onToggleWide} className="hidden xl:inline-flex">
            {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </IconButton>
        )}
        {thread && (
          <>
            <IconButton label={details ? t('Ẩn chi tiết thao tác') : t('Hiện chi tiết thao tác')} onClick={() => setDetails((v) => !v)}>
              {details ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
            <Link href={`/projects/${thread._id}`} title={t('Mở trang dự án')} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-fg">
              <ExternalLink className="size-4" />
            </Link>
          </>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {!thread ? (
          <div className="flex min-h-full flex-col justify-center px-2 py-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#25211c] text-[#E0B44A]">
                <Crown className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[#B8862B]">{t('CEO tổng')}</div>
                <div className="mt-1 rounded-2xl rounded-tl-md border border-line bg-surface-2/60 px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                  {preferFloor ? (
                    <>
                      {t('Tầng {n} đang trống. Hãy mô tả việc cần làm – tôi sẽ giao cho giám đốc tầng {n}. Câu trả lời của các phòng sẽ hiện ngay tại đây.', { n: preferFloor })}
                    </>
                  ) : (
                    t('Chào bạn! Hãy mô tả việc cần làm – tôi sẽ tìm tầng đang trống và giao cho giám đốc tầng đó. Câu trả lời của các phòng sẽ hiện ngay tại đây.')
                  )}
                  <div className="mt-2 text-[12.5px] text-muted">
                    {freeFloors > 0
                      ? t('Hiện còn {free}/{total} tầng trống.', { free: freeFloors, total: floors.filter((f) => f.enabled).length })
                      : t('Tất cả các tầng đang bận – yêu cầu mới sẽ xếp hàng.')}
                  </div>
                </div>
              </div>
            </div>
            {projects.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 px-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{t('Tiếp tục trò chuyện')}</div>
                <div className="space-y-1.5">
                  {projects.slice(0, 4).map((p) => (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => onThread(p._id)}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-left hover:border-line-strong hover:bg-surface-2"
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: PROJECT_STATUS[p.status].color }} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                      <span className="shrink-0 text-[11.5px] text-subtle">{timeAgo(p.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : !messages ? (
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <>
            {shown.map((m) => (
              <MessageItem
                key={m._id}
                message={m}
                departments={departments}
                onAnswer={answerFor(m)}
              />
            ))}
            {streaming.map((tk) => {
              const d = departments.find((x) => x._id === tk.departmentId);
              return (
                <div key={tk._id} className="flex gap-3 py-2">
                  <DeptAvatar icon={d?.icon ?? 'Bot'} color={d?.color ?? '#958B7E'} size="sm" busy className="mt-0.5 size-9 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[12px]">
                      <span className="font-semibold" style={{ color: d?.color }}>
                        {d ? t(d.name) : tk.departmentId}
                      </span>
                      <span className="text-muted">{t('đang trả lời…')}</span>
                    </div>
                    <div className="rounded-2xl rounded-tl-md border border-line bg-surface-2/60 px-3.5 py-2.5">
                      <Markdown>{liveTail(tk.liveText ?? '')}</Markdown>
                      <span className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle" />
                    </div>
                  </div>
                </div>
              );
            })}
            {working.map((tk) => {
              const d = departments.find((x) => x._id === tk.departmentId);
              return (
                <div key={tk._id} className="flex items-center gap-2 py-1.5 pl-1 text-[12.5px] text-muted">
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="size-1.5 animate-vp-pulse rounded-full" style={{ background: d?.color, animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </span>
                  <span className="truncate">
                    <b style={{ color: d?.color }}>{d ? t(d.name) : tk.departmentId}</b> {t('đang làm: {title}', { title: tk.title })}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {thread && <ThreadControls project={thread} working={live?.length ?? 0} />}
      <ChatComposer
        key={thread?._id ?? 'new'}
        onSend={send}
        placeholder={
          thread
            ? to === CEO_RECIPIENT
              ? preferFloor
                ? t('Giao việc mới cho CEO tổng – sẽ giao cho tầng {n} (đang trống)… (dán ảnh bằng Ctrl+V)', { n: preferFloor })
                : t('Giao việc mới cho CEO tổng – sẽ chuyển tới tầng đang rảnh ({n} tầng trống)… (dán ảnh bằng Ctrl+V)', { n: freeFloors })
              : to === 'director' && thread.status === 'draft'
              ? t('Trả lời giám đốc hoặc mô tả việc cần làm… (dán ảnh bằng Ctrl+V)')
              : to === 'director' && !open
              ? t('Nhắn giám đốc để làm tiếp theo kế hoạch đã có… (dán ảnh bằng Ctrl+V)')
              : t('Nhắn {name}… (dán ảnh bằng Ctrl+V)', { name: toDept ? t(toDept.name) : t('giám đốc tầng') })
            : preferFloor
              ? t('Mô tả việc cần làm – CEO tổng sẽ giao cho tầng {n}… (dán ảnh bằng Ctrl+V)', { n: preferFloor })
              : t('Mô tả việc cần làm – CEO tổng sẽ giao cho tầng đang trống… (dán ảnh bằng Ctrl+V)')
        }
        left={
          thread ? (
            <RecipientPicker departments={departments} value={to} onChange={setTo} withCeo={{ freeFloors, totalFloors: floors.filter((f) => f.enabled).length }} />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2/70 pr-3 pl-1 text-[12.5px]">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#25211c] text-[#E0B44A]">
                  <Crown className="size-3.5" />
                </span>
                <span className="text-muted">{t('Gửi')}</span>
                <span className="font-medium">{t('CEO tổng')}</span>
              </span>
              <button
                type="button"
                onClick={() => setPicking(true)}
                title={path ?? t('Chọn thư mục dự án trên máy (tuỳ chọn)')}
                className={clsx(
                  'flex h-9 min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors',
                  path ? 'border-accent/40 bg-accent/8 text-accent' : 'border-line text-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="max-w-[120px] truncate">{path ? path.split(/[\\/]/).filter(Boolean).pop() : t('Thư mục')}</span>
                {path && (
                  <X
                    className="size-3.5 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPath(null);
                    }}
                  />
                )}
              </button>
            </div>
          )
        }
      />
      <FolderPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPath(p);
          setPicking(false);
        }}
        initialPath={path}
      />
    </div>
  );
}
