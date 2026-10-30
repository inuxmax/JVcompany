// Danh mục mẫu kết nối dịch vụ (MCP) – dùng chung cho server và giao diện.
import type { McpKind, McpPolicy } from './types';
import { localize } from './i18n';

export interface McpPreset {
  kind: McpKind;
  id: string;
  label: string;
  description: string;
  transport: 'stdio' | 'http';
  key: string;
  command?: string;
  args?: string[];
  url?: string;
  /** Nơi đặt token: biến môi trường (stdio) hoặc header (http, có tiền tố). */
  token?: { env?: string; header?: string; prefix?: string; secretKey: string; label: string; help: string };
  docs?: string;
}

export const MCP_PRESETS: McpPreset[] = localize<McpPreset[]>([
  {
    kind: 'github',
    id: 'github',
    label: 'GitHub',
    description: 'Đọc repo, issue, pull request; tạo issue / PR / bình luận (máy chủ MCP chính thức của GitHub).',
    transport: 'http',
    key: 'github',
    url: 'https://api.githubcopilot.com/mcp/',
    token: { header: 'Authorization', prefix: 'Bearer ', secretKey: 'GITHUB_MCP_TOKEN', label: 'Personal access token', help: 'Tạo ở GitHub → Settings → Developer settings → Fine-grained tokens (quyền theo repo bạn muốn cho agent dùng).' },
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    kind: 'notion',
    id: 'notion',
    label: 'Notion',
    description: 'Tìm, đọc và cập nhật trang / cơ sở dữ liệu Notion (máy chủ MCP chính thức của Notion, chạy bằng npx).',
    transport: 'stdio',
    key: 'notion',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    token: { env: 'NOTION_TOKEN', secretKey: 'NOTION_MCP_TOKEN', label: 'Integration token', help: 'Tạo integration ở notion.so/my-integrations rồi chia sẻ các trang cần dùng cho integration đó.' },
    docs: 'https://github.com/makenotion/notion-mcp-server',
  },
  {
    kind: 'custom',
    id: 'custom-stdio',
    label: 'MCP tuỳ chỉnh (lệnh)',
    description: 'Máy chủ MCP chạy bằng lệnh trên máy này (stdio), vd npx -y @modelcontextprotocol/server-filesystem.',
    transport: 'stdio',
    key: 'my-mcp',
    command: 'npx',
    args: ['-y', ''],
  },
  {
    kind: 'custom',
    id: 'custom-http',
    label: 'MCP tuỳ chỉnh (HTTP)',
    description: 'Máy chủ MCP từ xa qua HTTP (Streamable HTTP), kèm header xác thực nếu cần.',
    transport: 'http',
    key: 'remote-mcp',
    url: 'https://',
  },
]);

export const MCP_POLICY_LABEL: Record<McpPolicy, string> = localize({ allow: 'Cho phép', ask: 'Hỏi trước', off: 'Tắt' });

export const MCP_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Đoán thao tác chỉ đọc theo tên (khi máy chủ không gợi ý). */
const READ_WORDS = new Set(['get', 'list', 'search', 'read', 'fetch', 'find', 'query', 'retrieve', 'view', 'show', 'describe', 'whoami', 'me', 'download']);
const WRITE_WORDS = new Set(['create', 'update', 'delete', 'remove', 'merge', 'push', 'write', 'patch', 'put', 'add', 'set', 'close', 'edit', 'move', 'archive', 'fork', 'assign', 'comment', 'send', 'upload', 'run', 'execute', 'append', 'reopen', 'request', 'dismiss', 'cancel']);

export function looksReadOnly(name: string): boolean {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // "post" chỉ là phương thức HTTP (vd Notion "API-post-search" = tìm kiếm) → không tự coi là ghi
  return words.some((w) => READ_WORDS.has(w)) && !words.some((w) => WRITE_WORDS.has(w));
}

/** Tên công cụ đầy đủ mà Claude Code thấy. */
export function mcpToolName(key: string, tool: string): string {
  return `mcp__${key}__${tool}`;
}
