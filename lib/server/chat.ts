// Tin nhắn của chủ công ty gửi vào văn phòng (trang Toà nhà, Telegram…): tạo dự án mới hoặc nhắn tiếp dự án đang có.
import type { Attachment } from '../types';
import { DIRECTOR_WORKFLOW_ID } from '../catalog';
import { createProject, getDepartment, getProject, getSettings, listDepartments, postMessage, updateProject } from './repo';
import { canContinueWithDirector, chatWithDepartment, continueWithDirector, startProject } from './agent/orchestrator';
import { inspectProject } from './fsbrowse';
import { getCollections } from './db';
import { LocalizedError } from './http';
import { tl } from '../i18n/server';
import type { Locale } from '../i18n/locales';

/** Tên dự án ngắn gọn lấy từ dòng đầu yêu cầu. */
export function titleOf(text: string): string {
  const line = text.replace(/[#*_`>]/g, '').split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

export interface UserChatInput {
  content: string;
  projectId?: string | null;
  departmentId?: string | null;
  path?: string | null;
  attachments?: Attachment[];
  /** Tên hiển thị của người gửi (vd "Bạn", "An (Telegram)"). */
  authorName?: string;
  /** Yêu cầu mới: ưu tiên giao cho tầng này nếu đang trống (tầng bạn đang xem trong cảnh 3D). */
  floorNumber?: number | null;
  /** Ngôn ngữ giao diện của người gửi → agent trả lời bằng ngôn ngữ này. Thiếu (vd Telegram) → giữ như cũ. */
  language?: Locale | null;
}

export interface UserChatResult {
  projectId: string;
  floorNumber: number | null;
  created: boolean;
  /** Phòng nhận tin. */
  to: string;
}

async function floorNumberOf(projectId: string): Promise<number | null> {
  const started = await getProject(projectId);
  if (!started?.floorId) return null;
  const c = await getCollections();
  return (await c.floors.findOne({ _id: started.floorId }))?.number ?? null;
}

/**
 * - Chưa có cuộc trò chuyện: CEO tổng nhận yêu cầu, tạo dự án (giao cho giám đốc), tìm tầng trống và giao ngay.
 * - Đã có: nhắn tiếp cho giám đốc tầng (hoặc phòng được chọn); dự án đã xong/dừng thì mở lại trên một tầng.
 */
export async function handleUserChat(input: UserChatInput): Promise<UserChatResult> {
  const content = input.content.trim();
  const files = input.attachments ?? [];
  const author = { type: 'user' as const, name: input.authorName ?? 'Bạn' };
  const language = input.language ?? null;
  if (!content && !files.length) throw new LocalizedError('Nội dung trống');

  if (input.projectId) {
    const project = await getProject(input.projectId);
    if (!project) throw new LocalizedError('Không tìm thấy cuộc trò chuyện', undefined, 404);
    if (language && project.language !== language) await updateProject(project._id, { language });
    const depts = await listDepartments();
    const to = (input.departmentId && (await getDepartment(input.departmentId))?._id) || depts.find((d) => d._id === 'director' && d.enabled)?._id || depts.find((d) => d.enabled)?._id;
    if (!to) throw new LocalizedError('Chưa có phòng ban nào đang hoạt động');
    // Dự án giao cho giám đốc chưa khởi động (vd dự án "Làm quen") → tin nhắn đầu tiên là yêu cầu, khởi động ngay.
    if (to === 'director' && project.status === 'draft' && project.workflowId === DIRECTOR_WORKFLOW_ID && !project.internal) {
      await postMessage({ projectId: project._id, taskId: null, author, to: 'director', kind: 'chat', content, meta: files.length ? { attachments: files } : undefined });
      await updateProject(project._id, {
        description: `${project.description}

# Yêu cầu của chủ công ty
${content || 'Xem ảnh đính kèm.'}`.trim(),
        ...(files.length ? { attachments: [...(project.attachments ?? []), ...files].slice(-6) } : {}),
      });
      await startProject(project._id);
      return { projectId: project._id, floorNumber: await floorNumberOf(project._id), created: false, to };
    }
    // Dự án đã xong / đã dừng → giám đốc mở lại lượt điều phối và làm tiếp theo kế hoạch cũ.
    if (to === 'director' && (await canContinueWithDirector(project))) {
      const floorNumber = await continueWithDirector(project._id, content, files, author.name);
      return { projectId: project._id, floorNumber, created: false, to };
    }
    await chatWithDepartment(project._id, to, content, files, author.name);
    return { projectId: project._id, floorNumber: null, created: false, to };
  }

  let path: string | null = input.path?.trim() || null;
  if (path) {
    const info = await inspectProject(path);
    if (!info.exists || !info.isDirectory) throw new LocalizedError('Thư mục không tồn tại: {path}', { path });
    path = info.path;
  }
  const settings = await getSettings();
  // Tên / mô tả mặc định viết theo ngôn ngữ của người gửi (đây là dữ liệu dự án, agent cũng đọc)
  const lang = language ?? settings.language ?? 'vi';
  const request = content || tl(lang, 'Xem ảnh đính kèm và xử lý theo nội dung ảnh.');
  const project = await createProject({
    name: titleOf(content) || (content ? tl(lang, 'Yêu cầu mới') : tl(lang, 'Yêu cầu kèm ảnh')),
    description: request,
    goal: '',
    path,
    autopilot: true,
    permission: settings.defaultPermission,
    workflowId: DIRECTOR_WORKFLOW_ID,
    attachments: files,
    ...(language ? { language } : {}),
  });
  await postMessage({ projectId: project._id, taskId: null, author, to: 'director', kind: 'chat', content, meta: files.length ? { attachments: files } : undefined });
  const preferred = input.floorNumber ? (await (await getCollections()).floors.findOne({ number: input.floorNumber }))?._id : undefined;
  await startProject(project._id, preferred);
  return { projectId: project._id, floorNumber: await floorNumberOf(project._id), created: true, to: 'director' };
}
