// Khởi động worker agent một lần khi máy chủ Next.js chạy (không chạy lúc build).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  await migrateLegacyDataDir();
  if (process.env.JVCOMPANY_WORKER === 'off') return;
  const { startWorker } = await import('./lib/server/agent/worker');
  void startWorker();
}

/** Bản cũ (tên Văn Phòng AI) lưu dữ liệu ở .vanphong/ – đổi tên một lần thành .jvcompany/ để giữ khoá bí mật, ảnh đính kèm, phiên đăng nhập. */
async function migrateLegacyDataDir() {
  if (process.env.JVCOMPANY_DATA_DIR) return;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const legacy = path.join(process.cwd(), '.vanphong');
  const current = path.join(process.cwd(), '.jvcompany');
  if (!fs.existsSync(legacy) || fs.existsSync(current)) return;
  try {
    fs.renameSync(legacy, current);
    console.log('[jvcompany] Đã chuyển thư mục dữ liệu .vanphong/ → .jvcompany/');
  } catch (err) {
    console.error('[jvcompany] Không chuyển được thư mục dữ liệu cũ .vanphong/:', err);
  }
}
