// Tài liệu của nhiệm vụ (theo Paperclip: documents, document_revisions, issue_documents + luồng bình luận theo đoạn).
// Mỗi nhiệm vụ có nhiều tài liệu (mỗi khoá một tài liệu); mỗi lần sửa là một phiên bản; bình luận gắn vào đoạn trích.
import type { DocAnchor, DocAuthor, DocumentRevision, DocumentThread, IssueDocument, Task } from '../types';
import { getCollections, newId, now } from './db';
import { emit } from './bus';
import { logActivity } from './activity';
import { getTask } from './repo';
import { LocalizedError } from './http';
import { m } from '../i18n';

export const DOC_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_BODY = 200_000;

export class DocConflictError extends LocalizedError {
  constructor(public current: IssueDocument) {
    super(m('Tài liệu vừa được {name} sửa (phiên bản {revision}). Tải lại để xem bản mới rồi sửa tiếp.'), { name: current.updatedBy.name, revision: current.revision }, 409);
  }
}

export const USER_AUTHOR: DocAuthor = { type: 'user', name: 'Bạn' };

/** Khoá tài liệu từ tiêu đề (bỏ dấu, chữ thường, gạch ngang). */
export function docKeyFrom(title: string): string {
  const k = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return k || 'tai-lieu';
}

export async function listTaskDocuments(taskId: string): Promise<(IssueDocument & { openThreads: number })[]> {
  const c = await getCollections();
  const [docs, open] = await Promise.all([
    c.documents.find({ taskId }).sort({ createdAt: 1 }).toArray(),
    c.documentThreads.aggregate<{ _id: string; n: number }>([{ $match: { taskId, status: 'open' } }, { $group: { _id: '$documentId', n: { $sum: 1 } } }]).toArray(),
  ]);
  const count = new Map(open.map((r) => [r._id, r.n]));
  return docs.map((d) => ({ ...d, openThreads: count.get(d._id) ?? 0 }));
}

export async function getDocument(id: string): Promise<IssueDocument | null> {
  const c = await getCollections();
  return c.documents.findOne({ _id: id });
}

/** Tài liệu kèm toàn bộ phiên bản (mới nhất trước) và các luồng bình luận. */
export async function getDocumentBundle(id: string): Promise<{ document: IssueDocument; revisions: DocumentRevision[]; threads: DocumentThread[] } | null> {
  const c = await getCollections();
  const document = await c.documents.findOne({ _id: id });
  if (!document) return null;
  const [revisions, threads] = await Promise.all([
    c.documentRevisions.find({ documentId: id }).sort({ revision: -1 }).limit(200).toArray(),
    c.documentThreads.find({ documentId: id }).sort({ createdAt: 1 }).toArray(),
  ]);
  return { document, revisions, threads };
}

async function addRevision(doc: IssueDocument, changeSummary: string, author: DocAuthor, restoredFrom: number | null = null): Promise<void> {
  const c = await getCollections();
  await c.documentRevisions.insertOne({
    _id: newId(),
    documentId: doc._id,
    taskId: doc.taskId,
    projectId: doc.projectId,
    revision: doc.revision,
    title: doc.title,
    body: doc.body,
    changeSummary: changeSummary.trim().slice(0, 500),
    author,
    restoredFrom,
    createdAt: doc.updatedAt,
  });
}

/**
 * Tạo hoặc cập nhật tài liệu theo khoá. Nội dung không đổi → không tạo phiên bản mới.
 * `baseRevision`: phiên bản người sửa đang xem – nếu tài liệu đã có bản mới hơn thì báo xung đột thay vì ghi đè.
 */
export async function saveDocument(input: {
  taskId: string;
  key?: string;
  title?: string;
  body: string;
  changeSummary?: string;
  author: DocAuthor;
  baseRevision?: number | null;
}): Promise<{ document: IssueDocument; created: boolean; changed: boolean }> {
  const task = await getTask(input.taskId);
  if (!task) throw new LocalizedError(m('Không tìm thấy nhiệm vụ'), undefined, 404);
  const c = await getCollections();
  const title = (input.title ?? '').trim().slice(0, 200);
  const key = input.key?.trim() ? input.key.trim().toLowerCase() : docKeyFrom(title);
  if (!DOC_KEY_RE.test(key)) throw new LocalizedError(m('Khoá tài liệu chỉ gồm chữ thường, số và gạch ngang (tối đa 40 ký tự).'));
  const body = input.body.slice(0, MAX_BODY);
  const ts = now();
  const existing = await c.documents.findOne({ taskId: task._id, key });
  if (!existing) {
    const doc: IssueDocument = {
      _id: newId(),
      taskId: task._id,
      projectId: task.projectId,
      key,
      title: title || key,
      format: 'markdown',
      body,
      revision: 1,
      createdBy: input.author,
      updatedBy: input.author,
      createdAt: ts,
      updatedAt: ts,
    };
    await c.documents.insertOne(doc);
    await addRevision(doc, input.changeSummary || 'Tạo tài liệu', input.author);
    await emit('document.updated', task.projectId, { id: doc._id, taskId: task._id });
    await logActivity({ actorType: input.author.type, actorId: input.author.id ?? null, actorName: input.author.name, action: 'document.created', entityType: 'document', entityId: doc._id, projectId: task.projectId, summary: `Tạo tài liệu "${doc.title}" cho ${task.identifier ?? task.title}` });
    return { document: doc, created: true, changed: true };
  }
  if (input.baseRevision != null && input.baseRevision < existing.revision) throw new DocConflictError(existing);
  const nextTitle = title || existing.title;
  if (existing.body === body && existing.title === nextTitle) return { document: existing, created: false, changed: false };
  const res = await c.documents.findOneAndUpdate(
    { _id: existing._id, revision: existing.revision },
    { $set: { body, title: nextTitle, updatedBy: input.author, updatedAt: ts }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  // Hai người sửa cùng lúc → người ghi sau nhận xung đột
  if (!res) throw new DocConflictError((await c.documents.findOne({ _id: existing._id })) ?? existing);
  await addRevision(res, input.changeSummary || 'Cập nhật nội dung', input.author);
  await emit('document.updated', task.projectId, { id: res._id, taskId: task._id });
  await logActivity({ actorType: input.author.type, actorId: input.author.id ?? null, actorName: input.author.name, action: 'document.updated', entityType: 'document', entityId: res._id, projectId: task.projectId, summary: `Sửa tài liệu "${res.title}" (phiên bản ${res.revision})` });
  return { document: res, created: false, changed: true };
}

/** Khôi phục nội dung của một phiên bản cũ (ghi thành phiên bản mới, không xoá lịch sử). */
export async function restoreRevision(documentId: string, revision: number, author: DocAuthor): Promise<IssueDocument> {
  const c = await getCollections();
  const doc = await c.documents.findOne({ _id: documentId });
  const rev = await c.documentRevisions.findOne({ documentId, revision });
  if (!doc || !rev) throw new LocalizedError(m('Không tìm thấy phiên bản'), undefined, 404);
  if (doc.body === rev.body && doc.title === rev.title) return doc;
  const res = await c.documents.findOneAndUpdate(
    { _id: documentId },
    { $set: { body: rev.body, title: rev.title, updatedBy: author, updatedAt: now() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  if (!res) throw new LocalizedError(m('Không khôi phục được'), undefined, 500);
  await addRevision(res, `Khôi phục phiên bản ${revision}`, author, revision);
  await emit('document.updated', res.projectId, { id: res._id, taskId: res.taskId });
  await logActivity({ actorType: author.type, actorName: author.name, action: 'document.restored', entityType: 'document', entityId: res._id, projectId: res.projectId, summary: `Khôi phục "${res.title}" về phiên bản ${revision}` });
  return res;
}

export async function deleteDocument(id: string, author: DocAuthor = USER_AUTHOR): Promise<void> {
  const c = await getCollections();
  const doc = await c.documents.findOne({ _id: id });
  if (!doc) return;
  await Promise.all([c.documents.deleteOne({ _id: id }), c.documentRevisions.deleteMany({ documentId: id }), c.documentThreads.deleteMany({ documentId: id })]);
  await emit('document.updated', doc.projectId, { id, taskId: doc.taskId, deleted: true });
  await logActivity({ actorType: author.type, actorName: author.name, action: 'document.deleted', entityType: 'document', entityId: id, projectId: doc.projectId, summary: `Xoá tài liệu "${doc.title}"` });
}

// ---------------- Bình luận theo đoạn ----------------

function cleanAnchor(a: unknown): DocAnchor | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const quote = String(o.quote ?? '').trim().slice(0, 1000);
  if (!quote) return null;
  return { quote, prefix: String(o.prefix ?? '').slice(-64), suffix: String(o.suffix ?? '').slice(0, 64) };
}

export async function createThread(documentId: string, input: { anchor?: unknown; body: string; author: DocAuthor }): Promise<DocumentThread> {
  const c = await getCollections();
  const doc = await c.documents.findOne({ _id: documentId });
  if (!doc) throw new LocalizedError(m('Không tìm thấy tài liệu'), undefined, 404);
  const body = input.body.trim().slice(0, 8000);
  if (!body) throw new LocalizedError(m('Nhập nội dung bình luận'));
  const ts = now();
  const thread: DocumentThread = {
    _id: newId(),
    documentId,
    taskId: doc.taskId,
    projectId: doc.projectId,
    revision: doc.revision,
    anchor: cleanAnchor(input.anchor),
    status: 'open',
    comments: [{ id: newId(), author: input.author, body, createdAt: ts }],
    resolvedBy: null,
    resolvedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await c.documentThreads.insertOne(thread);
  await emit('document.updated', doc.projectId, { id: documentId, taskId: doc.taskId, thread: thread._id });
  await logActivity({ actorType: input.author.type, actorName: input.author.name, action: 'document.comment_added', entityType: 'document', entityId: documentId, projectId: doc.projectId, summary: `Bình luận trên "${doc.title}"${thread.anchor ? `: “${thread.anchor.quote.slice(0, 60)}”` : ''}` });
  return thread;
}

export async function replyThread(threadId: string, body: string, author: DocAuthor): Promise<DocumentThread | null> {
  const c = await getCollections();
  const text = body.trim().slice(0, 8000);
  if (!text) throw new LocalizedError(m('Nhập nội dung trả lời'));
  const ts = now();
  const res = await c.documentThreads.findOneAndUpdate(
    { _id: threadId },
    { $push: { comments: { id: newId(), author, body: text, createdAt: ts } }, $set: { updatedAt: ts } },
    { returnDocument: 'after' },
  );
  if (res) await emit('document.updated', res.projectId, { id: res.documentId, taskId: res.taskId, thread: threadId });
  return res;
}

export async function setThreadStatus(threadId: string, status: DocumentThread['status'], author: DocAuthor): Promise<DocumentThread | null> {
  const c = await getCollections();
  const ts = now();
  const res = await c.documentThreads.findOneAndUpdate(
    { _id: threadId },
    { $set: { status, updatedAt: ts, resolvedBy: status === 'resolved' ? author : null, resolvedAt: status === 'resolved' ? ts : null } },
    { returnDocument: 'after' },
  );
  if (res) {
    await emit('document.updated', res.projectId, { id: res.documentId, taskId: res.taskId, thread: threadId });
    await logActivity({ actorType: author.type, actorName: author.name, action: status === 'resolved' ? 'document.thread_resolved' : 'document.thread_reopened', entityType: 'document', entityId: res.documentId, projectId: res.projectId, summary: `${status === 'resolved' ? 'Đóng' : 'Mở lại'} bình luận${res.anchor ? ` “${res.anchor.quote.slice(0, 60)}”` : ''}` });
  }
  return res;
}

export async function getThread(id: string): Promise<DocumentThread | null> {
  const c = await getCollections();
  return c.documentThreads.findOne({ _id: id });
}

// ---------------- Dành cho agent ----------------

/** Tài liệu của nhiệm vụ (và của việc cha) + bình luận đang mở – đưa vào prompt. */
export async function documentsForPrompt(task: Task, limit = 6000): Promise<string> {
  const c = await getCollections();
  const own = await c.documents.find({ taskId: task._id }).sort({ createdAt: 1 }).limit(12).toArray();
  const parent = task.parentId ? await c.documents.find({ taskId: task.parentId }).sort({ createdAt: 1 }).limit(6).toArray() : [];
  if (!own.length && !parent.length) return '';
  const threads = own.length ? await c.documentThreads.find({ documentId: { $in: own.map((d) => d._id) }, status: 'open' }).sort({ createdAt: 1 }).limit(40).toArray() : [];
  const parts: string[] = [];
  if (own.length) {
    parts.push(
      `# Tài liệu của nhiệm vụ này\n${own
        .map((d) => {
          const open = threads.filter((t) => t.documentId === d._id);
          const comments = open.length
            ? `\n\n**Bình luận đang mở (${open.length}):**\n${open
                .map((t) => `- [${t._id}]${t.anchor ? ` về đoạn “${t.anchor.quote.slice(0, 300)}”` : ' (cả tài liệu)'}:\n${t.comments.map((m) => `  - ${m.author.name}: ${m.body.slice(0, 1200)}`).join('\n')}`)
                .join('\n')}`
            : '';
          return `## ${d.title} (khoá "${d.key}", phiên bản ${d.revision}, sửa lần cuối bởi ${d.updatedBy.name})\n${d.body.slice(0, limit)}${d.body.length > limit ? '\n…(đã rút gọn)' : ''}${comments}`;
        })
        .join('\n\n')}`,
    );
  }
  if (parent.length) {
    parts.push(`# Tài liệu của việc lớn (chỉ đọc)\n${parent.map((d) => `## ${d.title} (khoá "${d.key}")\n${d.body.slice(0, 2500)}${d.body.length > 2500 ? '\n…(đã rút gọn)' : ''}`).join('\n\n')}`);
  }
  if (threads.length) parts.push('Có bình luận đang mở trên tài liệu: sửa tài liệu theo góp ý (ghi lại toàn văn qua "documents") và trả lời từng luồng (qua "document_replies", đặt "resolve": true khi đã xử lý xong).');
  return parts.join('\n\n');
}

export interface AgentDocWrite {
  key?: string;
  title: string;
  body: string;
  summary?: string;
}

export interface AgentDocReply {
  thread: string;
  body: string;
  resolve?: boolean;
}

/** Ghi tài liệu / trả lời bình luận agent nộp kèm kết quả. Trả về danh sách mô tả ngắn để ghi nhật ký. */
export async function applyAgentDocuments(task: Task, author: DocAuthor, docs: AgentDocWrite[], replies: AgentDocReply[]): Promise<string[]> {
  const notes: string[] = [];
  for (const d of docs.slice(0, 8)) {
    if (!d.body?.trim()) continue;
    try {
      const key = d.key && DOC_KEY_RE.test(d.key.trim().toLowerCase()) ? d.key.trim().toLowerCase() : docKeyFrom(d.title || d.key || 'tai-lieu');
      const r = await saveDocument({ taskId: task._id, key, title: d.title, body: d.body, changeSummary: d.summary, author });
      if (r.changed) notes.push(`${r.created ? 'Tạo' : 'Cập nhật'} tài liệu "${r.document.title}" (phiên bản ${r.document.revision})`);
    } catch (err) {
      notes.push(`Không ghi được tài liệu "${d.title}": ${err instanceof Error ? err.message : err}`);
    }
  }
  const c = await getCollections();
  for (const r of replies.slice(0, 20)) {
    const thread = await c.documentThreads.findOne({ _id: r.thread });
    // Agent chỉ trả lời bình luận trên tài liệu của chính nhiệm vụ mình
    if (!thread || thread.taskId !== task._id) continue;
    if (r.body?.trim()) await replyThread(thread._id, r.body, author);
    if (r.resolve && thread.status === 'open') await setThreadStatus(thread._id, 'resolved', author);
    notes.push(`${r.resolve ? 'Trả lời & đóng' : 'Trả lời'} bình luận${thread.anchor ? ` “${thread.anchor.quote.slice(0, 40)}”` : ''}`);
  }
  return notes;
}
