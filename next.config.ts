import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cho phép chạy song song nhiều instance (vd: bản desktop) với thư mục build riêng.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Gói chạy native (MongoDB driver, tiến trình con) giữ nguyên trong Node, không bundle.
  // typescript: trình biên dịch dùng để dựng bản đồ mã (nạp khi cần, không đóng gói).
  serverExternalPackages: ['mongodb', 'cross-spawn', '@anthropic-ai/sdk', 'openai', '@cursor/sdk', 'typescript'],
  devIndicators: false,
  // Cho phép mở dev server qua 127.0.0.1 lẫn localhost (Electron dùng 127.0.0.1).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
