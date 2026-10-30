// Chuyển dữ liệu của bản cũ (tên Văn Phòng AI) sang tên JVCompany. Chỉ chạy trên Node.js (gọi từ instrumentation.ts).
import fs from 'fs';
import path from 'path';

/** Bản cũ lưu dữ liệu ở .vanphong/ – đổi tên một lần thành .jvcompany/ để giữ khoá bí mật, ảnh đính kèm, phiên đăng nhập. */
export function migrateLegacyDataDir() {
  if (process.env.JVCOMPANY_DATA_DIR) return;
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
