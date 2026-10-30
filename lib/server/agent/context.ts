// Ngữ cảnh chạy một nhiệm vụ của agent.
import type {
  ArtifactType,
  ChatQuestion,
  Goal,
  WorkProduct,
  Department,
  MessageKind,
  PermissionLevel,
  Project,
  Settings,
  Task,
  TaskDelegation,
  Workflow,
} from '../../types';
import type { AgentDocReply, AgentDocWrite } from '../documents';
import type { ApiMcpRun } from '../connections';

export interface SubmittedResult {
  summary: string;
  details?: string;
  decision?: 'approve' | 'reject' | null;
}

export interface AgentContext {
  project: Project;
  task: Task;
  department: Department;
  departments: Department[];
  workflow: Workflow;
  settings: Settings;
  /** Thư mục làm việc (thư mục dự án hoặc workspace riêng). */
  root: string;
  hasRealPath: boolean;
  permission: PermissionLevel;
  signal: AbortSignal;
  allowDelegation: boolean;
  /** Giới hạn số lượt riêng cho nhiệm vụ này (vd lượt phân việc của giám đốc); mặc định theo phòng ban. */
  maxTurns?: number;
  delegations: TaskDelegation[];
  artifacts: { title: string; type: ArtifactType; content: string }[];
  submitted: SubmittedResult | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; cachedInputTokens?: number };
  /** Cách tính phí của lượt chạy (API key = tính tiền thật; gói đăng ký = đã gồm trong gói). */
  billing?: { providerType: string; model: string; billingType: 'api' | 'subscription' | 'unknown' };
  /** Thư mục thêm cho agent đọc (vd gói kỹ năng). */
  extraDirs: string[];
  /** Kết quả mở rộng ghi qua công cụ (API) – gộp vào outcome khi xong. */
  extras: OutcomeExtras;
  /** Công ty, mục tiêu, cấp trên, kỹ năng. */
  company?: CompanyContext;
  /** Biến môi trường riêng của phòng (đã giải bí mật). */
  env?: Record<string, string>;
  /** Giá trị bí mật để che trong nhật ký. */
  secretValues?: string[];
  /** Tham số thêm cho Claude Code: --mcp-config, --settings (hook), --allowedTools/--disallowedTools của kết nối dịch vụ. */
  mcpArgs?: string[];
  /** CLI có hook xin phép (thao tác vượt quyền tạo thẻ phê duyệt thay vì bị chặn ngay). */
  approvalHooks?: boolean;
  /** Kết nối API: thao tác của các kết nối dịch vụ (MCP) thành công cụ của agent. */
  mcp?: ApiMcpRun | null;
  log: (kind: MessageKind, content: string, meta?: Record<string, unknown>) => Promise<void>;
  setLive: (text: string | null) => void;
}

/** Phần kết quả mở rộng (theo Paperclip): sản phẩm công việc, câu hỏi cho chủ công ty, tuyển người, xin ý kiến. */
export interface OutcomeExtras {
  products: Omit<WorkProduct, 'createdAt'>[];
  question: ChatQuestion | null;
  hires: { name: string; title: string; role: string; description: string; reportsTo?: string; responsibilities?: string[] }[];
  requests: { title: string; detail: string }[];
  /** Tài liệu của nhiệm vụ agent tạo / cập nhật (toàn văn Markdown). */
  documents: AgentDocWrite[];
  /** Trả lời các luồng bình luận trên tài liệu. */
  docReplies: AgentDocReply[];
}

export function emptyExtras(): OutcomeExtras {
  return { products: [], question: null, hires: [], requests: [], documents: [], docReplies: [] };
}

/** Bối cảnh công ty đưa vào prompt: sứ mệnh, chuỗi mục tiêu, chuỗi cấp trên, kỹ năng. */
export interface CompanyContext {
  name: string;
  mission: string;
  goals: Goal[];
  chain: { id: string; name: string; title: string }[];
  skills: { key: string; name: string; description: string; path: string }[];
}

export interface AgentOutcome {
  status: 'done' | 'waiting_human';
  text: string;
  summary: string;
  decision?: 'approve' | 'reject' | null;
  delegations: TaskDelegation[];
  artifacts: { title: string; type: ArtifactType; content: string }[];
  sessionId?: string | null;
  extras?: OutcomeExtras;
}
