// Kênh chat Telegram (theo Paperclip "chat connectors"): tin nhắn Telegram ↔ cuộc trò chuyện của dự án.
// - Nhận tin bằng long-poll getUpdates (không cần mở cổng ra Internet).
// - Cuộc trò chuyện mới phải được bạn duyệt (mã ghép nối) mới nhắn được cho văn phòng.
// - Câu trả lời / câu hỏi của agent trong dự án đang ghép được gửi về Telegram.
import crypto from 'crypto';
import type { AppEvent, ChatBinding, ChatConnector, Message } from '../types';
import { getCollections, newId, now } from './db';
import { bus, emit, wakeWorker } from './bus';
import { logActivity } from './activity';
import { resolveSecretRefs, upsertSecretValue } from './secrets';
import { handleUserChat } from './chat';
import { answerTaskQuestion } from './governance';

const DEFAULT_API = 'https://api.telegram.org';
const MAX_TEXT = 3900;

// ---------------- Dữ liệu ----------------

export function publicConnector(c: ChatConnector): ChatConnector {
  const { token, ...rest } = c;
  return { ...rest, hasToken: Boolean(token), tokenPreview: token ? '••••' : undefined };
}

export async function listConnectors(): Promise<ChatConnector[]> {
  const c = await getCollections();
  return c.chatConnectors.find().sort({ createdAt: 1 }).toArray();
}

export async function listBindings(connectorId?: string): Promise<ChatBinding[]> {
  const c = await getCollections();
  return c.chatBindings.find(connectorId ? { connectorId } : {}).sort({ createdAt: -1 }).toArray();
}

export async function saveConnector(id: string | null, input: Partial<ChatConnector> & { token?: string }): Promise<ChatConnector> {
  const c = await getCollections();
  const existing = id ? await c.chatConnectors.findOne({ _id: id }) : null;
  if (id && !existing) throw new Error('Không tìm thấy kênh chat');
  const ts = now();
  const _id = existing?._id ?? newId();
  let token = existing?.token;
  if (input.token?.trim()) {
    const key = `TELEGRAM_BOT_${_id.slice(-8).toUpperCase()}`;
    await upsertSecretValue(key, input.token.trim(), `Mã bot Telegram (${input.name ?? existing?.name ?? 'kênh chat'})`);
    token = `secret:${key}`;
  }
  const apiBase = (input.apiBase ?? existing?.apiBase ?? '').trim().replace(/\/+$/, '');
  if (apiBase && !/^https?:\/\//.test(apiBase)) throw new Error('Địa chỉ Bot API phải bắt đầu bằng http(s)://');
  const doc: ChatConnector = {
    _id,
    kind: 'telegram',
    name: (input.name ?? existing?.name ?? 'Telegram').trim().slice(0, 80) || 'Telegram',
    enabled: input.enabled ?? existing?.enabled ?? true,
    token,
    apiBase: apiBase || undefined,
    defaultProjectId: input.defaultProjectId !== undefined ? input.defaultProjectId || null : (existing?.defaultProjectId ?? null),
    forward: input.forward === 'all' || input.forward === 'replies' ? input.forward : (existing?.forward ?? 'replies'),
    requirePairing: input.requirePairing ?? existing?.requirePairing ?? true,
    lastUpdateId: existing?.lastUpdateId ?? 0,
    status: existing?.status,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  await c.chatConnectors.replaceOne({ _id }, doc, { upsert: true });
  await emit('connector.updated', null, { id: _id });
  await logActivity({ action: existing ? 'connector.updated' : 'connector.created', entityType: 'connector', entityId: _id, summary: `${existing ? 'Sửa' : 'Thêm'} kênh chat ${doc.name}` });
  if (doc.enabled && doc.token) void pollConnector(_id).catch(() => undefined);
  return doc;
}

export async function deleteConnector(id: string): Promise<void> {
  const c = await getCollections();
  const doc = await c.chatConnectors.findOne({ _id: id });
  await Promise.all([c.chatConnectors.deleteOne({ _id: id }), c.chatBindings.deleteMany({ connectorId: id })]);
  await emit('connector.updated', null, { id, deleted: true });
  if (doc) await logActivity({ action: 'connector.deleted', entityType: 'connector', entityId: id, summary: `Xoá kênh chat ${doc.name}` });
}

/** Duyệt / chặn / đổi dự án của một cuộc trò chuyện. */
export async function updateBinding(id: string, patch: { status?: ChatBinding['status']; projectId?: string | null }): Promise<ChatBinding | null> {
  const c = await getCollections();
  const before = await c.chatBindings.findOne({ _id: id });
  if (!before) return null;
  const set: Partial<ChatBinding> = { updatedAt: now() };
  if (patch.status && ['pending', 'active', 'blocked'].includes(patch.status)) set.status = patch.status;
  if (patch.projectId !== undefined) set.projectId = patch.projectId || null;
  const res = await c.chatBindings.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
  await emit('connector.updated', null, { binding: id });
  await emit('inbox.updated', null, {});
  if (res && before.status !== res.status) {
    await logActivity({ action: `connector.chat_${res.status}`, entityType: 'connector', entityId: res.connectorId, summary: `${res.status === 'active' ? 'Duyệt' : res.status === 'blocked' ? 'Chặn' : 'Đặt chờ duyệt'} cuộc trò chuyện Telegram "${res.chatTitle}"` });
    const conn = await c.chatConnectors.findOne({ _id: res.connectorId });
    if (conn && res.status === 'active') await sendText(conn, res.chatId, '✅ Đã kết nối với văn phòng. Nhắn yêu cầu để giao việc cho giám đốc.\n\nLệnh: /duan – chọn dự án, /moi – yêu cầu mới, /trangthai – tiến độ.').catch(() => undefined);
    if (conn && res.status === 'blocked') await sendText(conn, res.chatId, 'Cuộc trò chuyện này đã bị chặn.').catch(() => undefined);
  }
  return res;
}

export async function deleteBinding(id: string): Promise<void> {
  const c = await getCollections();
  await c.chatBindings.deleteOne({ _id: id });
  await emit('connector.updated', null, { binding: id, deleted: true });
}

// ---------------- Bot API ----------------

async function botToken(conn: ChatConnector): Promise<string> {
  if (!conn.token) throw new Error('Chưa nhập mã bot');
  const r = await resolveSecretRefs({ token: conn.token }, { label: `Kênh chat ${conn.name}` });
  return r.map.token;
}

async function call<T>(conn: ChatConnector, method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const token = await botToken(conn);
  const res = await fetch(`${conn.apiBase || DEFAULT_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as { ok: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(j.description || `Telegram lỗi (HTTP ${res.status})`);
  return j.result as T;
}

/** Bỏ định dạng Markdown để gửi chữ thường (Telegram không cần escape). */
function plain(md: string): string {
  return md
    .replace(/```[a-z-]*\n?/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export async function sendText(conn: ChatConnector, chatId: string, text: string): Promise<void> {
  const body = plain(text);
  for (let i = 0; i < body.length || i === 0; i += MAX_TEXT) {
    await call(conn, 'sendMessage', { chat_id: chatId, text: body.slice(i, i + MAX_TEXT) || '…', disable_web_page_preview: true });
    if (body.length <= MAX_TEXT) break;
  }
}

/** Kiểm tra mã bot (getMe). */
export async function testConnector(id: string): Promise<ChatConnector> {
  const c = await getCollections();
  const conn = await c.chatConnectors.findOne({ _id: id });
  if (!conn) throw new Error('Không tìm thấy kênh chat');
  let status: ChatConnector['status'];
  try {
    const me = await call<{ username?: string; first_name?: string }>(conn, 'getMe', {});
    status = { ok: true, message: 'Bot hoạt động', checkedAt: now(), botName: me.username ? `@${me.username}` : me.first_name };
  } catch (err) {
    status = { ok: false, message: err instanceof Error ? err.message : String(err), checkedAt: now() };
  }
  await c.chatConnectors.updateOne({ _id: id }, { $set: { status } });
  await emit('connector.updated', null, { id });
  return (await c.chatConnectors.findOne({ _id: id }))!;
}

// ---------------- Nhận tin ----------------

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    photo?: unknown[];
    document?: unknown;
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string; last_name?: string };
    from?: { first_name?: string; last_name?: string; username?: string };
  };
}

const g = globalThis as unknown as { __vpTgPolling?: Set<string> };
const polling: Set<string> = (g.__vpTgPolling ??= new Set());

/** Một lượt long-poll cho một kênh (bỏ qua nếu lượt trước chưa xong). */
export async function pollConnector(id: string, waitSec = 20): Promise<number> {
  if (polling.has(id)) return 0;
  polling.add(id);
  try {
    const c = await getCollections();
    const conn = await c.chatConnectors.findOne({ _id: id });
    if (!conn?.enabled || !conn.token) return 0;
    let updates: TgUpdate[];
    try {
      updates = await call<TgUpdate[]>(conn, 'getUpdates', { offset: conn.lastUpdateId + 1, timeout: waitSec, allowed_updates: ['message'] }, (waitSec + 15) * 1000);
      if (conn.status && !conn.status.ok) await c.chatConnectors.updateOne({ _id: id }, { $set: { status: { ...conn.status, ok: true, message: 'Đang nhận tin', checkedAt: now() } } });
    } catch (err) {
      await c.chatConnectors.updateOne({ _id: id }, { $set: { status: { ok: false, message: err instanceof Error ? err.message : String(err), checkedAt: now() } } });
      return 0;
    }
    for (const u of updates) {
      await c.chatConnectors.updateOne({ _id: id }, { $max: { lastUpdateId: u.update_id } });
      if (u.message) await handleIncoming(conn, u.message).catch((err) => console.error('[jvcompany] Telegram xử lý tin lỗi:', err));
    }
    return updates.length;
  } finally {
    polling.delete(id);
  }
}

function chatTitle(m: NonNullable<TgUpdate['message']>): string {
  const ch = m.chat;
  return ch.title || [ch.first_name, ch.last_name].filter(Boolean).join(' ') || (ch.username ? `@${ch.username}` : String(ch.id));
}

async function handleIncoming(conn: ChatConnector, m: NonNullable<TgUpdate['message']>): Promise<void> {
  const c = await getCollections();
  const chatId = String(m.chat.id);
  const title = chatTitle(m);
  const ts = now();
  let binding = await c.chatBindings.findOne({ connectorId: conn._id, chatId });
  if (!binding) {
    binding = {
      _id: newId(),
      connectorId: conn._id,
      chatId,
      chatTitle: title,
      status: conn.requirePairing ? 'pending' : 'active',
      code: String(crypto.randomInt(100000, 999999)),
      projectId: conn.defaultProjectId,
      lastMessageAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    await c.chatBindings.insertOne(binding);
    await emit('connector.updated', null, { binding: binding._id });
    await emit('inbox.updated', null, {});
    if (binding.status === 'pending') {
      await logActivity({ actorType: 'system', action: 'connector.chat_requested', entityType: 'connector', entityId: conn._id, summary: `Telegram "${title}" xin kết nối (mã ${binding.code})` });
      await sendText(conn, chatId, `👋 Xin chào! Cuộc trò chuyện này cần chủ văn phòng duyệt trước.\nMã ghép nối: ${binding.code}\nChủ văn phòng duyệt trong Hộp thư của JVCompany.`);
      return;
    }
  }
  await c.chatBindings.updateOne({ _id: binding._id }, { $set: { lastMessageAt: ts, chatTitle: title } });
  if (binding.status === 'blocked') return;
  if (binding.status === 'pending') {
    await sendText(conn, chatId, `⏳ Đang chờ chủ văn phòng duyệt (mã ${binding.code}).`);
    return;
  }

  const text = (m.text ?? m.caption ?? '').trim();
  if (!text) {
    await sendText(conn, chatId, 'Hiện chỉ nhận tin nhắn chữ. Hãy mô tả yêu cầu bằng chữ.');
    return;
  }
  const sender = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || title;
  if (text.startsWith('/')) {
    await handleCommand(conn, binding, text);
    return;
  }
  // Agent đang hỏi trong dự án này → tin nhắn là câu trả lời (số = chọn lựa chọn)
  if (binding.projectId) {
    const asking = await c.tasks.find({ projectId: binding.projectId, status: 'waiting_human', question: { $ne: null } }).sort({ updatedAt: -1 }).limit(1).toArray();
    const q = asking[0]?.question;
    if (asking[0] && q) {
      const n = /^\d+$/.test(text) ? Number(text) : 0;
      const choices = q.options.filter((o) => !o.freeText);
      const answer = n >= 1 && n <= choices.length ? choices[n - 1].label : text;
      await answerTaskQuestion(asking[0]._id, answer);
      wakeWorker();
      await sendText(conn, chatId, `✅ Đã chuyển câu trả lời "${answer}".`);
      return;
    }
  }
  try {
    const r = await handleUserChat({ content: text, projectId: binding.projectId, authorName: `${sender} (Telegram)` });
    if (r.projectId !== binding.projectId) await c.chatBindings.updateOne({ _id: binding._id }, { $set: { projectId: r.projectId, updatedAt: now() } });
    const project = await c.projects.findOne({ _id: r.projectId }, { projection: { name: 1 } });
    await sendText(conn, chatId, r.created ? `📥 Đã nhận yêu cầu – tạo dự án "${project?.name}"${r.floorNumber ? ` ở tầng ${r.floorNumber}` : ' (đang chờ tầng trống)'}. Giám đốc sẽ trả lời tại đây.` : `📨 Đã chuyển cho ${r.to === 'director' ? 'giám đốc' : r.to} – dự án "${project?.name}".`);
  } catch (err) {
    await sendText(conn, chatId, `⚠️ ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleCommand(conn: ChatConnector, binding: ChatBinding, text: string): Promise<void> {
  const c = await getCollections();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '');
  const arg = rest.join(' ').trim();
  const recent = await c.projects.find({ internal: { $ne: true }, status: { $ne: 'cancelled' } }, { projection: { name: 1, status: 1 } }).sort({ updatedAt: -1 }).limit(10).toArray();
  switch (cmd) {
    case '/start':
    case '/help':
    case '/trogiup':
      await sendText(conn, binding.chatId, 'Nhắn yêu cầu để giao việc cho giám đốc.\n/duan – xem & chọn dự án (vd /duan 2)\n/moi – tin tiếp theo là một yêu cầu (dự án) mới\n/trangthai – tiến độ dự án đang chọn');
      return;
    case '/duan': {
      if (!arg) {
        const cur = binding.projectId;
        await sendText(conn, binding.chatId, recent.length ? `Dự án gần đây:\n${recent.map((p, i) => `${i + 1}. ${p.name}${p._id === cur ? '  ← đang chọn' : ''}`).join('\n')}\n\nChọn: /duan <số>` : 'Chưa có dự án nào. Nhắn yêu cầu để tạo dự án mới.');
        return;
      }
      const n = Number(arg);
      const p = n >= 1 && n <= recent.length ? recent[n - 1] : recent.find((x) => x.name.toLowerCase().includes(arg.toLowerCase()));
      if (!p) {
        await sendText(conn, binding.chatId, 'Không tìm thấy dự án. Gõ /duan để xem danh sách.');
        return;
      }
      await c.chatBindings.updateOne({ _id: binding._id }, { $set: { projectId: p._id, updatedAt: now() } });
      await sendText(conn, binding.chatId, `📁 Đang nhắn trong dự án "${p.name}".`);
      return;
    }
    case '/moi':
      await c.chatBindings.updateOne({ _id: binding._id }, { $set: { projectId: null, updatedAt: now() } });
      await sendText(conn, binding.chatId, '🆕 Tin nhắn tiếp theo sẽ thành một yêu cầu (dự án) mới.');
      return;
    case '/trangthai': {
      if (!binding.projectId) {
        await sendText(conn, binding.chatId, 'Chưa chọn dự án. Gõ /duan.');
        return;
      }
      const p = await c.projects.findOne({ _id: binding.projectId });
      const tasks = await c.tasks.find({ projectId: binding.projectId }, { projection: { status: 1 } }).toArray();
      const count = (s: string[]) => tasks.filter((t) => s.includes(t.status)).length;
      await sendText(conn, binding.chatId, `📊 ${p?.name ?? 'Dự án'} – ${p?.status ?? '?'}\nĐang làm: ${count(['running'])} · chờ: ${count(['queued', 'waiting_children', 'waiting_deps', 'waiting_limit'])} · chờ bạn: ${count(['waiting_human', 'waiting_approval', 'in_review'])} · xong: ${count(['done'])} · lỗi: ${count(['failed'])}`);
      return;
    }
    default:
      await sendText(conn, binding.chatId, 'Lệnh không rõ. Gõ /help.');
  }
}

// ---------------- Gửi tin của agent về Telegram ----------------

/** Tin nhắn có nên gửi ra kênh chat không (theo chế độ của kênh). */
function shouldForward(m: Message, mode: ChatConnector['forward'], isSubtask: boolean): boolean {
  const fromOffice = m.author.type === 'agent' || (m.author.type === 'system' && m.author.role === 'ceo');
  if (!fromOffice) return mode === 'all' && m.kind === 'error';
  if (m.kind === 'chat') return true;
  // Báo cáo của việc con (giao xuống) chỉ gửi ở chế độ "tất cả"
  if (m.kind === 'report') return mode === 'all' || !isSubtask;
  return mode === 'all' && (m.kind === 'delegation' || m.kind === 'error');
}

export async function forwardMessage(messageId: string): Promise<number> {
  const c = await getCollections();
  const m = await c.messages.findOne({ _id: messageId });
  if (!m) return 0;
  const bindings = await c.chatBindings.find({ projectId: m.projectId, status: 'active' }).toArray();
  if (!bindings.length) return 0;
  const task = m.taskId ? await c.tasks.findOne({ _id: m.taskId }, { projection: { parentId: 1 } }) : null;
  let sent = 0;
  for (const b of bindings) {
    const conn = await c.chatConnectors.findOne({ _id: b.connectorId });
    if (!conn?.enabled || !conn.token) continue;
    if (!shouldForward(m, conn.forward, Boolean(task?.parentId))) continue;
    const who = m.author.name ?? 'Văn phòng';
    const q = (m.meta as { question?: { prompt: string; options: { label: string; freeText?: boolean }[] } } | undefined)?.question;
    const options = q ? `\n\n${q.options.filter((o) => !o.freeText).map((o, i) => `${i + 1}. ${o.label}`).join('\n')}\n(Trả lời bằng số hoặc nhập câu trả lời)` : '';
    try {
      await sendText(conn, b.chatId, `${who}:\n${m.content}${options}`);
      sent++;
    } catch (err) {
      console.error('[jvcompany] Gửi Telegram lỗi:', err);
    }
  }
  return sent;
}

// ---------------- Vòng chạy nền ----------------

const loop = globalThis as unknown as { __vpTgLoop?: { started: boolean } };

/**
 * Chạy trong worker: long-poll các kênh đang bật; nghe tin nhắn mới của agent để gửi về Telegram.
 * `forEachCompany` lặp qua các công ty (mỗi công ty một cơ sở dữ liệu) và đặt ngữ cảnh công ty cho hàm bên trong.
 */
export function startChatConnectors(forEachCompany: (fn: () => Promise<void>) => Promise<void>, runIn: (companyId: string, fn: () => Promise<void>) => Promise<void>): void {
  const state = (loop.__vpTgLoop ??= { started: false });
  if (state.started) return;
  state.started = true;
  const tick = () =>
    forEachCompany(async () => {
      const conns = await listConnectors();
      for (const conn of conns) if (conn.enabled && conn.token) void pollConnector(conn._id).catch(() => undefined);
    }).catch(() => undefined);
  setInterval(tick, 3_000);
  void tick();
  bus.on('event', (ev: AppEvent) => {
    if (ev.type !== 'message.created' || !ev.projectId || !ev.data?.id) return;
    void runIn(ev.companyId ?? 'main', async () => {
      await forwardMessage(String(ev.data!.id));
    }).catch(() => undefined);
  });
}
