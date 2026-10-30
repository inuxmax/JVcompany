// Kiểu dữ liệu dùng chung cho cả server và client.
import type { Locale } from './i18n/locales';
import type { LocalizedText } from './i18n/format';

export type ProviderKind = 'api' | 'cli' | 'gateway' | 'manual';

export type ProviderType =
  // API key
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'ollama'
  | 'lmstudio'
  | 'openai-compatible'
  // Gói đăng ký qua ứng dụng desktop / CLI
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'cursor-agent'
  | 'copilot'
  | 'qwen-code'
  | 'opencode'
  | 'pi'
  | 'kimi'
  | 'grok'
  | 'hermes'
  | 'custom-cli'
  // Agent chạy ở máy/dịch vụ khác (gateway, webhook, đám mây)
  | 'hermes-gateway'
  | 'openclaw-gateway'
  | 'http-webhook'
  | 'cursor-cloud'
  // Gói đăng ký qua trình duyệt (chuyển tiếp thủ công)
  | 'web-manual';

export interface ProviderStatus {
  ok: boolean;
  message: string;
  /** Khoá dịch của `message` (giao diện hiện qua localizedContent); không có = lỗi thô từ CLI/API hoặc dữ liệu cũ. */
  messageI18n?: LocalizedText;
  checkedAt: string;
  version?: string;
}

/** Một mục trong "Kiểm tra môi trường" (giống Paperclip: mã, mức, nội dung, gợi ý sửa). */
export interface EnvCheck {
  code: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Khoá dịch của `message` / `hint` (sysMsg) – giao diện dịch lúc hiển thị. */
  i18n?: LocalizedText;
  detail?: string;
  hint?: string;
  hintI18n?: LocalizedText;
}

export interface EnvTestResult {
  status: 'pass' | 'warn' | 'fail';
  checks: EnvCheck[];
  testedAt: string;
  /** Lệnh để bạn tự chạy thử trong terminal khi cần gỡ lỗi. */
  command?: string;
}

/** Ô cấu hình riêng của từng loại kết nối (hiện trong hộp thoại kết nối). */
export interface AdapterField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'toggle' | 'select' | 'textarea' | 'secret';
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  default?: string | number | boolean;
}

export type ProviderAuthMode = 'subscription' | 'api_key';

export interface Provider {
  _id: string;
  name: string;
  type: ProviderType;
  kind: ProviderKind;
  enabled: boolean;
  baseUrl?: string;
  /** Chỉ tồn tại phía server. Client nhận `hasApiKey` + `apiKeyPreview`. */
  apiKey?: string;
  hasApiKey?: boolean;
  apiKeyPreview?: string;
  command?: string;
  extraArgs?: string[];
  /** Với custom-cli: cách truyền prompt. */
  promptMode?: 'stdin' | 'arg' | 'file';
  webUrl?: string;
  defaultModel?: string;
  models?: string[];
  /** CLI: dùng tài khoản đã đăng nhập trong CLI (gói đăng ký) hay API key lưu ở đây. */
  authMode?: ProviderAuthMode;
  /** Biến môi trường thêm khi chạy agent. */
  env?: Record<string, string>;
  /** Thư mục làm việc riêng (để trống = thư mục dự án). */
  cwd?: string;
  /** Giới hạn thời gian mỗi lượt chạy (giây; 0/để trống = 60 phút). */
  timeoutSec?: number;
  /** Header HTTP thêm (gateway / webhook). */
  headers?: Record<string, string>;
  /** Cấu hình riêng theo loại kết nối (xem `fields` của preset). */
  options?: Record<string, string | number | boolean>;
  /** Giá trị bí mật của các ô kiểu "secret" (chỉ tồn tại phía server). */
  secretOptions?: Record<string, string>;
  /** Client chỉ nhận tên các ô bí mật đã có giá trị. */
  secretOptionKeys?: string[];
  /** Kết quả "Kiểm tra môi trường" gần nhất. */
  envTest?: EnvTestResult;
  status?: ProviderStatus;
  /** Hết hạn mức tới thời điểm này (ISO). */
  cooldownUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * read  – chỉ đọc trong thư mục dự án
 * write – đọc/ghi trong thư mục dự án, lệnh shell cần duyệt
 * auto  – đọc/ghi + chạy lệnh trong thư mục dự án không cần hỏi
 * full  – toàn quyền máy tính (mọi thư mục, lệnh, điều khiển chuột/bàn phím)
 */
export type PermissionLevel = 'read' | 'write' | 'auto' | 'full';

export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Hạng mô hình: mỗi kết nối tự ánh xạ sang model cụ thể. */
export type ModelTier = 'top' | 'balanced' | 'fast';

export interface Department {
  _id: string;
  name: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  role: string;
  responsibilities: string[];
  capabilities: string[];
  systemPrompt: string;
  canDelegateTo: string[];
  canApprove: boolean;
  /** Kết nối AI cụ thể. null = tự chọn theo `preferredProviderTypes` rồi tới mặc định. */
  providerId: string | null;
  preferredProviderTypes: ProviderType[];
  tier: ModelTier;
  /** Model cụ thể (để trống = theo hạng `tier`). */
  model: string;
  fallbackProviderIds: string[];
  effort: Effort;
  maxPermission: PermissionLevel;
  maxTurns: number;
  enabled: boolean;
  order: number;
  position: { x: number; y: number };
  /** Cấp trên trực tiếp (sơ đồ tổ chức; null = đứng đầu). */
  reportsTo?: string | null;
  /** Trạng thái làm việc (ngoài bật/tắt): tạm dừng (vd vượt ngân sách), lỗi, nghỉ việc, chờ duyệt tuyển. */
  status?: DepartmentStatus;
  pauseReason?: string | null;
  /** Tự thức dậy định kỳ (heartbeat) để rà soát việc. */
  heartbeat?: HeartbeatConfig;
  lastHeartbeatAt?: string | null;
  /** Ngân sách mỗi tháng (USD, 0 = không giới hạn). */
  budgetMonthlyUsd?: number;
  /** Kỹ năng được gán (khoá kỹ năng). */
  skills?: string[];
  /** Biến môi trường riêng của phòng (giá trị "secret:TEN" lấy từ kho bí mật). */
  env?: Record<string, string>;
  /** Quyền đặc biệt. */
  permissions?: { canHire?: boolean };
  createdAt: string;
  updatedAt: string;
}

export type DepartmentStatus = 'active' | 'paused' | 'error' | 'terminated' | 'pending_approval';

export interface HeartbeatConfig {
  enabled: boolean;
  /** Chu kỳ (giây). */
  intervalSec: number;
  /** Bỏ qua lượt khi phòng không có việc đang mở. */
  skipWhenNoWork: boolean;
  /** Tối đa số lượt heartbeat mỗi ngày (0 = không giới hạn). */
  maxDailyRuns: number;
  /** Tối đa chi phí heartbeat mỗi ngày (USD, 0 = không giới hạn). */
  maxDailyCostUsd: number;
  /** Lời nhắc riêng khi thức dậy (để trống = rà soát việc chung). */
  instructions?: string;
}

/** Một bản ghi lịch sử cấu hình phòng ban (để khôi phục). */
export interface DepartmentRevision {
  _id: string;
  departmentId: string;
  source: 'patch' | 'rollback' | 'create';
  changedKeys: string[];
  before: Partial<Department> | null;
  after: Partial<Department>;
  rolledBackFrom?: string | null;
  by: string;
  createdAt: string;
}

export interface WorkflowPhase {
  id: string;
  name: string;
  description: string;
  lead: string;
  departments: string[];
  requiredApprovals: string[];
  outputs: string[];
  onReject?: string;
}

export interface Workflow {
  _id: string;
  name: string;
  /** Mô tả ngắn cho người dùng chọn chế độ làm việc. */
  description?: string;
  phases: WorkflowPhase[];
  updatedAt: string;
}

/** Công ty (một bản ghi "main"): tên, sứ mệnh, mã nhiệm vụ, ngân sách, quản trị. */
export interface Company {
  _id: string;
  name: string;
  /** Tên cơ sở dữ liệu riêng của công ty (công ty chính dùng CSDL gốc). */
  dbName?: string;
  mission: string;
  /** Tiền tố mã nhiệm vụ (vd "JV" → JV-12). */
  issuePrefix: string;
  issueCounter: number;
  status: 'active' | 'paused' | 'archived';
  pauseReason?: string | null;
  /** Ngân sách mỗi tháng (USD, 0 = không giới hạn). */
  budgetMonthlyUsd: number;
  /** Tuyển nhân sự mới phải được bạn duyệt. */
  requireApprovalForNewAgents: boolean;
  /** Đã hoàn tất màn hình thiết lập ban đầu. */
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GoalLevel = 'company' | 'team' | 'agent' | 'task';
export type GoalStatus = 'planned' | 'active' | 'achieved' | 'cancelled';

/** Mục tiêu (dạng cây): mục tiêu công ty → nhóm → cá nhân → nhiệm vụ. */
export interface Goal {
  _id: string;
  title: string;
  description: string;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  /** Phòng ban phụ trách. */
  ownerDepartmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Câu hỏi kèm lựa chọn trong khung chat (vd câu hỏi mở đầu khi làm quen). */
export interface ChatQuestion {
  prompt: string;
  options: { id: string; label: string; freeText?: boolean; placeholder?: string }[];
}

export type ProjectStatus = 'draft' | 'active' | 'paused' | 'completed' | 'blocked' | 'cancelled' | 'waiting_floor';
export type PhaseState = 'idle' | 'working' | 'reviewing' | 'awaiting_user' | 'done';

export interface PhaseApproval {
  decision: 'approve' | 'reject';
  notes: string;
  at: string;
  by: string;
}

export interface Project {
  _id: string;
  name: string;
  description: string;
  goal: string;
  path: string | null;
  status: ProjectStatus;
  workflowId: string;
  /** Ảnh gửi kèm yêu cầu ban đầu (chuyển cho nhiệm vụ chủ trì). */
  attachments?: Attachment[];
  currentPhase: string;
  phaseState: PhaseState;
  phaseTaskId: string | null;
  approvals: Record<string, PhaseApproval>;
  phaseAttempts: Record<string, number>;
  phaseSummaries: Record<string, string>;
  completedPhases: string[];
  autopilot: boolean;
  permission: PermissionLevel;
  blockedReason?: string | null;
  /** Tầng đang làm dự án (mỗi tầng nhận trọn một dự án). */
  floorId?: string | null;
  /** Thời điểm bắt đầu xếp hàng chờ tầng trống. */
  queuedAt?: string | null;
  /** Mục tiêu mà dự án phục vụ. */
  goalIds?: string[];
  /** Dự án "Làm quen" tạo ở màn hình thiết lập ban đầu. */
  onboarding?: boolean;
  /** Dự án nội bộ "Việc chung công ty" (heartbeat, lịch định kỳ) – không chiếm tầng. */
  internal?: boolean;
  /** Loại dự án nội bộ: việc chung (mặc định) hoặc nơi chạy bộ đánh giá agent. */
  internalKind?: 'ops' | 'evals';
  /** Yêu cầu tiếp theo bạn nhắn giám đốc sau khi dự án đã xong/dừng – giao ở lượt điều phối kế tiếp (kèm kế hoạch cũ). */
  pendingRequest?: { content: string; attachments: Attachment[] } | null;
  /** Ngôn ngữ agent trả lời (theo ngôn ngữ giao diện lúc bạn gửi yêu cầu gần nhất); thiếu → settings.language. */
  language?: Locale | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Một tầng của toà nhà = một đội làm trọn một dự án. */
export interface Floor {
  _id: string;
  number: number;
  name: string;
  enabled: boolean;
  projectId: string | null;
  assignedAt: string | null;
  updatedAt: string;
}

export interface FloorView extends Floor {
  project: Pick<Project, '_id' | 'name' | 'status' | 'currentPhase' | 'phaseState' | 'phaseTaskId' | 'updatedAt' | 'workflowId'> | null;
}

export interface QueuedProject {
  _id: string;
  name: string;
  queuedAt: string | null;
  position: number;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_children'
  | 'waiting_approval'
  | 'waiting_limit'
  | 'waiting_human'
  /** Chờ phòng trước bàn giao (chuỗi công việc). */
  | 'waiting_deps'
  /** Làm xong, đang chờ người duyệt (chính sách duyệt nhiều bước). */
  | 'in_review'
  | 'done'
  | 'failed'
  | 'cancelled';

export type TaskKind = 'phase' | 'delegated' | 'review' | 'chat' | 'heartbeat' | 'routine';

/** Ảnh đính kèm (dán/kéo-thả trong hội thoại). */
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface TaskDelegation {
  to: string;
  title: string;
  instructions: string;
  priority?: TaskPriority;
  /** Quyền hạn người giao cấp cho việc này (không vượt quyền của dự án và phòng nhận). */
  permission?: PermissionLevel;
  /** Mã bước trong kế hoạch (vd "B1") để các bước sau tham chiếu. */
  step?: string;
  /** Làm sau các bước này (nhận bàn giao từ chúng). */
  after?: string[];
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Sản phẩm của nhiệm vụ: link xem trước, PR, nhánh, commit, tệp, tài liệu. */
export interface WorkProduct {
  type: 'preview_url' | 'pull_request' | 'branch' | 'commit' | 'file' | 'document' | 'other';
  title: string;
  url?: string;
  status?: 'draft' | 'ready_for_review' | 'approved' | 'changes_requested' | 'merged' | 'closed';
  createdAt: string;
}

/** Người duyệt trong chính sách duyệt nhiều bước. */
export interface ReviewStage {
  id: string;
  type: 'review' | 'approval';
  /** "user" = bạn duyệt; còn lại là id phòng ban. */
  reviewer: string;
  status: 'waiting' | 'pending' | 'approved' | 'changes_requested';
  note?: string;
  decidedAt?: string | null;
}

export interface Task {
  _id: string;
  projectId: string;
  parentId: string | null;
  depth: number;
  kind: TaskKind;
  title: string;
  instructions: string;
  departmentId: string;
  assignedBy: string;
  phase: string;
  status: TaskStatus;
  priority: TaskPriority;
  waitForChildren: boolean;
  /** Việc ngoài quy trình (chat với phòng ban) – chạy cả khi dự án chưa bắt đầu/tạm dừng. */
  adhoc?: boolean;
  /** Quyền hạn được cấp riêng cho nhiệm vụ (khi được giao xuống); null = theo dự án/phòng. */
  permission?: PermissionLevel | null;
  /** Ảnh chủ dự án gửi kèm (được chuyển xuống cả các việc giao tiếp). */
  attachments?: Attachment[];
  /** Việc phải xong trước (phòng trước bàn giao) thì việc này mới chạy. */
  dependsOn?: string[];
  /** Mã nhiệm vụ dễ đọc (vd JV-12). */
  identifier?: string;
  /** Mục tiêu nhiệm vụ phục vụ (để trống = theo dự án / công ty). */
  goalId?: string | null;
  labels?: string[];
  workProducts?: WorkProduct[];
  /** Chính sách duyệt nhiều bước: làm xong → chờ lần lượt từng người duyệt. */
  reviewStages?: ReviewStage[];
  /** Lịch định kỳ sinh ra việc này. */
  routineId?: string | null;
  /** Lý do lượt chạy kế tiếp (giao việc, bình luận, chạy lại…). */
  wakeReason?: string | null;
  /** Lần ra chữ / thao tác gần nhất. */
  lastOutputAt?: string | null;
  /** Agent đang hỏi bạn (chờ câu trả lời mới chạy tiếp). */
  question?: ChatQuestion | null;
  /** Việc thuộc một lượt chạy bộ đánh giá (không giao việc, không hỏi, không đọc hội thoại cũ). */
  evalRunId?: string | null;
  /** Chạy bằng kết nối / model chỉ định thay vì cấu hình của phòng (so sánh trong bộ đánh giá). */
  providerOverride?: { providerId: string; model?: string } | null;
  round: number;
  result?: string;
  output?: string;
  decision?: 'approve' | 'reject' | null;
  error?: string | null;
  attempts: number;
  retryAt?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  model?: string | null;
  sessionId?: string | null;
  /** Worker (tiến trình) đang giữ nhiệm vụ. */
  workerId?: string | null;
  manualPrompt?: string | null;
  autoApprove?: boolean;
  liveText?: string | null;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number; cachedInputTokens?: number };
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export type MessageKind =
  | 'chat'
  | 'thought'
  | 'tool'
  | 'delegation'
  | 'report'
  | 'system'
  | 'error'
  | 'approval';

export interface MessageAuthor {
  type: 'user' | 'agent' | 'system';
  departmentId?: string;
  name?: string;
  /** "ceo" = CEO tổng (nhận yêu cầu, giao tầng). */
  role?: 'ceo';
}

export interface Message {
  _id: string;
  projectId: string;
  taskId?: string | null;
  author: MessageAuthor;
  to?: string | null;
  kind: MessageKind;
  content: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type ApprovalType = 'shell' | 'write' | 'read' | 'computer' | 'hire_agent' | 'budget_override' | 'board_request' | 'mcp';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface Approval {
  _id: string;
  projectId: string;
  taskId: string;
  departmentId: string;
  type: ApprovalType;
  title: string;
  detail: string;
  /** Khoá dịch của title/detail (tạo bằng sysMsg) – giao diện hiện theo ngôn ngữ người xem; thiếu → hiện nguyên văn. */
  titleI18n?: LocalizedText | null;
  detailI18n?: LocalizedText | null;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  scope?: 'once' | 'task';
  note?: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export type ArtifactType = 'document' | 'plan' | 'design' | 'code' | 'report' | 'other';

export interface Artifact {
  _id: string;
  projectId: string;
  taskId: string | null;
  departmentId: string;
  title: string;
  type: ArtifactType;
  content: string;
  phase?: string;
  createdAt: string;
}

export interface AppEvent {
  _id: string;
  seq: number;
  type: string;
  /** Công ty phát sinh sự kiện (mỗi công ty một toà nhà). */
  companyId?: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
  createdAt: string;
  /** Dùng cho TTL index (chỉ phía server). */
  createdAtDate?: Date;
}

export interface Settings {
  _id: 'global';
  computerControl: boolean;
  defaultPermission: PermissionLevel;
  defaultProviderId: string | null;
  concurrency: number;
  perProjectConcurrency: number;
  maxTasksPerProject: number;
  maxDepth: number;
  maxRounds: number;
  approvalTimeoutMinutes: number;
  retry: { baseMinutes: number; maxMinutes: number; maxAttempts: number };
  workerEnabled: boolean;
  setupDone: boolean;
  /** Ngôn ngữ giao diện chọn gần nhất – agent trả lời bằng ngôn ngữ này khi dự án không ghi riêng. */
  language?: Locale;
  /** Bản đồ mã (đồ thị tri thức kiểu Graphify) cho agent – mặc định bật; false = tắt. */
  codeGraph?: boolean;
  updatedAt: string;
}

export interface FsEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  modifiedAt?: string;
}

export interface FsListing {
  path: string | null;
  parent: string | null;
  entries: FsEntry[];
  roots: { name: string; path: string }[];
  sep: string;
  platform: string;
}

export interface ProjectInspection {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  name: string;
  description: string;
  stack: string[];
  gitBranch: string | null;
  fileCount: number;
  readme: string | null;
}

export interface DashboardStats {
  projects: { total: number; active: number; completed: number; paused: number; blocked: number };
  tasks: { running: number; queued: number; waiting: number; done: number; failed: number };
  approvalsPending: number;
  providers: { total: number; ready: number };
  departments: { total: number; busy: number };
}

export interface SystemHealth {
  db: { ok: boolean; message: string; uri: string; name: string };
  worker: { running: boolean; enabled: boolean; activeTasks: number; startedAt: string | null };
  platform: string;
  version: string;
}

// ---------------- Lượt chạy, chi phí, ngân sách ----------------

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'limited' | 'waiting';

/** Một lần agent chạy (heartbeat run của Paperclip). */
export interface Run {
  _id: string;
  taskId: string;
  projectId: string;
  departmentId: string;
  providerId: string | null;
  providerName: string | null;
  providerType: string | null;
  model: string | null;
  attempt: number;
  /** Vì sao agent thức dậy: giao việc, làm tiếp, chạy lại, heartbeat, lịch định kỳ, bình luận… */
  wakeReason: string;
  status: RunStatus;
  billingType: 'api' | 'subscription' | 'unknown';
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsd: number };
  sessionBefore: string | null;
  sessionAfter: string | null;
  error?: string | null;
  excerpt?: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Lần ra chữ / thao tác gần nhất (để canh chừng lượt chạy im lặng). */
  lastOutputAt?: string | null;
  /** Quyết định của bạn với cảnh báo im lặng. */
  watchdog?: { decision: 'continue' | 'snooze' | 'dismissed'; until?: string | null; at: string } | null;
}

// ---------------- Hạn mức & mức dùng của kết nối AI ----------------

export interface QuotaWindow {
  label: string;
  /** % đã dùng (0–100), null nếu không rõ. */
  usedPercent: number | null;
  resetsAt: string | null;
}

export interface ProviderQuota {
  /** Nguồn số liệu (để hiện cho người dùng). */
  source: string;
  windows: QuotaWindow[];
  balance?: { label: string; remaining: number | null; total?: number | null; currency: string; unlimited?: boolean } | null;
  note?: string;
  error?: string;
  /** Gói đăng ký (Claude Pro/Max, ChatGPT…): % hạn mức 5 giờ / 7 ngày chỉ đọc được từ phiên đăng nhập CLI trên máy – chưa bật. */
  needsLocalLogin?: boolean;
  checkedAt: string;
}

/** Token & chi phí của một khoảng thời gian. */
export interface UsageBucket {
  runs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Mức dùng của một kết nối AI (tính từ lượt chạy + nhiệm vụ). */
export interface ProviderUsage {
  h5: UsageBucket;
  today: UsageBucket;
  d7: UsageBucket;
  d30: UsageBucket;
  all: UsageBucket;
  /** 14 ngày gần nhất (theo giờ máy chủ). */
  daily: { date: string; tokens: number; costUsd: number }[];
  /** 24 giờ gần nhất, mỗi giờ một cột (ISO đầu giờ). */
  hourly: { hour: string; tokens: number; costUsd: number }[];
  /** Model dùng nhiều nhất 30 ngày qua. */
  models: { model: string; tokens: number; costUsd: number; runs: number }[];
  lastRunAt: string | null;
  /** Lần chạm hạn mức gần nhất (lỗi của nhà cung cấp, kèm số dư nếu lỗi có ghi). */
  lastLimit: { message: string; at: string; remainingUsd: number | null; neededUsd: number | null } | null;
  /** Một phần chi phí là ước tính theo bảng giá (API không trả về giá). */
  costEstimated: boolean;
}

export interface CostEvent {
  _id: string;
  runId: string | null;
  taskId: string | null;
  projectId: string | null;
  departmentId: string | null;
  providerType: string | null;
  providerName: string | null;
  model: string | null;
  billingType: 'api' | 'subscription' | 'unknown';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  occurredAt: string;
}

export type BudgetScope = 'company' | 'department' | 'project';

export interface BudgetPolicy {
  _id: string;
  scopeType: BudgetScope;
  /** id phòng / dự án; "main" với công ty. */
  scopeId: string;
  windowKind: 'month' | 'lifetime';
  amountUsd: number;
  /** Cảnh báo khi đạt % này. */
  warnPercent: number;
  /** Chạm 100% thì tự tạm dừng. */
  hardStop: boolean;
  /** Chỉ tính chi phí tính tiền theo API (bỏ qua chi phí ước tính của gói đăng ký). */
  apiOnly: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetIncident {
  _id: string;
  policyId: string;
  scopeType: BudgetScope;
  scopeId: string;
  windowStart: string;
  threshold: 'soft' | 'hard';
  amountLimit: number;
  amountObserved: number;
  status: 'open' | 'resolved' | 'dismissed';
  approvalId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

// ---------------- Lịch định kỳ ----------------

export interface RoutineVariable {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'date';
  default?: string;
  options?: string[];
}

export interface RoutineTrigger {
  id: string;
  kind: 'schedule' | 'webhook' | 'api';
  enabled: boolean;
  /** Lịch cron 5 trường (phút giờ ngày tháng thứ). */
  cron?: string;
  timezone?: string;
  nextRunAt?: string | null;
  lastFiredAt?: string | null;
  /** Webhook: mã công khai trong URL. */
  publicId?: string;
  /** Webhook: cách xác thực. */
  signingMode?: 'bearer' | 'hmac_sha256' | 'none';
}

export interface Routine {
  _id: string;
  title: string;
  /** Hướng dẫn cho mỗi lượt (có thể dùng {{tên_biến}}, {{date}}, {{timestamp}}). */
  instructions: string;
  departmentId: string;
  projectId: string | null;
  priority: TaskPriority;
  status: 'active' | 'paused' | 'archived';
  /** Lượt trước còn chạy: gộp vào / bỏ qua / luôn tạo mới. */
  concurrency: 'coalesce_if_active' | 'skip_if_active' | 'always_enqueue';
  /** Lượt bị lỡ (máy tắt): bỏ qua / chạy bù (tối đa 25). */
  catchUp: 'skip_missed' | 'enqueue_missed';
  variables: RoutineVariable[];
  triggers: RoutineTrigger[];
  /** Mã bí mật của webhook (chỉ server). */
  webhookSecret?: string;
  lastTriggeredAt?: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRun {
  _id: string;
  routineId: string;
  source: 'schedule' | 'manual' | 'api' | 'webhook';
  status: 'received' | 'coalesced' | 'skipped' | 'task_created' | 'completed' | 'failed';
  taskId: string | null;
  payload?: Record<string, unknown> | null;
  reason?: string | null;
  createdAt: string;
}

// ---------------- Nhật ký hoạt động ----------------

export interface ActivityEntry {
  _id: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  actorName?: string | null;
  /** Dạng "<đối tượng>.<hành động>", vd project.created, task.cancelled. */
  action: string;
  entityType: string;
  entityId: string | null;
  projectId?: string | null;
  summary: string;
  /** Khoá dịch của summary (ghi bằng sysMsg) – giao diện hiện theo ngôn ngữ người xem. */
  summaryI18n?: LocalizedText | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

// ---------------- Kho bí mật ----------------

export interface SecretVersion {
  version: number;
  /** Mã hoá AES-256-GCM (base64): iv.tag.ciphertext */
  cipher: string;
  status: 'current' | 'previous' | 'disabled';
  createdAt: string;
}

export interface Secret {
  _id: string;
  /** Tên biến (vd GITHUB_TOKEN) – dùng "secret:GITHUB_TOKEN" trong biến môi trường. */
  key: string;
  description: string;
  status: 'active' | 'disabled';
  versions?: SecretVersion[];
  currentVersion: number;
  /** Bốn ký tự cuối để nhận biết (client không bao giờ nhận giá trị). */
  preview?: string;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Tài liệu nhiệm vụ (có phiên bản + bình luận theo đoạn) ----------------

/** Người viết / sửa / bình luận tài liệu. */
export interface DocAuthor {
  type: 'user' | 'agent' | 'system';
  /** id phòng ban (agent) hoặc id tài khoản (người dùng). */
  id?: string | null;
  name: string;
}

/** Tài liệu gắn với một nhiệm vụ (kế hoạch, đặc tả, báo cáo…) – mỗi khoá một tài liệu. */
export interface IssueDocument {
  _id: string;
  taskId: string;
  projectId: string;
  /** Khoá trong nhiệm vụ (chữ thường, gạch ngang), vd "plan", "spec". */
  key: string;
  title: string;
  format: 'markdown';
  body: string;
  /** Số phiên bản hiện tại (1, 2, 3…). */
  revision: number;
  createdBy: DocAuthor;
  updatedBy: DocAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRevision {
  _id: string;
  documentId: string;
  taskId: string;
  projectId: string;
  revision: number;
  title: string;
  body: string;
  changeSummary: string;
  author: DocAuthor;
  /** Bản này được khôi phục từ phiên bản nào. */
  restoredFrom?: number | null;
  createdAt: string;
}

/** Vị trí đoạn được bình luận: đoạn trích + vài ký tự trước/sau để tìm lại khi tài liệu thay đổi. */
export interface DocAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface DocComment {
  id: string;
  author: DocAuthor;
  body: string;
  createdAt: string;
}

/** Luồng bình luận trên một đoạn của tài liệu (hoặc cả tài liệu khi không có đoạn trích). */
export interface DocumentThread {
  _id: string;
  documentId: string;
  taskId: string;
  projectId: string;
  /** Phiên bản lúc mở luồng. */
  revision: number;
  anchor: DocAnchor | null;
  status: 'open' | 'resolved';
  comments: DocComment[];
  resolvedBy?: DocAuthor | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Hộp thư (mọi thứ đang chờ bạn) ----------------

export type InboxKind = 'approval' | 'question' | 'review' | 'manual' | 'phase' | 'budget' | 'silent_run' | 'failed_task' | 'doc_reply' | 'chat_pairing';

export interface InboxItem {
  /** Khoá ổn định, vd "approval:<id>", "question:<taskId>". */
  id: string;
  kind: InboxKind;
  title: string;
  detail: string;
  severity: 'info' | 'warn' | 'critical';
  /** Cần bạn quyết định (không ẩn được cho tới khi xử lý). */
  actionable: boolean;
  createdAt: string;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  departmentId?: string | null;
  href?: string | null;
  read: boolean;
  /** Dữ liệu riêng theo loại (phê duyệt, câu hỏi, lượt chạy…). */
  data?: Record<string, unknown>;
}

/** Trạng thái đọc / ẩn của từng mục hộp thư. */
export interface InboxState {
  _id: string;
  readAt?: string | null;
  dismissedAt?: string | null;
}

// ---------------- Kết nối dịch vụ (MCP) ----------------

/** Chính sách cho một thao tác của dịch vụ: tự cho phép / hỏi bạn trước / tắt hẳn. */
export type McpPolicy = 'allow' | 'ask' | 'off';

export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema tham số (để agent dùng qua API). */
  inputSchema?: Record<string, unknown>;
  /** Thao tác chỉ đọc (theo gợi ý của máy chủ MCP hoặc đoán theo tên). */
  readOnly?: boolean;
  policy: McpPolicy;
}

export type McpKind = 'github' | 'notion' | 'custom';

/** Một kết nối dịch vụ cho agent dùng (máy chủ MCP qua stdio hoặc HTTP). */
export interface McpConnection {
  _id: string;
  name: string;
  /** Tên máy chủ trong cấu hình (chữ thường, số, gạch ngang) – thao tác có tên mcp__<key>__<thao tác>. */
  key: string;
  kind: McpKind;
  transport: 'stdio' | 'http';
  enabled: boolean;
  command?: string;
  args?: string[];
  /** Biến môi trường (giá trị "secret:KHOA" lấy từ kho bí mật). */
  env?: Record<string, string>;
  url?: string;
  /** Header HTTP (có thể chứa "secret:KHOA", vd "Bearer secret:GITHUB_TOKEN"). */
  headers?: Record<string, string>;
  /** Chính sách cho thao tác chưa có trong danh sách. */
  defaultPolicy: McpPolicy;
  tools: McpTool[];
  /** Phòng được dùng (trống = mọi phòng). */
  departments: string[];
  status?: { ok: boolean; message: string; checkedAt: string; serverName?: string };
  /** Thêm từ danh bạ kết nối (mã mục trong danh bạ). */
  directoryId?: string | null;
  /** Thêm bởi plugin nào (gỡ plugin thì gỡ kết nối). */
  pluginId?: string | null;
  /** Đăng nhập OAuth (MCP từ xa): token lưu trong kho bí mật, tự làm mới. */
  oauth?: McpOAuthState | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpOAuthState {
  clientId: string;
  /** Khoá bí mật trong kho (nếu máy chủ cấp client_secret). */
  clientSecretKey?: string | null;
  tokenEndpoint: string;
  /** Tài nguyên (resource) gửi kèm khi xin / làm mới token. */
  resource: string;
  accessKey: string;
  refreshKey?: string | null;
  expiresAt?: string | null;
  connectedAt?: string | null;
  scope?: string | null;
}

// ---------------- Plugin (gói kỹ năng + kết nối dịch vụ) ----------------

export interface InstalledPlugin {
  _id: string;
  name: string;
  description: string;
  version?: string | null;
  /** Nguồn cài: gói dựng sẵn, npm, GitHub, URL, lệnh npx (máy chủ MCP). */
  source: { type: 'catalog' | 'npm' | 'github' | 'url' | 'npx'; locator: string; command?: string | null };
  /** Thư mục chứa mã đã tải (trong .jvcompany/plugins) – null với gói dựng sẵn / npx. */
  dir?: string | null;
  skills: string[];
  connections: string[];
  /** Phòng đã được gán kỹ năng của plugin. */
  departments: string[];
  /** Thành phần phát hiện nhưng chưa dùng được (lệnh /, agent con…). */
  notes: string[];
  installedAt: string;
  updatedAt: string;
}

// ---------------- Kênh chat bên ngoài (Telegram) ----------------

export interface ChatConnector {
  _id: string;
  kind: 'telegram';
  name: string;
  enabled: boolean;
  /** Mã bot (chỉ server). Client nhận hasToken + tokenPreview. */
  token?: string;
  hasToken?: boolean;
  tokenPreview?: string;
  /** Địa chỉ Bot API (mặc định https://api.telegram.org). */
  apiBase?: string;
  /** Dự án nhận tin nhắn mặc định (null = mỗi yêu cầu mới thành một dự án, như chat với CEO). */
  defaultProjectId: string | null;
  /** Gửi về Telegram: chỉ câu trả lời/câu hỏi của agent, hay cả tiến độ (giao việc, báo cáo). */
  forward: 'replies' | 'all';
  /** Duyệt từng cuộc trò chuyện mới trước khi nhận tin (khuyên bật). */
  requirePairing: boolean;
  lastUpdateId: number;
  status?: { ok: boolean; message: string; checkedAt: string; botName?: string };
  createdAt: string;
  updatedAt: string;
}

/** Một cuộc trò chuyện Telegram đã ghép với văn phòng. */
export interface ChatBinding {
  _id: string;
  connectorId: string;
  chatId: string;
  chatTitle: string;
  /** pending = chờ bạn duyệt (mã ghép nối), active = đang dùng, blocked = chặn. */
  status: 'pending' | 'active' | 'blocked';
  code: string;
  /** Dự án cuộc trò chuyện đang nhắn (đổi bằng /duan). */
  projectId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Bộ đánh giá agent ----------------

/** Một tiêu chí chấm câu trả lời. judge = nhờ một phòng (AI) chấm theo mô tả. */
export interface EvalCheck {
  kind: 'contains' | 'not_contains' | 'regex' | 'max_chars' | 'judge';
  value: string;
}

export interface EvalCase {
  id: string;
  name: string;
  /** Đầu vào gửi cho phòng (như một yêu cầu thật). */
  input: string;
  checks: EvalCheck[];
}

/** Bộ đánh giá của một phòng: các đầu vào mẫu + tiêu chí đạt. */
export interface EvalSuite {
  _id: string;
  departmentId: string;
  name: string;
  description: string;
  cases: EvalCase[];
  /** Phòng chấm các tiêu chí "judge" (mặc định giám đốc). */
  judgeDepartmentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalCheckResult {
  kind: EvalCheck['kind'];
  value: string;
  passed: boolean | null;
  note?: string;
}

export interface EvalCaseResult {
  caseId: string;
  taskId: string | null;
  judgeTaskIds?: string[];
  status: 'running' | 'judging' | 'done' | 'failed';
  output?: string;
  error?: string | null;
  passed?: boolean;
  checks: EvalCheckResult[];
  durationMs?: number;
  costUsd?: number;
  tokens?: number;
}

/** Một lần chạy bộ đánh giá (với cấu hình hiện tại của phòng, hoặc kết nối/model chọn riêng để so sánh). */
export interface EvalRun {
  _id: string;
  suiteId: string;
  departmentId: string;
  label: string;
  providerId: string | null;
  providerName: string | null;
  model: string | null;
  /** Dấu vân tay prompt hệ thống lúc chạy (để biết đã đổi prompt chưa). */
  promptHash: string;
  status: 'running' | 'done' | 'cancelled';
  results: EvalCaseResult[];
  passed: number;
  total: number;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

// ---------------- Tài khoản & phân quyền ----------------

/** owner: toàn quyền (kể cả tài khoản) · admin: mọi thứ trừ tài khoản · member: làm việc hằng ngày · viewer: chỉ xem. */
export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface User {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  /** Chỉ server. */
  passwordHash?: string;
  /** Công ty được vào (trống = mọi công ty). */
  companies: string[];
  /** Tăng khi đổi mật khẩu / quyền / khoá → phiên đăng nhập cũ hết hiệu lực. */
  tokenVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------- Kỹ năng ----------------

export interface SkillVersion {
  version: number;
  markdown: string;
  note?: string;
  createdAt: string;
}

export interface Skill {
  _id: string;
  /** Khoá duy nhất (chữ thường, gạch ngang). */
  key: string;
  name: string;
  /** Mô tả = khi nào dùng kỹ năng này (agent đọc để quyết định). */
  description: string;
  markdown: string;
  source: { type: 'manual' | 'url' | 'github' | 'path' | 'builtin' | 'library'; locator?: string };
  currentVersion: number;
  versions?: SkillVersion[];
  createdAt: string;
  updatedAt: string;
}
