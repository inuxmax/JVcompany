// Khởi động worker agent một lần khi máy chủ Next.js chạy (không chạy lúc build).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.VANPHONG_WORKER === 'off') return;
  const { startWorker } = await import('./lib/server/agent/worker');
  void startWorker();
}
