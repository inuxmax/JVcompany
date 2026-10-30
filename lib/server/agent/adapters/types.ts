// Giao diện chung của các bộ kết nối agent CLI (theo mô hình "adapter" của Paperclip).
import type { EnvCheck, Provider, ProviderType } from '../../../types';
import type { AgentContext } from '../context';

export interface BuildInput {
  ctx: AgentContext;
  provider: Provider;
  model: string;
  /** Prompt đầy đủ (hướng dẫn hệ thống + nhiệm vụ). */
  prompt: string;
  system: string;
  task: string;
  /** Phiên để làm tiếp (null = phiên mới). */
  resume: string | null;
  /** Ghi prompt ra tệp trong dự án, trả về câu ngắn bảo agent đọc tệp (cho CLI nhận prompt qua tham số dòng lệnh). */
  promptFile: () => Promise<string>;
  /** Thư mục làm việc. */
  cwd: string;
  /** Lần chạy lại sau lỗi: bỏ các tham số CLI không hỗ trợ (vd "effort"). */
  without: Set<string>;
}

export interface CliSpec {
  args: string[];
  input?: string;
  env?: Record<string, string | undefined>;
  /** Mã phiên biết trước khi chạy (vd Pi lưu phiên ở tệp do mình chọn). */
  sessionId?: string;
}

/** Sự kiện chuẩn hoá từ đầu ra của mọi CLI. */
export type CliEvent =
  /** Một đoạn chữ của tin nhắn đang viết. */
  | { kind: 'delta'; text: string }
  /** Bắt đầu một tin nhắn mới (xoá phần đang viết). */
  | { kind: 'reset' }
  /** Tin nhắn trọn vẹn của agent. */
  | { kind: 'text'; text: string }
  | { kind: 'tool'; text: string; tool?: string }
  | { kind: 'session'; id: string }
  | { kind: 'model'; id: string }
  /** Token/chi phí: cộng thêm, hoặc `replace` = số tổng của cả lượt. */
  | { kind: 'usage'; input?: number; output?: number; cached?: number; costUsd?: number; replace?: boolean }
  | { kind: 'result'; text?: string; isError?: boolean }
  | { kind: 'error'; message: string };

export interface ProbeSpec {
  args: string[];
  input?: string;
  env?: Record<string, string | undefined>;
}

export interface TextParse {
  text: string;
  sessionId?: string | null;
  usage?: { input: number; output: number; costUsd?: number };
}

export interface CliAdapter {
  type: ProviderType;
  /** Mỗi dòng stdout là một sự kiện JSON. Không có = stdout là chữ thường. */
  createParser?: () => (ev: Record<string, unknown>) => CliEvent[];
  /** Với stdout chữ thường: tách phiên / token / chi phí khỏi nội dung. */
  parseText?: (stdout: string) => TextParse;
  build(input: BuildInput): Promise<CliSpec>;
  /** Lượt thử "Respond with hello." khi kiểm tra môi trường (null = không thử). */
  probe(provider: Provider, model: string): ProbeSpec | null;
  /** Tải danh sách model bằng chính CLI (vd `opencode models`). */
  listModels?(command: string, provider: Provider): Promise<string[]>;
  /** Biến môi trường nhận API key ở chế độ API key. */
  apiKeyEnv?(provider: Provider, model: string): string[];
  /** Chuẩn bị môi trường riêng cho chế độ API key (vd CODEX_HOME có auth.json). */
  prepareApiKeyEnv?(provider: Provider, model: string): Promise<Record<string, string | undefined>>;
  supportsResume?: boolean;
  /** Lỗi "không tìm thấy phiên" → chạy lại bằng phiên mới. */
  unknownSession?: RegExp;
  /** Model bắt buộc (vd dạng nhà-cung-cấp/model): thông báo khi thiếu. */
  requiresModel?: string;
  /** Kiểm tra riêng của loại này. */
  extraChecks?(provider: Provider, model: string): Promise<EnvCheck[]>;
}
