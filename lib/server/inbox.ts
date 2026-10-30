// Hộp thư (theo Paperclip "inbox"): gom mọi thứ đang chờ chủ công ty – phê duyệt, câu hỏi của agent, việc chờ duyệt,
// chuyển tiếp thủ công, giai đoạn chờ duyệt, sự cố ngân sách, lượt chạy im lặng, việc lỗi, trả lời trên tài liệu.
import type { InboxItem, InboxKind } from '../types';
import { currentCompanyId, getCollections, now } from './db';
import { emit } from './bus';
import { silence } from './runs';
import { tl } from '../i18n/server';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';

const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 } as const;
/** Việc lỗi hiện trong hộp thư bao lâu. */
const FAILED_WINDOW_MS = 3 * 86400_000;

type Draft = Omit<InboxItem, 'read'>;

/** Đệm ngắn theo công ty: nhiều tab / huy hiệu cùng hỏi trong 2 giây chỉ tính một lần (mỗi lần ~11 truy vấn). */
const cacheStore = globalThis as unknown as { __vpInboxCache?: Map<string, { at: number; items: Promise<InboxItem[]> }> };
const CACHE_MS = 2000;

/** Gom các mục đang chờ bạn. `includeDismissed`: hiện cả mục đã ẩn (tab "Đã ẩn"). `locale`: ngôn ngữ của người xem (tiêu đề / mô tả mục). */
export async function inboxItems(opts: { includeDismissed?: boolean; locale?: Locale } = {}): Promise<InboxItem[]> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const cache = (cacheStore.__vpInboxCache ??= new Map());
  const key = `${await currentCompanyId()}:${opts.includeDismissed ? 1 : 0}:${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const items = computeInboxItems(opts, locale);
  cache.set(key, { at: Date.now(), items });
  items.catch(() => cache.delete(key));
  return items;
}

async function forgetInboxCache(): Promise<void> {
  const id = await currentCompanyId();
  for (const k of Array.from(cacheStore.__vpInboxCache?.keys() ?? [])) if (k.startsWith(`${id}:`)) cacheStore.__vpInboxCache!.delete(k);
}

async function computeInboxItems(opts: { includeDismissed?: boolean }, locale: Locale): Promise<InboxItem[]> {
  const c = await getCollections();
  const t = Date.now();
  const [approvals, waitingHuman, inReview, phaseWaiting, incidents, running, failed, threads, projects, depts, pairings] = await Promise.all([
    c.approvals.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(200).toArray(),
    c.tasks.find({ status: 'waiting_human' }, { projection: { output: 0, liveText: 0, manualPrompt: 0 } }).limit(200).toArray(),
    c.tasks.find({ status: 'in_review' }, { projection: { output: 0, liveText: 0 } }).limit(200).toArray(),
    c.projects.find({ phaseState: 'awaiting_user', status: { $in: ['active', 'paused'] } }, { projection: { name: 1, currentPhase: 1, updatedAt: 1 } }).toArray(),
    c.budgetIncidents.find({ status: 'open' }).toArray(),
    c.runs.find({ status: 'running' }).toArray(),
    c.tasks
      .find({ status: 'failed', updatedAt: { $gte: new Date(t - FAILED_WINDOW_MS).toISOString() } }, { projection: { title: 1, identifier: 1, error: 1, projectId: 1, departmentId: 1, updatedAt: 1 } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray(),
    c.documentThreads.find({ status: 'open' }).sort({ updatedAt: -1 }).limit(100).toArray(),
    c.projects.find({}, { projection: { name: 1 } }).toArray(),
    c.departments.find({}, { projection: { name: 1 } }).toArray(),
    c.chatBindings.find({ status: 'pending' }).toArray(),
  ]);
  const pname = new Map(projects.map((p) => [p._id, p.name]));
  const dname = new Map(depts.map((d) => [d._id, d.name]));
  const drafts: Draft[] = [];
  const base = (projectId?: string | null) => ({ projectId: projectId || null, projectName: projectId ? (pname.get(projectId) ?? null) : null });

  for (const a of approvals) {
    drafts.push({
      id: `approval:${a._id}`,
      kind: 'approval',
      title: a.titleI18n ? tl(locale, a.titleI18n.key, a.titleI18n.vars) : a.title,
      detail: (a.detailI18n ? tl(locale, a.detailI18n.key, a.detailI18n.vars) : a.detail).slice(0, 600),
      severity: a.type === 'budget_override' || a.type === 'computer' ? 'critical' : 'warn',
      actionable: true,
      createdAt: a.createdAt,
      ...base(a.projectId),
      taskId: a.taskId || null,
      departmentId: a.departmentId || null,
      href: '/approvals',
      data: { approval: a },
    });
  }
  for (const task of waitingHuman) {
    const who = tl(locale, dname.get(task.departmentId) ?? task.departmentId);
    if (task.question) {
      drafts.push({
        id: `question:${task._id}:${task.round}`,
        kind: 'question',
        title: tl(locale, '{who} hỏi: {question}', { who, question: task.question.prompt.slice(0, 160) }),
        detail: `${task.identifier ?? ''} ${task.title}`.trim(),
        severity: 'warn',
        actionable: true,
        createdAt: task.updatedAt,
        ...base(task.projectId),
        taskId: task._id,
        departmentId: task.departmentId,
        href: `/projects/${task.projectId}?task=${task._id}`,
        data: { question: task.question },
      });
    } else {
      drafts.push({
        id: `manual:${task._id}:${task.attempts}`,
        kind: 'manual',
        title: tl(locale, 'Chuyển tiếp qua trình duyệt: {title}', { title: task.title }),
        detail: tl(locale, '{who} cần bạn dán prompt vào ChatGPT / Claude.ai… rồi dán câu trả lời lại.', { who }),
        severity: 'warn',
        actionable: true,
        createdAt: task.updatedAt,
        ...base(task.projectId),
        taskId: task._id,
        departmentId: task.departmentId,
        href: `/projects/${task.projectId}?task=${task._id}`,
      });
    }
  }
  for (const task of inReview) {
    const stage = task.reviewStages?.find((s) => s.status === 'pending');
    if (stage?.reviewer !== 'user') continue;
    drafts.push({
      id: `review:${task._id}:${task.round}`,
      kind: 'review',
      title: tl(locale, 'Chờ bạn duyệt: {title}', { title: `${task.identifier ?? ''} ${task.title}`.trim() }).replace(/\s+/g, ' '),
      detail: (task.result ?? '').slice(0, 600),
      severity: 'warn',
      actionable: true,
      createdAt: task.updatedAt,
      ...base(task.projectId),
      taskId: task._id,
      departmentId: task.departmentId,
      href: `/projects/${task.projectId}?task=${task._id}`,
    });
  }
  for (const p of phaseWaiting) {
    drafts.push({
      id: `phase:${p._id}:${p.currentPhase}`,
      kind: 'phase',
      title: tl(locale, 'Giai đoạn chờ bạn duyệt: {name}', { name: p.name }),
      detail: tl(locale, 'Xem kết quả giai đoạn rồi Duyệt để sang giai đoạn sau, hoặc yêu cầu làm lại.'),
      severity: 'warn',
      actionable: true,
      createdAt: p.updatedAt,
      ...base(p._id),
      href: `/projects/${p._id}`,
    });
  }
  const pendingApprovalIds = new Set(approvals.map((a) => a._id));
  for (const inc of incidents) {
    // Đã có thẻ phê duyệt "vượt ngân sách" đang chờ → không lặp lại
    if (inc.approvalId && pendingApprovalIds.has(inc.approvalId)) continue;
    const pct = inc.amountLimit ? Math.round((inc.amountObserved / inc.amountLimit) * 100) : 0;
    const spend = { spent: inc.amountObserved.toFixed(2), limit: inc.amountLimit.toFixed(2) };
    drafts.push({
      id: `budget:${inc._id}`,
      kind: 'budget',
      title: inc.threshold === 'hard' ? tl(locale, 'Vượt ngân sách ({pct}%) – đã tạm dừng', { pct }) : tl(locale, 'Sắp hết ngân sách ({pct}%)', { pct }),
      detail:
        inc.scopeType === 'company'
          ? tl(locale, 'Phạm vi công ty: đã chi ${spent} / ${limit}.', spend)
          : inc.scopeType === 'department'
            ? tl(locale, 'Phạm vi phòng {name}: đã chi ${spent} / ${limit}.', { ...spend, name: tl(locale, dname.get(inc.scopeId) ?? inc.scopeId) })
            : tl(locale, 'Phạm vi dự án {name}: đã chi ${spent} / ${limit}.', { ...spend, name: pname.get(inc.scopeId) ?? inc.scopeId }),
      severity: inc.threshold === 'hard' ? 'critical' : 'warn',
      actionable: inc.threshold === 'hard',
      createdAt: inc.createdAt,
      ...base(inc.scopeType === 'project' ? inc.scopeId : null),
      href: '/costs',
      data: { incident: inc },
    });
  }
  for (const r of running) {
    const level = silence(r, t);
    if (level === 'ok') continue;
    const name = tl(locale, dname.get(r.departmentId) ?? r.departmentId);
    drafts.push({
      id: `silent:${r._id}`,
      kind: 'silent_run',
      title: level === 'critical' ? tl(locale, '{name} im lặng hơn 15 phút', { name }) : tl(locale, '{name} im lặng hơn 5 phút', { name }),
      detail: tl(locale, '{provider} – không có đầu ra mới. Có thể agent đang chờ một lệnh chạy lâu, hoặc đã bị treo.', { provider: `${r.providerName ?? ''}${r.model ? ` · ${r.model}` : ''}` }),
      severity: level === 'critical' ? 'critical' : 'warn',
      actionable: true,
      createdAt: r.lastOutputAt ?? r.startedAt,
      ...base(r.projectId),
      taskId: r.taskId,
      departmentId: r.departmentId,
      href: `/projects/${r.projectId}?task=${r.taskId}`,
      data: { runId: r._id },
    });
  }
  for (const task of failed) {
    drafts.push({
      id: `failed:${task._id}:${task.updatedAt}`,
      kind: 'failed_task',
      title: tl(locale, 'Việc lỗi: {title}', { title: `${task.identifier ?? ''} ${task.title}`.trim() }).replace(/\s+/g, ' '),
      detail: (task.error ?? '').slice(0, 400),
      severity: 'warn',
      actionable: false,
      createdAt: task.updatedAt,
      ...base(task.projectId),
      taskId: task._id,
      departmentId: task.departmentId,
      href: `/projects/${task.projectId}?task=${task._id}`,
    });
  }
  for (const th of threads) {
    const last = th.comments[th.comments.length - 1];
    if (!last || last.author.type !== 'agent') continue;
    drafts.push({
      id: `doc:${th._id}:${last.id}`,
      kind: 'doc_reply',
      title: tl(locale, '{name} trả lời bình luận trên tài liệu', { name: tl(locale, last.author.name) }),
      detail: `${th.anchor ? `“${th.anchor.quote.slice(0, 120)}” – ` : ''}${last.body.slice(0, 300)}`,
      severity: 'info',
      actionable: false,
      createdAt: last.createdAt,
      ...base(th.projectId),
      taskId: th.taskId,
      href: `/projects/${th.projectId}?task=${th.taskId}`,
      data: { documentId: th.documentId, threadId: th._id },
    });
  }
  for (const p of pairings) {
    drafts.push({
      id: `pairing:${p._id}`,
      kind: 'chat_pairing',
      title: tl(locale, 'Yêu cầu kết nối Telegram: {chat}', { chat: p.chatTitle }),
      detail: tl(locale, 'Mã ghép nối {code}. Duyệt để cuộc trò chuyện này nhắn được cho văn phòng.', { code: p.code }),
      severity: 'warn',
      actionable: true,
      createdAt: p.createdAt,
      href: '/connections',
      data: { bindingId: p._id, connectorId: p.connectorId },
    });
  }

  const states = await c.inboxState.find({ _id: { $in: drafts.map((d) => d.id) } }).toArray();
  const st = new Map(states.map((s) => [s._id, s]));
  return drafts
    .filter((d) => opts.includeDismissed || d.actionable || !st.get(d.id)?.dismissedAt)
    .map((d) => ({ ...d, read: Boolean(st.get(d.id)?.readAt) }))
    .sort((a, b) => Number(b.actionable) - Number(a.actionable) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.createdAt.localeCompare(a.createdAt));
}

/** Số mục chưa đọc (cho huy hiệu trên thanh điều hướng). `locale` chỉ để dùng chung bộ đệm với danh sách. */
export async function inboxSummary(locale?: Locale): Promise<{ total: number; unread: number; actionable: number; byKind: Partial<Record<InboxKind, number>> }> {
  const items = await inboxItems({ locale });
  const byKind: Partial<Record<InboxKind, number>> = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return { total: items.length, unread: items.filter((i) => !i.read).length, actionable: items.filter((i) => i.actionable).length, byKind };
}

export async function markInbox(ids: string[], action: 'read' | 'unread' | 'dismiss' | 'restore'): Promise<void> {
  const c = await getCollections();
  const ts = now();
  const set =
    action === 'read' ? { readAt: ts } : action === 'unread' ? { readAt: null } : action === 'dismiss' ? { dismissedAt: ts, readAt: ts } : { dismissedAt: null };
  await Promise.all(ids.slice(0, 500).map((id) => c.inboxState.updateOne({ _id: id }, { $set: set }, { upsert: true })));
  await forgetInboxCache();
  await emit('inbox.updated', null, { ids: ids.length, action });
}
