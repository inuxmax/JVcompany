// Danh mục dùng chung (an toàn cho client): loại kết nối AI, nhãn trạng thái, quyền hạn.
import type {
  PermissionLevel,
  ProjectStatus,
  ProviderKind,
  ProviderType,
  TaskStatus,
  PhaseState,
  ArtifactType,
  ModelTier,
  Department,
  Provider,
  Workflow,
  WorkflowPhase,
  AdapterField,
} from './types';
import { localize } from './i18n';

export interface ProviderPreset {
  type: ProviderType;
  kind: ProviderKind;
  label: string;
  vendor: string;
  description: string;
  baseUrl?: string;
  command?: string;
  webUrl?: string;
  needsApiKey?: boolean;
  /** Model qua API xem được ảnh gửi kèm. */
  vision?: boolean;
  defaultModel?: string;
  models: string[];
  tiers?: Partial<Record<ModelTier, string>>;
  /** Hướng dẫn đăng nhập / lấy khóa. */
  setup: string;
  docsUrl?: string;
  color: string;
  /** Tên lệnh dự phòng (vd Cursor: "agent" khi không có "cursor-agent"). */
  altCommands?: string[];
  /** Lệnh đăng nhập gói đăng ký (gợi ý khi kiểm tra môi trường báo chưa đăng nhập). */
  loginCommand?: string;
  /** Lệnh cài đặt. */
  installCommand?: string;
  /** CLI dùng được bằng API key (ngoài gói đăng ký): tên biến môi trường nhận key. */
  apiKeyEnv?: string;
  /** Ô cấu hình riêng của loại này. */
  fields?: AdapterField[];
  /** Ẩn khỏi màn hình thiết lập nhanh (loại nâng cao). */
  advanced?: boolean;
}


// Bảng nhãn bọc localize(): nhãn tự dịch lúc đọc ở giao diện; ở máy chủ giữ nguyên tiếng Việt.
export const PROVIDER_PRESETS: ProviderPreset[] = localize<ProviderPreset[]>([
  // ---------- API ----------
  {
    type: 'anthropic',
    kind: 'api',
    label: 'Claude API',
    vendor: 'Anthropic',
    description: 'Gọi trực tiếp Claude qua API key, hỗ trợ đầy đủ công cụ (đọc/ghi tệp, lệnh, điều khiển máy).',
    needsApiKey: true,
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    tiers: { top: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' },
    setup: 'Tạo API key tại console.anthropic.com → API Keys.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    color: '#E9A568',
  },
  {
    type: 'openai',
    vision: true,
    kind: 'api',
    label: 'OpenAI API',
    vendor: 'OpenAI',
    description: 'GPT / Codex qua API key (Chat Completions + function calling).',
    baseUrl: 'https://api.openai.com/v1',
    needsApiKey: true,
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-codex', 'o4-mini', 'gpt-4.1'],
    tiers: { top: 'gpt-5', balanced: 'gpt-5', fast: 'gpt-5-mini' },
    setup: 'Tạo API key tại platform.openai.com → API keys.',
    docsUrl: 'https://platform.openai.com/api-keys',
    color: '#10A37F',
  },
  {
    type: 'gemini',
    vision: true,
    kind: 'api',
    label: 'Gemini API',
    vendor: 'Google',
    description: 'Gemini qua endpoint tương thích OpenAI của Google AI Studio.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsApiKey: true,
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    tiers: { top: 'gemini-2.5-pro', balanced: 'gemini-2.5-pro', fast: 'gemini-2.5-flash' },
    setup: 'Lấy API key tại aistudio.google.com → Get API key.',
    docsUrl: 'https://aistudio.google.com/apikey',
    color: '#4F8CFF',
  },
  {
    type: 'xai',
    vision: true,
    kind: 'api',
    label: 'Grok API',
    vendor: 'xAI',
    description: 'Grok qua API tương thích OpenAI của xAI.',
    baseUrl: 'https://api.x.ai/v1',
    needsApiKey: true,
    defaultModel: 'grok-4',
    models: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-code-fast-1'],
    setup: 'Tạo API key tại console.x.ai.',
    docsUrl: 'https://console.x.ai',
    color: '#E5E7EB',
  },
  {
    type: 'deepseek',
    kind: 'api',
    label: 'DeepSeek API',
    vendor: 'DeepSeek',
    description: 'Các model DeepSeek qua API tương thích OpenAI.',
    baseUrl: 'https://api.deepseek.com/v1',
    needsApiKey: true,
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    tiers: { top: 'deepseek-v4-pro', balanced: 'deepseek-v4-pro', fast: 'deepseek-flash' },
    setup: 'Tạo API key tại platform.deepseek.com.',
    color: '#4D6BFE',
  },
  {
    type: 'openrouter',
    kind: 'api',
    label: 'OpenRouter',
    vendor: 'OpenRouter',
    description: 'Một khóa cho hàng trăm mô hình (Claude, GPT, Gemini, Llama, Qwen…).',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsApiKey: true,
    defaultModel: 'anthropic/claude-sonnet-5.5',
    models: [],
    setup: 'Tạo key tại openrouter.ai/keys. Bấm "Kiểm tra" để tải danh sách mô hình.',
    docsUrl: 'https://openrouter.ai/keys',
    color: '#8B5CF6',
  },
  {
    type: 'groq',
    kind: 'api',
    label: 'Groq',
    vendor: 'Groq',
    description: 'Suy luận siêu nhanh cho mô hình mở.',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsApiKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    models: [],
    setup: 'Tạo key tại console.groq.com.',
    color: '#F55036',
  },
  {
    type: 'mistral',
    kind: 'api',
    label: 'Mistral',
    vendor: 'Mistral AI',
    description: 'Mistral / Codestral qua API.',
    baseUrl: 'https://api.mistral.ai/v1',
    needsApiKey: true,
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'codestral-latest'],
    setup: 'Tạo key tại console.mistral.ai.',
    color: '#FA520F',
  },
  {
    type: 'ollama',
    kind: 'api',
    label: 'Ollama (máy cục bộ)',
    vendor: 'Ollama',
    description: 'Chạy mô hình mở ngay trên máy, không cần internet.',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder',
    models: [],
    setup: 'Cài Ollama (ollama.com) rồi chạy: ollama pull qwen2.5-coder',
    color: '#958B7E',
  },
  {
    type: 'lmstudio',
    kind: 'api',
    label: 'LM Studio',
    vendor: 'LM Studio',
    description: 'Máy chủ cục bộ tương thích OpenAI của LM Studio.',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: '',
    models: [],
    setup: 'Mở LM Studio → Developer → Start Server.',
    color: '#6366F1',
  },
  {
    type: 'openai-compatible',
    kind: 'api',
    label: 'Tùy chỉnh (OpenAI-compatible)',
    vendor: 'Khác',
    description: 'Bất kỳ endpoint nào tương thích OpenAI (vLLM, Together, Fireworks, Azure…).',
    baseUrl: 'https://',
    defaultModel: '',
    models: [],
    setup: 'Nhập Base URL (kết thúc bằng /v1) và API key nếu cần.',
    color: '#7A7268',
  },

  // ---------- Gói đăng ký qua ứng dụng desktop / CLI ----------
  {
    type: 'claude-code',
    kind: 'cli',
    label: 'Claude Code',
    vendor: 'Anthropic',
    description: 'Dùng gói Claude Pro/Max (hoặc API key) qua Claude Code CLI. Agent tự đọc/sửa code trong thư mục dự án.',
    command: 'claude',
    defaultModel: 'opus',
    models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    tiers: { top: 'opus', balanced: 'sonnet', fast: 'haiku' },
    setup: 'Cài: npm i -g @anthropic-ai/claude-code → chạy "claude" một lần và đăng nhập tài khoản Claude.',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    loginCommand: 'claude login',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.claude.com/claude-code',
    color: '#E9A568',
    fields: [
      { key: 'maxTurns', label: 'Số lượt tối đa mỗi lần chạy', type: 'number', placeholder: 'Không giới hạn', help: '--max-turns' },
      { key: 'chrome', label: 'Cho dùng Chrome (--chrome)', type: 'toggle', default: false },
      { key: 'ignoreHostApiKey', label: 'Bỏ qua ANTHROPIC_API_KEY của máy (dùng gói đăng ký)', type: 'toggle', default: false },
    ],
  },
  {
    type: 'codex',
    kind: 'cli',
    label: 'OpenAI Codex CLI',
    vendor: 'OpenAI',
    description: 'Dùng gói ChatGPT Plus/Pro/Team (hoặc API key) qua Codex CLI.',
    command: 'codex',
    defaultModel: '',
    models: ['gpt-5.5-codex', 'gpt-5.5', 'gpt-5-codex', 'gpt-5', 'gpt-5-mini'],
    setup: 'Cài: npm i -g @openai/codex → chạy "codex login" và đăng nhập bằng tài khoản ChatGPT.',
    installCommand: 'npm i -g @openai/codex',
    loginCommand: 'codex login --device-auth',
    apiKeyEnv: 'OPENAI_API_KEY',
    docsUrl: 'https://github.com/openai/codex',
    color: '#10A37F',
    fields: [
      { key: 'search', label: 'Cho tìm kiếm web (--search)', type: 'toggle', default: false },
      { key: 'fastMode', label: 'Chế độ nhanh (service_tier=fast)', type: 'toggle', default: false },
    ],
  },
  {
    type: 'gemini-cli',
    kind: 'cli',
    label: 'Gemini CLI',
    vendor: 'Google',
    description: 'Dùng tài khoản Google (gói miễn phí/Google AI Pro) hoặc API key qua Gemini CLI.',
    command: 'gemini',
    defaultModel: 'auto',
    models: ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    setup: 'Cài: npm i -g @google/gemini-cli → chạy "gemini" một lần và đăng nhập Google.',
    installCommand: 'npm i -g @google/gemini-cli',
    loginCommand: 'gemini (chọn "Login with Google")',
    apiKeyEnv: 'GEMINI_API_KEY',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    color: '#4F8CFF',
    fields: [{ key: 'sandbox', label: 'Chạy trong sandbox (--sandbox)', type: 'toggle', default: false }],
  },
  {
    type: 'cursor-agent',
    kind: 'cli',
    label: 'Cursor Agent',
    vendor: 'Cursor',
    description: 'Dùng gói Cursor Pro (hoặc CURSOR_API_KEY) qua Cursor CLI.',
    command: 'cursor-agent',
    altCommands: ['agent'],
    defaultModel: 'auto',
    models: ['auto', 'sonnet-4.5', 'gpt-5', 'composer-1'],
    setup: 'Cài Cursor CLI (cursor.com/cli) → chạy "cursor-agent login".',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    loginCommand: 'cursor-agent login',
    apiKeyEnv: 'CURSOR_API_KEY',
    docsUrl: 'https://cursor.com/cli',
    color: '#5C9A68',
  },
  {
    type: 'opencode',
    kind: 'cli',
    label: 'OpenCode',
    vendor: 'SST',
    description: 'OpenCode CLI – dùng được nhiều nhà cung cấp/gói đăng ký. Model dạng nhà-cung-cấp/model.',
    command: 'opencode',
    defaultModel: '',
    models: [],
    setup: 'Cài: npm i -g opencode-ai → chạy "opencode auth login". Chọn model dạng "anthropic/claude-sonnet-5-5".',
    installCommand: 'npm i -g opencode-ai',
    loginCommand: 'opencode auth login',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    docsUrl: 'https://opencode.ai/docs',
    color: '#C9952F',
    fields: [{ key: 'variant', label: 'Biến thể model (--variant)', type: 'text', placeholder: 'vd high' }],
  },
  {
    type: 'pi',
    kind: 'cli',
    label: 'Pi',
    vendor: 'Pi coding agent',
    description: 'Agent lập trình Pi – nhiều nhà cung cấp (Anthropic, OpenAI, OpenRouter, Google). Model dạng nhà-cung-cấp/model.',
    command: 'pi',
    defaultModel: '',
    models: [],
    setup: 'Cài: npm i -g @mariozechner/pi-coding-agent → chạy "pi" và đăng nhập / đặt API key.',
    installCommand: 'npm i -g @mariozechner/pi-coding-agent',
    loginCommand: 'pi (lệnh /login)',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    color: '#8F7A5A',
    advanced: true,
  },
  {
    type: 'kimi',
    kind: 'cli',
    label: 'Kimi Code',
    vendor: 'Moonshot AI',
    description: 'Kimi Code CLI (gói Kimi hoặc API key).',
    command: 'kimi',
    defaultModel: 'kimi-code/kimi-for-coding',
    models: ['kimi-code/kimi-for-coding', 'kimi-code/k3'],
    setup: 'Cài Kimi Code CLI → chạy "kimi login".',
    installCommand: 'uv tool install kimi-cli',
    loginCommand: 'kimi login',
    apiKeyEnv: 'KIMI_MODEL_API_KEY',
    color: '#3D6FD8',
    advanced: true,
  },
  {
    type: 'grok',
    kind: 'cli',
    label: 'Grok Build',
    vendor: 'xAI',
    description: 'Grok Build CLI của xAI (gói SuperGrok hoặc XAI_API_KEY).',
    command: 'grok',
    defaultModel: 'grok-build',
    models: ['grok-build', 'grok-4', 'grok-code-fast-1'],
    setup: 'Cài Grok CLI → chạy "grok login --device-auth".',
    loginCommand: 'grok login --device-auth',
    apiKeyEnv: 'XAI_API_KEY',
    color: '#5B5B5B',
    advanced: true,
    fields: [{ key: 'webSearch', label: 'Cho tìm kiếm web', type: 'toggle', default: false }],
  },
  {
    type: 'hermes',
    kind: 'cli',
    label: 'Hermes Agent',
    vendor: 'Nous Research',
    description: 'Hermes Agent CLI (chạy cục bộ, nhiều nhà cung cấp).',
    command: 'hermes',
    defaultModel: 'auto',
    models: ['auto'],
    setup: 'Cài Hermes Agent → chạy "hermes setup" để chọn nhà cung cấp và API key.',
    loginCommand: 'hermes setup',
    color: '#7B5EA7',
    advanced: true,
    fields: [
      { key: 'hermesProvider', label: 'Nhà cung cấp (--provider)', type: 'text', placeholder: 'auto' },
      { key: 'toolsets', label: 'Bộ công cụ (-t)', type: 'text', placeholder: 'vd terminal,file,web' },
      { key: 'maxTurns', label: 'Số lượt tối đa', type: 'number' },
    ],
  },
  {
    type: 'copilot',
    kind: 'cli',
    label: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    description: 'Dùng gói GitHub Copilot qua Copilot CLI.',
    command: 'copilot',
    defaultModel: '',
    models: [],
    setup: 'Cài: npm i -g @github/copilot → chạy "copilot" và đăng nhập GitHub.',
    installCommand: 'npm i -g @github/copilot',
    loginCommand: 'copilot (lệnh /login)',
    color: '#8A7DAE',
  },
  {
    type: 'qwen-code',
    kind: 'cli',
    label: 'Qwen Code',
    vendor: 'Alibaba',
    description: 'Qwen Code CLI (đăng nhập Qwen OAuth miễn phí).',
    command: 'qwen',
    defaultModel: '',
    models: [],
    setup: 'Cài: npm i -g @qwen-code/qwen-code → chạy "qwen" để đăng nhập.',
    installCommand: 'npm i -g @qwen-code/qwen-code',
    loginCommand: 'qwen',
    color: '#615CED',
    advanced: true,
  },
  {
    type: 'custom-cli',
    kind: 'cli',
    label: 'Lệnh tùy chỉnh',
    vendor: 'Khác',
    description: 'Bất kỳ chương trình dòng lệnh nào nhận prompt và in kết quả ra stdout (giống "process" của Paperclip).',
    command: '',
    defaultModel: '',
    models: [],
    setup: 'Nhập lệnh, tham số ({model} sẽ được thay thế) và cách truyền prompt.',
    color: '#7A7268',
    advanced: true,
  },

  // ---------- Agent ở máy / dịch vụ khác ----------
  {
    type: 'hermes-gateway',
    kind: 'gateway',
    label: 'Hermes Gateway',
    vendor: 'Nous Research',
    description: 'Gọi Hermes Agent đang chạy ở máy khác qua HTTP + SSE (/v1/runs).',
    baseUrl: 'http://127.0.0.1:9119/api',
    defaultModel: '',
    models: [],
    setup: 'Bật API của Hermes Gateway, nhập địa chỉ và API key.',
    color: '#7B5EA7',
    advanced: true,
    fields: [
      {
        key: 'sessionKeyStrategy',
        label: 'Giữ phiên theo',
        type: 'select',
        default: 'task',
        options: [
          { value: 'task', label: 'Từng nhiệm vụ' },
          { value: 'department', label: 'Từng phòng ban' },
          { value: 'run', label: 'Mỗi lượt một phiên mới' },
          { value: 'none', label: 'Không gửi phiên' },
        ],
      },
      { key: 'payloadTemplate', label: 'Mẫu dữ liệu gửi kèm (JSON)', type: 'textarea', placeholder: '{"model": "…"}' },
    ],
  },
  {
    type: 'openclaw-gateway',
    kind: 'gateway',
    label: 'OpenClaw Gateway',
    vendor: 'OpenClaw',
    description: 'Thuê agent OpenClaw qua WebSocket (giao thức v4, khoá thiết bị Ed25519, tự ghép cặp).',
    baseUrl: 'ws://127.0.0.1:18789',
    defaultModel: '',
    models: [],
    setup: 'Nhập địa chỉ ws:// (wss:// nếu ở xa) và token của gateway. Lần đầu hệ thống tự ghép cặp thiết bị.',
    color: '#D9573B',
    advanced: true,
    fields: [
      { key: 'agentId', label: 'Mã agent trên gateway', type: 'text', placeholder: 'để trống = mặc định' },
      {
        key: 'sessionKeyStrategy',
        label: 'Giữ phiên theo',
        type: 'select',
        default: 'task',
        options: [
          { value: 'task', label: 'Từng nhiệm vụ' },
          { value: 'fixed', label: 'Một phiên cố định' },
          { value: 'run', label: 'Mỗi lượt một phiên mới' },
        ],
      },
      { key: 'sessionKey', label: 'Tên phiên cố định', type: 'text', placeholder: 'vanphong' },
      { key: 'scopes', label: 'Quyền (scopes)', type: 'text', default: 'operator.admin' },
      { key: 'password', label: 'Mật khẩu gateway (nếu có)', type: 'secret' },
      { key: 'disableDeviceAuth', label: 'Tắt xác thực thiết bị', type: 'toggle', default: false },
      { key: 'autoPair', label: 'Tự ghép cặp lần đầu', type: 'toggle', default: true },
      { key: 'payloadTemplate', label: 'Mẫu dữ liệu gửi kèm (JSON)', type: 'textarea' },
    ],
  },
  {
    type: 'http-webhook',
    kind: 'gateway',
    label: 'HTTP webhook',
    vendor: 'Khác',
    description: 'Gửi nhiệm vụ tới một địa chỉ HTTP; agent bên ngoài trả kết quả ngay hoặc gọi lại sau qua URL gọi lại.',
    baseUrl: 'https://',
    defaultModel: '',
    models: [],
    setup: 'Nhập URL nhận việc. Kết quả: trả JSON {"result": "..."} ngay, hoặc POST về callbackUrl kèm callbackToken.',
    color: '#4A86BD',
    advanced: true,
    fields: [
      {
        key: 'method',
        label: 'Phương thức',
        type: 'select',
        default: 'POST',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
        ],
      },
      { key: 'payloadTemplate', label: 'Mẫu dữ liệu gửi kèm (JSON)', type: 'textarea' },
    ],
  },
  {
    type: 'cursor-cloud',
    kind: 'gateway',
    label: 'Cursor Cloud Agent',
    vendor: 'Cursor',
    description: 'Agent chạy trên máy chủ của Cursor, làm việc trực tiếp trên repo GitHub (tự tạo PR).',
    needsApiKey: true,
    defaultModel: '',
    models: [],
    setup: 'Tạo API key tại cursor.com/dashboard → Integrations, nhập URL repo GitHub.',
    docsUrl: 'https://cursor.com/docs/cloud-agent',
    color: '#5C9A68',
    advanced: true,
    fields: [
      { key: 'repoUrl', label: 'URL repo GitHub', type: 'text', placeholder: 'https://github.com/ten/repo' },
      { key: 'startingRef', label: 'Nhánh bắt đầu', type: 'text', placeholder: 'main' },
      { key: 'autoCreatePR', label: 'Tự tạo Pull Request', type: 'toggle', default: true },
      { key: 'workOnCurrentBranch', label: 'Làm trên nhánh hiện tại', type: 'toggle', default: false },
    ],
  },
  // ---------- Gói đăng ký qua trình duyệt ----------
  {
    type: 'web-manual',
    kind: 'manual',
    label: 'Trình duyệt (chuyển tiếp)',
    vendor: 'ChatGPT / Claude.ai / Gemini / Grok',
    description:
      'Dùng gói đăng ký trên web: hệ thống soạn sẵn prompt chuẩn, bạn dán vào ChatGPT/Claude.ai/Gemini/Grok rồi dán câu trả lời lại.',
    webUrl: 'https://chatgpt.com',
    defaultModel: '',
    models: [],
    setup: 'Không cần cài đặt. Khi có nhiệm vụ, mở tab Hội thoại để sao chép prompt và dán kết quả.',
    color: '#4A86BD',
  },
]);

export const WEB_TARGETS = localize([
  { label: 'ChatGPT', url: 'https://chatgpt.com' },
  { label: 'Claude.ai', url: 'https://claude.ai/new' },
  { label: 'Gemini', url: 'https://gemini.google.com/app' },
  { label: 'Grok', url: 'https://grok.com' },
  { label: 'DeepSeek', url: 'https://chat.deepseek.com' },
]);

/**
 * Kết nối CLI không hỏi được chủ công ty giữa chừng nên không làm đúng mọi mức quyền – hiện cảnh báo trong nhật ký
 * mỗi lượt chạy. (Claude Code và kết nối API hỏi được: thao tác vượt quyền tạo thẻ phê duyệt.)
 */
export const PERMISSION_CAVEATS: Partial<Record<ProviderType, Partial<Record<PermissionLevel, string>>>> = localize({
  codex: { write: 'Codex không hỏi được giữa chừng: ở mức "Đọc & ghi" lệnh trong dự án vẫn chạy luôn (sandbox workspace-write).' },
  'cursor-agent': { write: 'Cursor Agent chạy với --force: lệnh shell không hỏi trước.' },
  grok: { write: 'Grok Build tự đồng ý mọi thao tác: lệnh shell không hỏi trước.' },
  hermes: { read: 'Hermes không có chế độ chỉ đọc: vẫn có thể ghi tệp và chạy lệnh thông thường.', write: 'Hermes chạy --yolo: lệnh shell không hỏi trước.' },
  kimi: { read: 'Kimi Code (chế độ in) tự đồng ý mọi thao tác: không giới hạn được chỉ đọc.', write: 'Kimi Code tự đồng ý mọi thao tác: lệnh shell không hỏi trước.', auto: 'Kimi Code không giới hạn thư mục dự án.' },
  'custom-cli': { read: 'Lệnh tuỳ chỉnh không nhận mức quyền – tự giới hạn trong lệnh của bạn (biến VP_PERMISSION).', write: 'Lệnh tuỳ chỉnh không nhận mức quyền (biến VP_PERMISSION).', auto: 'Lệnh tuỳ chỉnh không nhận mức quyền (biến VP_PERMISSION).' },
  copilot: { write: 'Copilot CLI ở mức "Đọc & ghi" không được tự sửa tệp (không hỏi được) – dùng "Tự động trong dự án" nếu cần sửa.' },
  'qwen-code': { write: 'Qwen Code ở mức "Đọc & ghi" không được tự sửa tệp (không hỏi được) – dùng "Tự động trong dự án" nếu cần sửa.' },
  'gemini-cli': { write: 'Gemini CLI ở mức "Đọc & ghi": tự sửa tệp nhưng lệnh shell bị chặn (không hỏi được).', auto: 'Gemini CLI dùng --approval-mode yolo cho cả "Tự động" và "Toàn quyền".' },
  pi: { write: 'Pi không giới hạn thư mục: có thể sửa tệp ngoài dự án.', auto: 'Pi không giới hạn thư mục: có thể sửa tệp / chạy lệnh ngoài dự án.' },
});

export function getPreset(type: ProviderType): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.type === type) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** Danh sách model thật tải từ API của kết nối (CLI chỉ có danh sách gợi ý nên trả về rỗng). */
export function liveModels(provider: Pick<Provider, 'kind' | 'models'>): string[] {
  return provider.kind === 'api' ? (provider.models ?? []) : [];
}

/** Model có dùng được với kết nối không. Chưa tải danh sách = chưa biết → coi như được; chấp nhận bản có ngày (claude-x → claude-x-20260101). */
export function modelAvailable(provider: Pick<Provider, 'kind' | 'models'>, model?: string | null): boolean {
  if (!model) return false;
  const live = liveModels(provider);
  return !live.length || live.some((m) => m === model || m.startsWith(`${model}-`));
}

/** Model một phòng ban sẽ dùng với kết nối: model riêng của phòng → model theo hạng (nếu kết nối có) → model mặc định của kết nối. */
export function resolveModel(dept: Pick<Department, 'model' | 'providerId' | 'tier'>, provider: Provider): string {
  const preset = getPreset(provider.type);
  if (dept.model) {
    // Phòng ghim kết nối → tin model của phòng; còn lại chỉ dùng khi kết nối này biết model đó.
    const known = [...(provider.models ?? []), ...preset.models];
    if (dept.providerId === provider._id || known.some((m) => m === dept.model || m.startsWith(`${dept.model}-`))) return dept.model;
  }
  const tierModel = preset.tiers?.[dept.tier];
  if (tierModel && modelAvailable(provider, tierModel)) return tierModel;
  if (provider.defaultModel) return provider.defaultModel;
  return liveModels(provider)[0] ?? preset.defaultModel ?? '';
}

export const MODEL_TIERS: { id: ModelTier; label: string; description: string }[] = localize([
  { id: 'top', label: 'Cao cấp', description: 'Mô hình mạnh nhất – cho quyết định chiến lược, kiến trúc.' },
  { id: 'balanced', label: 'Cân bằng', description: 'Cân bằng tốc độ và chất lượng.' },
  { id: 'fast', label: 'Nhanh', description: 'Nhanh, tiết kiệm – cho kiểm tra, việc lặp lại.' },
]);

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = localize({
  api: 'API key',
  cli: 'Gói đăng ký · Desktop',
  gateway: 'Agent bên ngoài',
  manual: 'Gói đăng ký · Trình duyệt',
});

export const PERMISSION_LEVELS: {
  id: PermissionLevel;
  label: string;
  short: string;
  description: string;
  color: string;
}[] = localize([
  {
    id: 'read',
    label: 'Chỉ đọc',
    short: 'Đọc',
    description: 'Agent chỉ được đọc tệp trong thư mục dự án. Không ghi, không chạy lệnh.',
    color: '#958B7E',
  },
  {
    id: 'write',
    label: 'Đọc & ghi',
    short: 'Ghi',
    description: 'Đọc/ghi tệp trong thư mục dự án. Mỗi lệnh shell phải được bạn phê duyệt.',
    color: '#4A86BD',
  },
  {
    id: 'auto',
    label: 'Tự động trong dự án',
    short: 'Tự động',
    description: 'Đọc/ghi tệp và chạy lệnh trong thư mục dự án không cần hỏi. Sửa tệp ngoài thư mục phải duyệt (lệnh shell chạy từ thư mục dự án nhưng không bị khoá trong đó).',
    color: '#C9952F',
  },
  {
    id: 'full',
    label: 'Toàn quyền máy tính',
    short: 'Toàn quyền',
    description:
      'Truy cập mọi thư mục, chạy mọi lệnh, chụp màn hình, điều khiển chuột/bàn phím, mở ứng dụng. Cần bật "Điều khiển máy tính" trong Cài đặt.',
    color: '#C4483F',
  },
]);

export const PERMISSION_RANK: Record<PermissionLevel, number> = { read: 0, write: 1, auto: 2, full: 3 };

/** Chế độ "Giao cho giám đốc": một giai đoạn, giám đốc tầng nhận yêu cầu rồi tự điều phối. */
export const DIRECTOR_WORKFLOW_ID = 'director';

/** Tìm giai đoạn theo id trong mọi chế độ làm việc (id giai đoạn không trùng giữa các chế độ). */
export function findPhase(workflows: Pick<Workflow, 'phases'>[] | null | undefined, phaseId?: string | null): WorkflowPhase | undefined {
  if (!phaseId) return undefined;
  for (const w of workflows ?? []) {
    const p = w.phases.find((x) => x.id === phaseId);
    if (p) return p;
  }
  return undefined;
}

export function minPermission(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b;
}

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; color: string }> = localize({
  draft: { label: 'Nháp', color: '#958B7E' },
  active: { label: 'Đang chạy', color: '#4A86BD' },
  paused: { label: 'Tạm dừng', color: '#C9952F' },
  completed: { label: 'Hoàn thành', color: '#5C9A68' },
  blocked: { label: 'Cần xử lý', color: '#C4483F' },
  cancelled: { label: 'Đã hủy', color: '#7A7268' },
  waiting_floor: { label: 'Chờ tầng trống', color: '#8A7DAE' },
});

export const PHASE_STATE: Record<PhaseState, string> = localize({
  idle: 'Chưa bắt đầu',
  working: 'Đang thực hiện',
  reviewing: 'Đang duyệt',
  awaiting_user: 'Chờ bạn quyết định',
  done: 'Hoàn tất',
});

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string; group: 'queue' | 'active' | 'waiting' | 'done' | 'failed' }> = localize({
  queued: { label: 'Hàng đợi', color: '#958B7E', group: 'queue' },
  running: { label: 'Đang làm', color: '#4A86BD', group: 'active' },
  waiting_children: { label: 'Chờ phòng khác', color: '#8A7DAE', group: 'waiting' },
  waiting_approval: { label: 'Chờ phê duyệt', color: '#C9952F', group: 'waiting' },
  waiting_limit: { label: 'Chờ hạn mức', color: '#CF6A3D', group: 'waiting' },
  waiting_human: { label: 'Chờ bạn dán kết quả', color: '#C06587', group: 'waiting' },
  waiting_deps: { label: 'Chờ bàn giao', color: '#3F8A93', group: 'waiting' },
  in_review: { label: 'Chờ duyệt', color: '#B8862B', group: 'waiting' },
  done: { label: 'Hoàn thành', color: '#5C9A68', group: 'done' },
  failed: { label: 'Lỗi', color: '#C4483F', group: 'failed' },
  cancelled: { label: 'Đã hủy', color: '#7A7268', group: 'failed' },
});

export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'waiting_children',
  'waiting_approval',
  'waiting_limit',
  'waiting_human',
  'waiting_deps',
  'in_review',
];

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['done', 'failed', 'cancelled'];

export const ARTIFACT_TYPES: Record<ArtifactType, string> = localize({
  document: 'Tài liệu',
  plan: 'Kế hoạch',
  design: 'Thiết kế',
  code: 'Mã nguồn',
  report: 'Báo cáo',
  other: 'Khác',
});

export const EFFORT_LEVELS = localize([
  { id: '', label: 'Mặc định' },
  { id: 'low', label: 'Thấp' },
  { id: 'medium', label: 'Vừa' },
  { id: 'high', label: 'Cao' },
  { id: 'xhigh', label: 'Rất cao' },
  { id: 'max', label: 'Tối đa' },
] as const);

export const DEPARTMENT_ICONS = [
  'Crown',
  'Palette',
  'Code2',
  'Users',
  'ClipboardList',
  'Network',
  'ShieldCheck',
  'Cpu',
  'Briefcase',
  'BookOpen',
  'Megaphone',
  'Database',
  'Bot',
  'Rocket',
  'LineChart',
  'Wrench',
  'FlaskConical',
  'Bug',
] as const;
