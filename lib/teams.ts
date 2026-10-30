// Đội mẫu (giống "team catalog" của Paperclip): bộ phòng ban dựng sẵn để bắt đầu nhanh hoặc cài thêm.
import { localize } from './i18n';

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  // i18n-ignore – kiểu dữ liệu (giá trị gốc tiếng Việt); nhãn hiển thị tự dịch qua localize()
  category: 'Cơ bản' | 'Phần mềm' | 'Sản phẩm' | 'Nội dung';
  /** Phòng ban trong đội (id phòng; phòng chưa có sẽ được tạo từ danh mục phòng mẫu). */
  departments: string[];
  /** Phòng đứng đầu đội. */
  lead: string;
  /** Kỹ năng gợi ý cho đội. */
  skills?: string[];
  /** Việc định kỳ gợi ý khi cài đội (tên + lịch cron). */
  routines?: { title: string; cron: string; department: string; instructions: string }[];
}

// Bọc localize(): tên / mô tả tự dịch lúc đọc ở giao diện (máy chủ giữ tiếng Việt – lịch định kỳ tạo ra vẫn bằng tiếng Việt).
export const TEAM_TEMPLATES: TeamTemplate[] = localize<TeamTemplate[]>([
  {
    id: 'full',
    name: 'Công ty phần mềm đầy đủ',
    description: 'Đủ 10 phòng: giám đốc, họp, quản lý, điều phối, studio, kỹ sư, dev, kiểm duyệt, test, fix bug.',
    category: 'Cơ bản',
    departments: ['director', 'meeting', 'management', 'coordination', 'studio', 'engineering', 'dev', 'qa', 'tester', 'bugfix'],
    lead: 'director',
  },
  {
    id: 'core-exec',
    name: 'Điều hành cốt lõi',
    description: 'Giám đốc, quản lý dự án, trưởng kỹ thuật và kiểm duyệt – gọn nhẹ, tự tuyển thêm khi cần.',
    category: 'Cơ bản',
    departments: ['director', 'management', 'engineering', 'qa'],
    lead: 'director',
    routines: [
      {
        title: 'Rà soát ưu tiên hằng tuần',
        cron: '0 9 * * 1',
        department: 'director',
        instructions: 'Rà soát các dự án và mục tiêu đang chạy, xác nhận việc quan trọng nhất tuần này và báo lại những gì thay đổi.',
      },
    ],
  },
  {
    id: 'product-engineering',
    name: 'Phát triển sản phẩm',
    description: 'Chuỗi làm phần mềm: lập kế hoạch → kiến trúc → code → test → sửa lỗi → kiểm duyệt.',
    category: 'Phần mềm',
    departments: ['director', 'management', 'engineering', 'dev', 'tester', 'bugfix', 'qa'],
    lead: 'director',
  },
  {
    id: 'product-design',
    name: 'Thiết kế sản phẩm',
    description: 'Thu thập yêu cầu, thiết kế giao diện / trải nghiệm, dựng bản mẫu và duyệt chất lượng.',
    category: 'Sản phẩm',
    departments: ['director', 'meeting', 'studio', 'dev', 'qa'],
    lead: 'director',
  },
  {
    id: 'content-machine',
    name: 'Nội dung & Marketing',
    description: 'Lên kế hoạch nội dung, viết bài / kịch bản, tối ưu SEO và lịch đăng mạng xã hội.',
    category: 'Nội dung',
    departments: ['director', 'content', 'marketing', 'qa'],
    lead: 'director',
    routines: [
      {
        title: 'Lên lịch nội dung tuần',
        cron: '0 8 * * 1',
        department: 'marketing',
        instructions: 'Đề xuất 5 chủ đề nội dung cho tuần này theo mục tiêu công ty, kèm kênh đăng và giờ đăng.',
      },
    ],
  },
  {
    id: 'solo',
    name: 'Một nhân sự',
    description: 'Chỉ một trợ lý (chánh văn phòng) – tự làm hoặc tuyển thêm người khi cần.',
    category: 'Cơ bản',
    departments: ['director'],
    lead: 'director',
  },
]);

export function getTeam(id: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.id === id);
}

/** Tên / biểu tượng của các phòng mẫu (để xem trước đội khi phòng chưa được tạo). */
export const DEPT_INFO: Record<string, { name: string; icon: string; color: string }> = localize({
  director: { name: 'Phòng Giám Đốc', icon: 'Crown', color: '#B8862B' },
  meeting: { name: 'Phòng Họp', icon: 'Users', color: '#4A86BD' },
  management: { name: 'Phòng Quản Lý', icon: 'ClipboardList', color: '#5C9A68' },
  coordination: { name: 'Phòng Điều Phối', icon: 'Network', color: '#8A7DAE' },
  studio: { name: 'Phòng Studio', icon: 'Palette', color: '#C46A8E' },
  engineering: { name: 'Phòng Kỹ Sư', icon: 'Cpu', color: '#4F8CFF' },
  dev: { name: 'Phòng Dev', icon: 'Code2', color: '#3E8E7E' },
  qa: { name: 'Phòng Kiểm Tra & Duyệt', icon: 'ShieldCheck', color: '#C9952F' },
  tester: { name: 'Phòng Test', icon: 'FlaskConical', color: '#CF6A3D' },
  bugfix: { name: 'Phòng Fix Bug', icon: 'Bug', color: '#A35A3A' },
  content: { name: 'Phòng Nội Dung', icon: 'BookOpen', color: '#8A6BB8' },
  marketing: { name: 'Phòng Marketing', icon: 'Megaphone', color: '#D9573B' },
});
