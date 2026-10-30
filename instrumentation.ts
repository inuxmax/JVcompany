// Khởi động worker agent một lần khi máy chủ Next.js chạy (không chạy lúc build).
// register() được gọi cả ở Edge runtime → mã dùng Node.js chỉ import trong nhánh nodejs.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    const { migrateLegacyDataDir } = await import('./lib/server/legacy-data');
    migrateLegacyDataDir();
    if (process.env.JVCOMPANY_WORKER === 'off') return;
    const { startWorker } = await import('./lib/server/agent/worker');
    void startWorker();
  }
}
