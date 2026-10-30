'use client';
// Giới thiệu tính năng & hướng dẫn sử dụng. Mỗi mục kèm ảnh chụp màn hình thật trong public/guide/
// (chụp lại bằng: npx electron scripts/guide-screenshots.cjs – khi app đang chạy).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Crown,
  FolderKanban,
  Inbox,
  Lightbulb,
  ListChecks,
  Moon,
  PlugZap,
  Rocket,
  Settings,
  ShieldCheck,
  Briefcase,
  Users,
  Wallet,
  X,
  CircleHelp,
  Activity,
} from 'lucide-react';
import { Page, PageHeader } from '@/components/shell';
import { Card } from '@/components/ui';
import { m, t } from '@/lib/i18n';

// Mọi câu bên dưới là khoá dịch (m) – dịch lúc hiển thị bằng t(). Tên nút / trang trong câu đánh dấu <b>…</b>,
// mã lệnh đánh dấu <code>…</code>; <Rich> đổi các dấu này thành chữ đậm / mã.
interface Shot {
  src: string;
  caption: string;
}

interface Section {
  id: string;
  icon: typeof Rocket;
  title: string;
  lead: string;
  steps?: string[];
  tips?: string[];
  shots: Shot[];
  link?: { href: string; label: string };
}

const shot = (name: string, caption: string): Shot => ({ src: `/guide/${name}.jpg`, caption });

const FEATURES: { icon: typeof Rocket; title: string; text: string }[] = [
  { icon: Building2, title: m('Toà nhà 3D trực tiếp'), text: m('Nhân viên AI đi lại, ngồi vào bàn, gõ code theo đúng việc đang chạy – nhìn là biết ai đang làm gì.') },
  { icon: Crown, title: m('CEO tổng giao việc'), text: m('Nhắn một câu, CEO tạo dự án và giao cho tầng đang trống. 5 tầng = 5 dự án chạy song song.') },
  { icon: PlugZap, title: m('Nhiều kết nối AI'), text: m('Claude Code, Codex, Gemini, DeepSeek, OpenRouter, agent bên ngoài… kèm hạn mức gói, token và chi phí.') },
  { icon: ShieldCheck, title: m('Bạn nắm quyền quyết định'), text: m('Phân quyền theo dự án, phê duyệt việc vượt quyền, duyệt kết quả nhiều bước, câu hỏi gửi thẳng cho bạn.') },
  { icon: Wallet, title: m('Chi phí trong tầm kiểm soát'), text: m('Ghi token và chi phí từng lượt chạy, ngân sách theo công ty / phòng / dự án, tự dừng khi vượt.') },
  { icon: CalendarClock, title: m('Tự động hoá'), text: m('Lịch định kỳ, heartbeat, kỹ năng, kết nối dịch vụ (MCP, GitHub, Notion) và kênh chat Telegram.') },
];

const SECTIONS: Section[] = [
  {
    id: 'start',
    icon: Rocket,
    title: m('Bắt đầu trong 5 phút'),
    lead: m('Lần đầu mở ứng dụng, màn hình thiết lập 4 bước sẽ hướng dẫn bạn: đặt tên công ty → chọn đội ngũ → kết nối mô hình AI → bắt đầu. Sau đó, mọi thứ diễn ra ở trang Tổng quan và Văn phòng.'),
    steps: [
      m('Vào <b>Kết nối AI</b>, bấm <b>Quét máy tính</b> để tìm Claude Code, Codex, Gemini CLI… đã cài – hoặc <b>Thêm kết nối</b> bằng API key. Bấm <b>Kiểm tra môi trường</b> cho tới khi Đạt.'),
      m('Vào <b>Văn phòng</b>, mô tả việc cần làm trong khung <b>Trò chuyện</b>. CEO tổng tạo dự án và giao cho tầng đang trống.'),
      m('Xem các phòng ban làm việc trong toà nhà 3D – nhãn dưới mỗi nhân viên cho biết họ đang viết gì, sửa tệp nào.'),
      m('Trả lời câu hỏi, duyệt kết quả và phê duyệt việc vượt quyền trong <b>Hộp thư</b>.'),
    ],
    shots: [shot('overview', m('Tổng quan: toà nhà công ty, việc cần bạn quyết định và hoạt động trực tiếp.'))],
    link: { href: '/providers', label: m('Mở Kết nối AI') },
  },
  {
    id: 'office',
    icon: Building2,
    title: m('Toà nhà & trò chuyện với CEO'),
    lead: m('Mỗi tầng làm trọn một dự án. Khung trò chuyện bên phải luôn đi theo tầng bạn đang xem.'),
    steps: [
      m('Bấm số tầng (1–5) phía trên cảnh 3D để đi thang máy lên tầng đó; bấm biểu tượng toà nhà để xem toàn cảnh.'),
      m('Tầng đang làm dự án → khung chat mở đúng cuộc trò chuyện của dự án đó. Nhắn tiếp cho <b>Giám đốc tầng</b> hoặc chọn phòng khác ở nút <b>Gửi</b>.'),
      m('Tầng trống → cuộc trò chuyện mới: mô tả việc cần làm, CEO tổng giao cho chính tầng đó.'),
      m('Đang ở một cuộc trò chuyện mà muốn giao việc mới: chọn <b>CEO tổng</b> ở nút Gửi – việc mới đi tới tầng đang rảnh.'),
      m('Dán ảnh bằng Ctrl+V, chọn thư mục làm việc bằng nút Thư mục. Thanh dưới khung chat có Dừng / Tiếp tục / Chạy lại từ đầu.'),
    ],
    tips: [
      m('Bấm sàn để nhân vật của bạn (CEO) đi tới; bấm bàn bi-da, ghế lười, máy cà phê để dùng. Kéo để xoay, cuộn để phóng to.'),
      m('Kéo thanh giữa cảnh 3D và khung chat để đổi độ rộng; nút mở rộng ở đầu khung chat để đọc thoải mái hơn.'),
    ],
    shots: [
      shot('office', m('Tầng đang làm dự án: khung chat mở đúng cuộc trò chuyện của tầng.')),
      shot('office-new-chat', m('Tầng trống: CEO tổng sẽ giao việc mới cho chính tầng này.')),
    ],
    link: { href: '/office', label: m('Mở Văn phòng') },
  },
  {
    id: 'staff',
    icon: Users,
    title: m('Phòng ban & nhân sự'),
    lead: m('Mỗi phòng ban là một agent có vai trò, mô hình AI, quyền hạn và hướng dẫn riêng – dùng chung cho cả 5 tầng.'),
    steps: [
      m('Chuyển sang tab <b>Nhân sự</b> để xem mọi phòng ban, việc đang làm và số việc đã xong.'),
      m('Bấm một phòng (hoặc bấm nhân vật trong cảnh 3D) để sửa: kết nối AI và hạng mô hình (Cao cấp / Cân bằng / Nhanh), kết nối dự phòng, quyền hạn, lời nhắc hệ thống, kỹ năng.'),
      m('<b>Thêm phòng ban</b> khi cần chuyên môn mới, ví dụ Marketing, Dữ liệu, Pháp chế.'),
    ],
    shots: [shot('office-staff', m('Tab Nhân sự: các phòng ban, kết nối AI đang dùng và việc đang làm.'))],
  },
  {
    id: 'theme',
    icon: Moon,
    title: m('Giao diện sáng / tối'),
    lead: m('Đổi giao diện ở chân thanh menu: Sáng, Tối hoặc Theo hệ thống. Ở chế độ tối, văn phòng 3D bật đèn trần theo từng khu.'),
    steps: [m('Thu gọn thanh menu bằng nút ở góc trên của thanh để dành thêm chỗ cho cảnh 3D.'), m('Trên điện thoại, menu nằm ở thanh dưới cùng; các trang khác ở nút <b>Khác</b>.')],
    shots: [shot('office-dark', m('Văn phòng ban đêm: đèn trần, vùng sáng và đèn chiếu theo từng khu.'))],
  },
  {
    id: 'projects',
    icon: FolderKanban,
    title: m('Dự án'),
    lead: m('Mỗi dự án gắn với một thư mục trên máy. Mặc định dự án giao cho Giám đốc: giám đốc phân tích, chia việc cho các phòng theo chuỗi và tổng hợp kết quả.'),
    steps: [
      m('<b>Dự án mới</b>: chọn thư mục, đặt tên, mục tiêu và mô tả yêu cầu, chọn quy trình làm việc và mức quyền.'),
      m('Trang chi tiết dự án: tiến độ, nhiệm vụ của từng phòng, tệp trong thư mục, sản phẩm (tài liệu, báo cáo) và cài đặt dự án.'),
      m('Khi cả 5 tầng đều bận, dự án mới xếp hàng và tự lên tầng khi có tầng trống.'),
    ],
    shots: [
      shot('projects', m('Danh sách dự án và trạng thái.')),
      shot('project-new', m('Tạo dự án mới từ một thư mục trên máy.')),
      shot('project-detail', m('Chi tiết dự án: tiến độ, nhiệm vụ, tệp và sản phẩm.')),
    ],
    link: { href: '/projects', label: m('Mở Dự án') },
  },
  {
    id: 'tasks',
    icon: ListChecks,
    title: m('Nhiệm vụ'),
    lead: m('Mọi nhiệm vụ của các phòng trên tất cả dự án – mỗi việc có mã VP-n, mức ưu tiên và trạng thái.'),
    steps: [
      m('Lọc theo trạng thái, phòng ban hoặc dự án.'),
      m('Mở một nhiệm vụ để xem các lượt chạy (token, chi phí, lỗi), bình luận – agent được đánh thức khi có bình luận mới – và tài liệu có phiên bản.'),
      m('Việc có nhiều bước duyệt: duyệt để đi tiếp hoặc yêu cầu sửa kèm góp ý.'),
    ],
    shots: [shot('tasks', m('Toàn bộ nhiệm vụ, lọc theo trạng thái và phòng ban.'))],
    link: { href: '/tasks', label: m('Mở Nhiệm vụ') },
  },
  {
    id: 'inbox',
    icon: Inbox,
    title: m('Hộp thư & phê duyệt'),
    lead: m('Mọi thứ đang chờ bạn nằm ở một chỗ – số trên menu Hộp thư cho biết còn bao nhiêu việc.'),
    steps: [
      m('Hộp thư gom: phê duyệt, câu hỏi của agent, việc chờ duyệt, cảnh báo ngân sách, lượt chạy im lặng quá lâu và việc lỗi. Xử lý ngay hoặc mở chi tiết.'),
      m('<b>Phê duyệt</b>: khi agent muốn chạy lệnh, ghi tệp ngoài dự án hoặc điều khiển máy tính vượt quyền được cấp, yêu cầu sẽ chờ bạn – cùng các đề xuất tuyển nhân sự và vượt ngân sách.'),
    ],
    shots: [shot('inbox', m('Hộp thư: việc cần bạn xử lý.')), shot('approvals', m('Phê duyệt các yêu cầu vượt quyền.'))],
    link: { href: '/inbox', label: m('Mở Hộp thư') },
  },
  {
    id: 'providers',
    icon: PlugZap,
    title: m('Kết nối AI'),
    lead: m('Dùng gói đăng ký (Claude Pro/Max, ChatGPT…) qua CLI trên máy, API key (Anthropic, OpenAI, DeepSeek, OpenRouter, Gemini…), agent bên ngoài (Hermes, OpenClaw, webhook, Cursor Cloud) hoặc trình duyệt.'),
    steps: [
      m('<b>Quét máy tính</b> để tìm CLI đã cài; <b>Thêm kết nối</b> để nhập API key.'),
      m('<b>Kiểm tra môi trường</b> hiện từng mục Đạt / Cảnh báo / Lỗi kèm gợi ý sửa và lệnh để tự chạy thử.'),
      m('Mỗi thẻ cho thấy hạn mức gói (giới hạn 5 giờ / 7 ngày của Claude, số dư DeepSeek, OpenRouter), token và chi phí theo 5 giờ / hôm nay / 7 ngày / 30 ngày, model dùng nhiều nhất và phòng ban đang dùng.'),
      m('Hết hạn mức → kết nối tạm nghỉ và tự chạy lại khi tới giờ; phòng có kết nối dự phòng sẽ chuyển sang dùng tiếp.'),
    ],
    tips: [m('Đặt một kết nối làm Mặc định – các phòng để "Tự động" sẽ dùng kết nối đó.')],
    shots: [shot('providers', m('Kết nối AI: trạng thái, hạn mức gói, token và chi phí.'))],
    link: { href: '/providers', label: m('Mở Kết nối AI') },
  },
  {
    id: 'company',
    icon: Briefcase,
    title: m('Công ty'),
    lead: m('Thiết lập ở cấp công ty – trong nhóm Công ty của thanh menu. Mỗi công ty là một toà nhà riêng; đổi hoặc tạo công ty ở nút chọn công ty trên thanh menu.'),
    steps: [
      m('<b>Mục tiêu</b>: mục tiêu đo lường được dạng cây; dự án và nhiệm vụ gắn mục tiêu để agent hiểu vì sao phải làm.'),
      m('<b>Sơ đồ tổ chức</b>: ai báo cáo cho ai, trạng thái, heartbeat, ngân sách và kỹ năng của từng phòng.'),
      m('<b>Kỹ năng</b>: tệp SKILL.md gán cho phòng ban – agent đọc khi cần.'),
      m('<b>Kết nối dịch vụ</b>: GitHub, Notion, máy chủ MCP và kênh chat để nhắn văn phòng từ điện thoại.'),
      m('<b>Tài khoản & phân quyền</b>: nhiều người dùng với vai trò Chủ sở hữu / Quản trị / Thành viên / Chỉ xem.'),
      m('<b>Công ty & dữ liệu</b>: thông tin công ty, kho bí mật được mã hoá, đội mẫu dựng sẵn, xuất / nhập toàn bộ công ty.'),
    ],
    shots: [
      shot('goals', m('Mục tiêu')),
      shot('org', m('Sơ đồ tổ chức')),
      shot('skills', m('Kỹ năng')),
      shot('connections', m('Kết nối dịch vụ')),
      shot('accounts', m('Tài khoản & phân quyền')),
      shot('company', m('Công ty & dữ liệu')),
    ],
  },
  {
    id: 'ops',
    icon: Activity,
    title: m('Vận hành'),
    lead: m('Theo dõi và tự động hoá – trong nhóm Vận hành của thanh menu.'),
    steps: [
      m('<b>Lịch định kỳ</b>: tạo việc tự động theo lịch (cron theo múi giờ), webhook hoặc gọi API; dùng {{date}} và biến riêng trong tiêu đề.'),
      m('<b>Chi phí & ngân sách</b>: chi phí theo phòng, dự án, kết nối và model; đặt ngân sách tháng – cảnh báo ở 80%, chạm 100% thì tự tạm dừng và hỏi bạn.'),
      m('<b>Đánh giá agent</b>: lưu đầu vào mẫu cho từng phòng, chạy lại sau mỗi lần đổi lời nhắc, kỹ năng hay mô hình rồi so sánh kết quả.'),
      m('<b>Nhật ký hoạt động</b>: mọi thay đổi quan trọng – ai làm, làm gì, lúc nào.'),
    ],
    shots: [shot('routines', m('Lịch định kỳ')), shot('costs', m('Chi phí & ngân sách')), shot('evals', m('Đánh giá agent')), shot('activity', m('Nhật ký hoạt động'))],
  },
  {
    id: 'settings',
    icon: Settings,
    title: m('Cài đặt'),
    lead: m('Thiết lập chung cho cả văn phòng.'),
    steps: [
      m('<b>Toà nhà & tầng</b>: bật / tắt tầng để giảm số dự án chạy song song.'),
      m('<b>Tự động chạy lại khi hết hạn mức</b>, <b>Vận hành agent</b>, <b>Điều khiển máy tính</b> và <b>Quy trình làm việc</b> mặc định.'),
      m('<b>Hệ thống</b>: trạng thái cơ sở dữ liệu, worker và chạy lại màn hình thiết lập ban đầu.'),
    ],
    shots: [shot('settings', m('Cài đặt chung của văn phòng.'))],
    link: { href: '/settings', label: m('Mở Cài đặt') },
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: m('AI báo hết hạn mức thì sao?'),
    a: m('Văn phòng tự chờ tới giờ đặt lại rồi chạy tiếp – xem đồng hồ đếm ngược trên thẻ kết nối ở trang Kết nối AI. Thêm kết nối dự phòng cho phòng ban để không phải chờ.'),
  },
  {
    q: m('Agent có tự ý sửa lung tung trên máy tôi không?'),
    a: m('Mỗi dự án có mức quyền: chỉ đọc, đọc / ghi trong thư mục dự án, tự chạy lệnh trong dự án, hoặc toàn quyền. Việc vượt quyền phải chờ bạn phê duyệt.'),
  },
  { q: m('Chạy được bao nhiêu dự án cùng lúc?'), a: m('Bằng số tầng đang bật (mặc định 5). Dự án thêm vào sẽ xếp hàng và tự lên tầng khi có tầng trống.') },
  {
    q: m('Dữ liệu lưu ở đâu?'),
    a: m('Trong MongoDB trên máy bạn. Bí mật (API key, token) được mã hoá bằng khoá trong thư mục .vanphong – hãy sao lưu thư mục này cùng dữ liệu.'),
  },
  {
    q: m('Làm sao cập nhật ảnh trong trang này?'),
    a: m('Khi app đang chạy, mở terminal trong thư mục dự án và chạy <code>npx electron scripts/guide-screenshots.cjs</code>.'),
  },
];

const TOC = [{ id: 'intro', title: m('Giới thiệu'), icon: BookOpen }, ...SECTIONS.map((s) => ({ id: s.id, title: s.title, icon: s.icon })), { id: 'faq', title: m('Câu hỏi thường gặp'), icon: CircleHelp }];

/** Hiện câu đã dịch có đánh dấu <b>…</b> (tên nút / trang) và <code>…</code> (lệnh) thành chữ đậm / mã. */
function Rich({ text }: { text: string }) {
  // split có nhóm bắt: [chữ, thẻ, nội dung, chữ, thẻ, nội dung, …, chữ]
  const parts = text.split(/<(b|code)>(.*?)<\/\1>/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 3 === 1) return null;
        if (i % 3 === 0) return part;
        return parts[i - 1] === 'b' ? (
          <b key={i}>{part}</b>
        ) : (
          <code key={i} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px]">
            {part}
          </code>
        );
      })}
    </>
  );
}

/** Ảnh chụp có khung – bấm để phóng to. */
function Figure({ s, onOpen }: { s: Shot; onOpen: () => void }) {
  return (
    <figure className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        title={t('Bấm để phóng to')}
        className="group block w-full overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-sm transition hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <Image
          src={s.src}
          alt={t(s.caption)}
          width={1440}
          height={900}
          // Ảnh đã nén sẵn; app chạy ở 127.0.0.1 nên bộ tối ưu ảnh của Next từ chối địa chỉ nội bộ
          unoptimized
          loading="lazy"
          className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.015]"
        />
      </button>
      <figcaption className="mt-2 text-[12.5px] text-muted">{t(s.caption)}</figcaption>
    </figure>
  );
}

/** Xem ảnh lớn: ← → để chuyển ảnh, Esc để đóng. */
function Lightbox({ shots, index, onClose, onIndex }: { shots: Shot[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const go = useCallback((d: number) => onIndex((index + d + shots.length) % shots.length), [index, onIndex, shots.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);
  const s = shots[index];
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#14110e]/85 backdrop-blur-md" onClick={onClose} role="dialog" aria-modal="true" aria-label={t(s.caption)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-[#efe7da] sm:px-6">
        <span className="min-w-0 truncate">{t(s.caption)}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="tabular-nums opacity-70">
            {index + 1}/{shots.length}
          </span>
          <button type="button" aria-label={t('Đóng')} onClick={onClose} className="rounded-full p-2 hover:bg-white/10">
            <X className="size-5" />
          </button>
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-6 sm:px-16" onClick={(e) => e.stopPropagation()}>
        <Image key={s.src} src={s.src} alt={t(s.caption)} width={1440} height={900} unoptimized loading="eager" className="animate-vp-in h-auto max-h-full w-auto max-w-full rounded-xl shadow-2xl" />
        <button type="button" aria-label={t('Ảnh trước')} onClick={() => go(-1)} className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:left-4">
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" aria-label={t('Ảnh sau')} onClick={() => go(1)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:right-4">
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

/** Mục lục bám theo khi cuộn (máy tính). */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function SectionBlock({ s, n, onOpen }: { s: Section; n: number; onOpen: (src: string) => void }) {
  const Icon = s.icon;
  const many = s.shots.length > 2;
  const text = (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Icon className="size-5" />
        </span>
        <div>
          <div className="text-[11.5px] font-semibold tracking-[0.16em] text-subtle uppercase">{t('Phần {n}', { n })}</div>
          <h2 className="font-display text-[24px] leading-tight font-semibold tracking-tight">{t(s.title)}</h2>
        </div>
      </div>
      <p className="mt-4 text-[14.5px] leading-relaxed text-muted">{t(s.lead)}</p>
      {s.steps && (
        <ol className={clsx('mt-4 space-y-2.5', many && 'lg:grid lg:grid-cols-2 lg:gap-x-8 lg:gap-y-2.5 lg:space-y-0')}>
          {s.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold tabular-nums">{i + 1}</span>
              <span className="min-w-0">
                <Rich text={t(step)} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {s.tips && (
        <div className="mt-4 space-y-1.5 rounded-2xl border border-accent-3/25 bg-accent-3/8 px-4 py-3 text-[13px] leading-relaxed">
          {s.tips.map((tip, i) => (
            <div key={i} className="flex gap-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent-3" />
              <span>
                <Rich text={t(tip)} />
              </span>
            </div>
          ))}
        </div>
      )}
      {s.link && (
        <Link href={s.link.href} className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
          {t(s.link.label)}
          <ArrowRight className="size-4" />
        </Link>
      )}
    </div>
  );
  return (
    <section id={s.id} className="scroll-mt-6">
      <Card className="p-5 sm:p-7">
        {many ? (
          <>
            {text}
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {s.shots.map((sh) => (
                <Figure key={sh.src} s={sh} onOpen={() => onOpen(sh.src)} />
              ))}
            </div>
          </>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-8">
            {text}
            <div className="space-y-5">
              {s.shots.map((sh) => (
                <Figure key={sh.src} s={sh} onOpen={() => onOpen(sh.src)} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

export default function GuidePage() {
  const allShots = useMemo(() => SECTIONS.flatMap((s) => s.shots), []);
  const [viewing, setViewing] = useState<number | null>(null);
  const open = useCallback((src: string) => setViewing(allShots.findIndex((s) => s.src === src)), [allShots]);
  const ids = useMemo(() => TOC.map((item) => item.id), []);
  const active = useActiveSection(ids);

  return (
    <Page wide>
      <PageHeader
        eyebrow={t('Giới thiệu & hướng dẫn')}
        title={t('Hướng dẫn sử dụng')}
        description={t('Văn Phòng AI là một công ty phần mềm chạy bằng các AI agent. Trang này giới thiệu các tính năng và cách dùng từng phần – kèm ảnh chụp màn hình thật.')}
      />
      <div className="grid gap-8 xl:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <nav className="sticky top-6 space-y-0.5" aria-label={t('Mục lục')}>
            <div className="mb-2 px-3 text-[11.5px] font-semibold tracking-[0.16em] text-subtle uppercase">{t('Mục lục')}</div>
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={clsx(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition-colors',
                  active === item.id ? 'bg-surface-solid font-medium text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface-3 hover:text-fg',
                )}
              >
                <item.icon className={clsx('size-4 shrink-0', active === item.id && 'text-accent')} />
                <span className="truncate">{t(item.title)}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <section id="intro" className="scroll-mt-6">
            <Card className="p-5 sm:p-7">
              <h2 className="font-display text-[24px] font-semibold tracking-tight">{t('Văn Phòng AI là gì?')}</h2>
              <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-muted">
                {t(
                  'Mỗi phòng ban là một AI agent chuyên môn – Giám đốc, Quản lý dự án, Thiết kế, Kỹ sư, Kiểm thử… Bạn là chủ công ty: giao việc bằng một câu chat, các phòng tự chia việc, làm trực tiếp trong thư mục dự án trên máy bạn và chỉ hỏi bạn khi cần quyết định.',
                )}
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((f) => (
                  <div key={f.title} className="rounded-2xl border border-line bg-surface-2/50 p-4">
                    <f.icon className="size-5 text-accent" />
                    <div className="mt-2.5 text-[14px] font-semibold">{t(f.title)}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(f.text)}</p>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          {SECTIONS.map((s, i) => (
            <SectionBlock key={s.id} s={s} n={i + 1} onOpen={open} />
          ))}

          <section id="faq" className="scroll-mt-6">
            <Card className="p-5 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                  <CircleHelp className="size-5" />
                </span>
                <h2 className="font-display text-[24px] font-semibold tracking-tight">{t('Câu hỏi thường gặp')}</h2>
              </div>
              <div className="mt-5 divide-y divide-line">
                {FAQ.map((f) => (
                  <details key={f.q} className="group py-3.5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-medium">
                      {t(f.q)}
                      <ChevronRight className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="mt-2 text-[14px] leading-relaxed text-muted">
                      <Rich text={t(f.a)} />
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          </section>
          <p className="pb-4 text-center text-[12px] text-subtle">{t('Ảnh chụp từ chính văn phòng của bạn – tên dự án và tin nhắn trong ảnh là dữ liệu thật trên máy này.')}</p>
        </div>
      </div>
      {viewing !== null && viewing >= 0 && <Lightbox shots={allShots} index={viewing} onClose={() => setViewing(null)} onIndex={setViewing} />}
    </Page>
  );
}
