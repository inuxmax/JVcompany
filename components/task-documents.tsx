'use client';
// Tài liệu của nhiệm vụ (theo Paperclip): đọc / sửa / lịch sử phiên bản, bôi đen một đoạn để bình luận,
// luồng bình luận (trả lời, đóng, mở lại) và so sánh khác biệt giữa các phiên bản.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import clsx from 'clsx';
import { Check, FileText, History, MessageSquarePlus, MessagesSquare, PenLine, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import type { DocAnchor, DocumentRevision, DocumentThread, IssueDocument, Task } from '@/lib/types';
import { api } from '@/lib/client/api';
import { dateTime, timeAgo } from '@/lib/client/format';
import { diffStats, lineDiff } from '@/lib/client/diff';
import { Badge, Button, EmptyState, Field, Input, Markdown, Modal, Segmented, Skeleton, Switch, Textarea, confirmDialog, toast } from './ui';
import { t } from '@/lib/i18n';

type DocRow = IssueDocument & { openThreads: number };
interface Bundle {
  document: IssueDocument;
  revisions: DocumentRevision[];
  threads: DocumentThread[];
}

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

/** Danh sách tài liệu trong ngăn nhiệm vụ. */
export function TaskDocuments({ task, departmentName }: { task: Task; departmentName?: string }) {
  const key = `/api/tasks/${task._id}/documents`;
  const { data } = useSWR<DocRow[]>(key);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const docs = data ?? [];
  return (
    <Section
      title={`${t('Tài liệu')}${docs.length ? ` (${docs.length})` : ''}`}
      actions={
        <Button size="xs" variant="outline" onClick={() => setCreating(true)} icon={<Plus className="size-3.5" />}>
          {t('Tài liệu mới')}
        </Button>
      }
    >
      {!data ? (
        <Skeleton className="h-10" />
      ) : !docs.length ? (
        <p className="text-[13px] text-muted">{t('Chưa có tài liệu. Agent ghi kế hoạch, đặc tả, báo cáo dài vào đây để bạn đọc và bình luận từng đoạn.')}</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => (
            <button
              key={d._id}
              type="button"
              onClick={() => setOpenId(d._id)}
              className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2"
            >
              <FileText className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{d.title}</span>
                <span className="block truncate text-[11.5px] text-subtle">
                  {d.key} · {t('phiên bản {n} · {name} sửa {time}', { n: d.revision, name: t(d.updatedBy.name), time: timeAgo(d.updatedAt) })}
                </span>
              </span>
              {d.openThreads > 0 && (
                <Badge color="#C9952F">
                  <MessagesSquare className="size-3" /> {d.openThreads}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
      {creating && <NewDocument task={task} onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} />}
      {openId && <DocumentModal documentId={openId} departmentName={departmentName} onClose={() => setOpenId(null)} />}
    </Section>
  );
}

function NewDocument({ task, onClose, onCreated }: { task: Task; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const doc = await api.post<IssueDocument>(`/api/tasks/${task._id}/documents`, { title, body });
      await mutate(`/api/tasks/${task._id}/documents`);
      onClose();
      onCreated(doc._id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('Tài liệu mới')}
      description={t('Gắn với {task} – agent phụ trách đọc được và cập nhật theo góp ý của bạn.', { task: task.identifier ?? t('nhiệm vụ') })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Huỷ')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={save}>
            {t('Tạo tài liệu')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('Tiêu đề')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('vd Kế hoạch triển khai')} autoFocus />
        </Field>
        <Field label={t('Nội dung (Markdown)')}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[280px] font-mono text-[12.5px]" placeholder={t('# Mục tiêu\n…')} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------- Đoạn trích (anchor) trên văn bản đã hiển thị ----------------

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function indexText(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextIndex['nodes'] = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  return { text, nodes };
}

/** Vị trí (trong văn bản ghép) của một điểm DOM. */
function offsetOf(idx: TextIndex, container: Node, offset: number): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const n = idx.nodes.find((x) => x.node === container);
    return n ? n.start + offset : null;
  }
  // Điểm nằm giữa các phần tử con → lấy nút chữ đầu tiên phía sau điểm đó
  const point = document.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  for (const n of idx.nodes) {
    const nr = document.createRange();
    nr.selectNodeContents(n.node);
    if (point.compareBoundaryPoints(Range.START_TO_START, nr) <= 0) return n.start;
  }
  return idx.text.length;
}

function rangeFor(idx: TextIndex, start: number, end: number): Range | null {
  const at = (pos: number) => {
    for (let i = idx.nodes.length - 1; i >= 0; i--) {
      const n = idx.nodes[i];
      if (pos >= n.start) return { node: n.node, offset: Math.min(pos - n.start, n.node.data.length) };
    }
    return null;
  };
  const s = at(start);
  const e = at(end);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

/** Tìm lại đoạn trích: mọi vị trí khớp, chọn vị trí có phần trước/sau giống nhất. */
function locate(idx: TextIndex, anchor: DocAnchor): { start: number; end: number } | null {
  const { text } = idx;
  let best: { start: number; score: number } | null = null;
  for (let i = text.indexOf(anchor.quote); i >= 0; i = text.indexOf(anchor.quote, i + 1)) {
    let score = 0;
    const before = text.slice(Math.max(0, i - anchor.prefix.length), i);
    const after = text.slice(i + anchor.quote.length, i + anchor.quote.length + anchor.suffix.length);
    for (let k = 1; k <= Math.min(before.length, anchor.prefix.length) && before[before.length - k] === anchor.prefix[anchor.prefix.length - k]; k++) score++;
    for (let k = 0; k < Math.min(after.length, anchor.suffix.length) && after[k] === anchor.suffix[k]; k++) score++;
    if (!best || score > best.score) best = { start: i, score };
  }
  return best ? { start: best.start, end: best.start + anchor.quote.length } : null;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
function highlights(): { set: (name: string, h: unknown) => void; delete: (name: string) => void } | null {
  const reg = (globalThis as unknown as { CSS?: { highlights?: { set: (n: string, h: unknown) => void; delete: (n: string) => void } } }).CSS?.highlights;
  return reg && typeof (globalThis as { Highlight?: HighlightCtor }).Highlight === 'function' ? reg : null;
}

// ---------------- Hộp thoại tài liệu ----------------

type View = 'read' | 'edit' | 'history';

export function DocumentModal({ documentId, departmentName, onClose }: { documentId: string; departmentName?: string; onClose: () => void }) {
  const key = `/api/documents/${documentId}`;
  const { data, error } = useSWR<Bundle>(key);
  const [view, setView] = useState<View>('read');
  const doc = data?.document;
  const openThreads = (data?.threads ?? []).filter((t) => t.status === 'open').length;
  const refresh = () => Promise.all([mutate(key), doc && mutate(`/api/tasks/${doc.taskId}/documents`)]);

  const remove = async () => {
    if (!doc) return;
    const ok = await confirmDialog({ title: t('Xoá tài liệu "{title}"?', { title: doc.title }), message: t('Mọi phiên bản và bình luận của tài liệu cũng bị xoá.'), confirmLabel: t('Xoá'), tone: 'danger' });
    if (!ok) return;
    try {
      await api.del(key);
      await mutate(`/api/tasks/${doc.taskId}/documents`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <FileText className="size-4 text-accent" />
          {doc?.title ?? t('Tài liệu')}
        </span>
      }
      description={doc ? `${doc.key} · ${t('phiên bản {n} · {name} sửa {time}', { n: doc.revision, name: t(doc.updatedBy.name), time: timeAgo(doc.updatedAt) })}` : undefined}
    >
      {error ? (
        <EmptyState title={t('Không tải được tài liệu')} description={String(error.message ?? error)} />
      ) : !data || !doc ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'read', label: t('Đọc & bình luận'), count: openThreads || undefined },
                { value: 'edit', label: t('Sửa') },
                { value: 'history', label: t('Lịch sử'), count: data.revisions.length },
              ]}
            />
            <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={remove} icon={<Trash2 className="size-3.5" />}>
              {t('Xoá')}
            </Button>
          </div>
          {view === 'read' && <ReadView bundle={data} departmentName={departmentName} onChange={refresh} />}
          {view === 'edit' && (
            <EditView
              doc={doc}
              onSaved={async () => {
                await refresh();
                setView('read');
              }}
            />
          )}
          {view === 'history' && <HistoryView bundle={data} onRestored={refresh} />}
        </>
      )}
    </Modal>
  );
}

function ReadView({ bundle, departmentName, onChange }: { bundle: Bundle; departmentName?: string; onChange: () => Promise<unknown> }) {
  const { document: doc, threads } = bundle;
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ anchor: DocAnchor | null; pos: { x: number; y: number } | null } | null>(null);
  const [composing, setComposing] = useState<DocAnchor | null | undefined>(undefined);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [located, setLocated] = useState<Record<string, boolean>>({});
  const visible = threads.filter((t) => showResolved || t.status === 'open');

  // Tô sáng các đoạn đang được bình luận (CSS Custom Highlight API – không đụng tới DOM do React quản lý)
  useLayoutEffect(() => {
    const root = box.current;
    const reg = highlights();
    if (!root) return;
    const idx = indexText(root);
    const found: Record<string, boolean> = {};
    const all: Range[] = [];
    const act: Range[] = [];
    for (const t of threads) {
      if (!t.anchor) continue;
      const loc = locate(idx, t.anchor);
      found[t._id] = Boolean(loc);
      if (!loc || t.status !== 'open') continue;
      const r = rangeFor(idx, loc.start, loc.end);
      if (!r) continue;
      (t._id === active ? act : all).push(r);
    }
    setLocated((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
    if (!reg) return;
    const H = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
    reg.set('vp-doc', new H(...all));
    reg.set('vp-doc-active', new H(...act));
    return () => {
      reg.delete('vp-doc');
      reg.delete('vp-doc-active');
    };
  }, [threads, active, doc.body]);

  const onMouseUp = useCallback(() => {
    const root = box.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const idx = indexText(root);
    const start = offsetOf(idx, range.startContainer, range.startOffset);
    const end = offsetOf(idx, range.endContainer, range.endOffset);
    if (start == null || end == null) return;
    if (sel.isCollapsed || end <= start) {
      // Bấm vào đoạn đang tô sáng → mở luồng tương ứng
      const hit = threads.find((t) => {
        if (!t.anchor || t.status !== 'open') return false;
        const loc = locate(idx, t.anchor);
        return loc && start >= loc.start && start <= loc.end;
      });
      if (hit) setActive(hit._id);
      setDraft(null);
      return;
    }
    const quote = idx.text.slice(start, end).trim();
    if (!quote) return;
    const lead = idx.text.slice(start, end).indexOf(quote);
    const s = start + lead;
    const rect = range.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    setDraft({
      anchor: { quote: quote.slice(0, 1000), prefix: idx.text.slice(Math.max(0, s - 48), s), suffix: idx.text.slice(s + quote.length, s + quote.length + 48) },
      pos: { x: rect.left - host.left + rect.width / 2, y: rect.top - host.top },
    });
  }, [threads]);

  const focusThread = (t: DocumentThread) => {
    setActive(t._id);
    const root = box.current;
    if (!root || !t.anchor) return;
    const idx = indexText(root);
    const loc = locate(idx, t.anchor);
    const r = loc && rangeFor(idx, loc.start, loc.end);
    if (r) {
      const el = r.startContainer.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-w-0">
        <div ref={box} onMouseUp={onMouseUp} className="vp-doc rounded-2xl border border-line bg-surface p-4 sm:p-5">
          {doc.body.trim() ? <Markdown>{doc.body}</Markdown> : <p className="text-[13px] text-muted">{t('Tài liệu trống.')}</p>}
        </div>
        {draft?.pos && draft.anchor && (
          <button
            type="button"
            className="animate-vp-in absolute z-10 flex -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-[12px] font-medium text-bg shadow-lg"
            style={{ left: draft.pos.x, top: draft.pos.y }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setComposing(draft.anchor);
              setDraft(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <MessageSquarePlus className="size-3.5" />
            {t('Bình luận đoạn này')}
          </button>
        )}
        <p className="mt-2 text-[12px] text-subtle">{t('Bôi đen một đoạn để bình luận. Bấm vào đoạn được tô sáng để xem luồng bình luận.')}</p>
      </div>
      <aside className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold tracking-wider text-subtle uppercase">{t('Bình luận')}</span>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            {t('Đã đóng')}
            <Switch checked={showResolved} onChange={setShowResolved} label={t('Hiện bình luận đã đóng')} />
          </div>
        </div>
        {composing !== undefined ? (
          <ThreadComposer documentId={doc._id} anchor={composing} departmentName={departmentName} onDone={async (id) => {
            setComposing(undefined);
            await onChange();
            if (id) setActive(id);
          }} />
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setComposing(null)} icon={<MessageSquarePlus className="size-3.5" />}>
            {t('Bình luận cả tài liệu')}
          </Button>
        )}
        {!visible.length && composing === undefined && <p className="text-[12.5px] text-muted">{showResolved ? t('Chưa có bình luận.') : t('Chưa có bình luận đang mở.')}</p>}
        {visible.map((t) => (
          <ThreadCard key={t._id} documentId={doc._id} thread={t} active={active === t._id} outdated={Boolean(t.anchor) && located[t._id] === false} onFocus={() => focusThread(t)} onChange={onChange} />
        ))}
      </aside>
    </div>
  );
}

function ThreadComposer({ documentId, anchor, departmentName, onDone }: { documentId: string; anchor: DocAnchor | null; departmentName?: string; onDone: (threadId: string | null) => void }) {
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const created = await api.post<DocumentThread>(`/api/documents/${documentId}/threads`, { anchor, body, notifyAgent: notify });
      toast.success(notify ? t('Đã bình luận – {name} sẽ xem và sửa', { name: departmentName ? t(departmentName) : t('phòng phụ trách') }) : t('Đã bình luận'));
      onDone(created._id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent/5 p-3">
      {anchor ? <blockquote className="line-clamp-4 border-l-2 border-accent pl-2 text-[12.5px] text-muted italic">{anchor.quote}</blockquote> : <div className="text-[12.5px] text-muted">{t('Bình luận về cả tài liệu')}</div>}
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('Góp ý của bạn…')} className="min-h-[72px] text-[13px]" autoFocus />
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <Switch checked={notify} onChange={setNotify} label={t('Báo cho phòng phụ trách')} />
        {t('Báo cho {name} sửa theo góp ý', { name: departmentName ? t(departmentName) : t('phòng phụ trách') })}
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          {t('Huỷ')}
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!body.trim()} onClick={send}>
          {t('Gửi')}
        </Button>
      </div>
    </div>
  );
}

function ThreadCard({ documentId, thread, active, outdated, onFocus, onChange }: { documentId: string; thread: DocumentThread; active: boolean; outdated: boolean; onFocus: () => void; onChange: () => Promise<unknown> }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (action: 'reply' | 'resolve' | 'reopen') => {
    setBusy(true);
    try {
      await api.patch(`/api/documents/${documentId}/threads/${thread._id}`, { action, body: reply });
      if (action === 'reply') setReply('');
      await onChange();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const resolved = thread.status === 'resolved';
  return (
    <div
      className={clsx('rounded-2xl border p-3 text-[12.5px] transition-colors', active ? 'border-accent/50 bg-accent/5' : 'border-line', resolved && 'opacity-70')}
      onClick={onFocus}
    >
      {thread.anchor && (
        <blockquote className={clsx('mb-2 line-clamp-3 border-l-2 pl-2 italic', outdated ? 'border-line-strong text-subtle line-through' : 'border-warn text-muted')}>{thread.anchor.quote}</blockquote>
      )}
      {outdated && <div className="mb-2 text-[11.5px] text-warn">{t('Đoạn này đã thay đổi ở phiên bản mới.')}</div>}
      <div className="space-y-2">
        {thread.comments.map((c) => (
          <div key={c.id}>
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <b className={clsx('font-semibold', c.author.type === 'agent' && 'text-[#4A86BD]')}>{t(c.author.name)}</b>
              <span className="text-subtle" title={dateTime(c.createdAt)}>
                {timeAgo(c.createdAt)}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-fg">{c.body}</div>
          </div>
        ))}
      </div>
      {resolved && thread.resolvedBy && <div className="mt-2 text-[11.5px] text-ok">✓ {t('{name} đã đóng {time}', { name: t(thread.resolvedBy.name), time: timeAgo(thread.resolvedAt) })}</div>}
      <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
        {!resolved && (
          <Input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply.trim() && void act('reply')} placeholder={t('Trả lời…')} className="h-9 text-[12.5px]" />
        )}
        <div className="flex justify-end gap-1.5">
          {!resolved && reply.trim() && (
            <Button size="xs" variant="primary" loading={busy} onClick={() => act('reply')}>
              {t('Trả lời')}
            </Button>
          )}
          {resolved ? (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => act('reopen')} icon={<Undo2 className="size-3" />}>
              {t('Mở lại')}
            </Button>
          ) : (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => act('resolve')} icon={<Check className="size-3" />}>
              {t('Đã xử lý')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditView({ doc, onSaved }: { doc: IssueDocument; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  // Phiên bản lúc bắt đầu sửa (để phát hiện người khác sửa cùng lúc)
  const [base] = useState(doc.revision);
  const changed = title !== doc.title || body !== doc.body;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/documents/${doc._id}`, { title, body, changeSummary: summary, baseRevision: base });
      toast.success(t('Đã lưu phiên bản mới'));
      await onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {doc.revision > base && <div className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t('Tài liệu vừa có phiên bản mới ({n}) trong lúc bạn sửa – lưu sẽ báo xung đột. Sao chép phần bạn sửa rồi mở lại.', { n: doc.revision })}</div>}
      <Field label={t('Tiêu đề')}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('Nội dung (Markdown)')}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[360px] font-mono text-[12.5px]" />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label={t('Tóm tắt thay đổi')} className="flex-1">
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('vd Thêm mục rủi ro, sửa mốc thời gian')} />
        </Field>
        <Button variant="primary" loading={busy} disabled={!changed} onClick={save} icon={<PenLine className="size-4" />}>
          {t('Lưu phiên bản {n}', { n: doc.revision + 1 })}
        </Button>
      </div>
    </div>
  );
}

function HistoryView({ bundle, onRestored }: { bundle: Bundle; onRestored: () => Promise<unknown> }) {
  const { document: doc, revisions } = bundle;
  const [selected, setSelected] = useState<number>(revisions[1]?.revision ?? revisions[0]?.revision ?? doc.revision);
  const [mode, setMode] = useState<'diff' | 'view'>('diff');
  const [busy, setBusy] = useState(false);
  const rev = revisions.find((r) => r.revision === selected) ?? revisions[0];
  const previous = rev ? revisions.find((r) => r.revision < rev.revision) : undefined;
  const diff = useMemo(() => (rev ? lineDiff(previous?.body ?? '', rev.body) : []), [rev, previous]);
  const stats = diffStats(diff);
  const restore = async () => {
    if (!rev) return;
    const ok = await confirmDialog({ title: t('Khôi phục phiên bản {n}?', { n: rev.revision }), message: t('Nội dung hiện tại được giữ trong lịch sử; bản khôi phục thành phiên bản mới.'), confirmLabel: t('Khôi phục') });
    if (!ok) return;
    setBusy(true);
    try {
      await api.patch(`/api/documents/${doc._id}`, { action: 'restore', revision: rev.revision });
      toast.success(t('Đã khôi phục'));
      await onRestored();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {revisions.map((r) => (
          <button
            key={r._id}
            type="button"
            onClick={() => setSelected(r.revision)}
            className={clsx('w-full rounded-xl border px-3 py-2 text-left text-[12.5px]', r.revision === rev?.revision ? 'border-accent/50 bg-accent/5' : 'border-line hover:bg-surface-2')}
          >
            <div className="flex items-center gap-1.5">
              <b>{t('Phiên bản {n}', { n: r.revision })}</b>
              {r.revision === doc.revision && <Badge color="#5C9A68">{t('hiện tại')}</Badge>}
            </div>
            <div className="truncate text-muted">{r.changeSummary || '—'}</div>
            <div className="text-[11.5px] text-subtle">
              {t(r.author.name)} · {timeAgo(r.createdAt)}
            </div>
          </button>
        ))}
      </div>
      {rev && (
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'diff', label: previous ? t('Khác bản {n}', { n: previous.revision }) : t('Nội dung đầu tiên') },
                { value: 'view', label: t('Xem bản này') },
              ]}
            />
            <span className="text-[12px] text-subtle">
              <span className="text-ok">+{stats.added}</span> / <span className="text-danger">−{stats.removed}</span> {t('dòng')}
            </span>
            {rev.revision !== doc.revision && (
              <Button size="sm" variant="outline" className="ml-auto" loading={busy} onClick={restore} icon={<RotateCcw className="size-3.5" />}>
                {t('Khôi phục bản này')}
              </Button>
            )}
          </div>
          {mode === 'view' ? (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <Markdown>{rev.body || t('_(trống)_')}</Markdown>
            </div>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-2xl border border-line bg-surface p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {diff.map((l, i) => (
                <div key={i} className={clsx(l.type === 'add' && 'bg-ok/12 text-ok', l.type === 'del' && 'bg-danger/10 text-danger line-through decoration-danger/40')}>
                  <span className="mr-2 inline-block w-3 text-subtle select-none">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                  {l.text || ' '}
                </div>
              ))}
            </pre>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-subtle">
            <History className="size-3.5" /> {t(rev.author.name)} · {dateTime(rev.createdAt)}
            {rev.restoredFrom ? ` · ${t('khôi phục từ phiên bản {n}', { n: rev.restoredFrom })}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
