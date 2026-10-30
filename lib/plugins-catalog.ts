// Thư viện kỹ năng dựng sẵn + gói plugin (bộ kỹ năng + kết nối dịch vụ + phòng nên dùng), cài một chạm.
// Dùng chung cho server (cài) và giao diện (trang Kho kỹ năng & plugin). Câu tiếng Việt là khoá dịch (lib/i18n).
import { localize, m } from './i18n';

export type SkillCategory = 'design' | 'security' | 'engineering' | 'testing' | 'ops' | 'content' | 'product' | 'data';

export const SKILL_CATEGORIES = localize<Record<SkillCategory, string>>({
  design: 'Thiết kế',
  security: 'Bảo mật',
  engineering: 'Lập trình',
  testing: 'Kiểm thử',
  ops: 'Vận hành',
  content: 'Nội dung',
  product: 'Sản phẩm',
  data: 'Dữ liệu',
});

export interface LibrarySkill {
  key: string;
  name: string;
  category: SkillCategory;
  /** Khi nào dùng (agent đọc để quyết định). */
  description: string;
  /** Phòng nên gán. */
  departments: string[];
  markdown: string;
}

const skill = (key: string, name: string, category: SkillCategory, description: string, departments: string[], body: string): LibrarySkill => ({
  key,
  name,
  category,
  description,
  departments,
  markdown: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`,
});

/** Nội dung kỹ năng giữ nguyên tiếng Việt (agent đọc); chỉ tên / mô tả hiển thị được dịch. */
const RAW_SKILLS: LibrarySkill[] = [
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('thiet-ke-giao-dien', m('Thiết kế giao diện nhất quán'), 'design', m('Dùng khi thiết kế hoặc dựng màn hình mới, chọn màu, chữ, khoảng cách, thành phần giao diện.'), ['studio', 'dev'], `
# Thiết kế giao diện nhất quán

## Trước khi vẽ
- Đọc hệ thống thiết kế sẵn có của dự án (biến màu, cỡ chữ, khoảng cách, thành phần chung). Dùng lại, không tự đặt giá trị mới.
- Xác định người dùng, việc chính họ cần làm trên màn hình và trạng thái dữ liệu: trống, đang tải, lỗi, nhiều dữ liệu.

## Nguyên tắc
1. **Phân cấp rõ:** mỗi màn hình một hành động chính nổi bật; hành động phụ nhẹ hơn.
2. **Lưới khoảng cách 4/8 px**; căn lề thẳng hàng; nhóm thứ liên quan gần nhau.
3. **Chữ:** tối đa 2 họ phông, 4–5 cỡ; dòng văn bản 45–80 ký tự.
4. **Màu:** màu nhấn chỉ cho hành động / trạng thái quan trọng; tương phản chữ ≥ 4.5:1.
5. **Trạng thái tương tác:** hover, focus (thấy được bằng bàn phím), disabled, đang xử lý.
6. **Đáp ứng:** kiểm tra 375 px, 768 px, 1280 px; không cuộn ngang.

## Bàn giao
- Liệt kê thành phần dùng lại / thành phần mới, biến thiết kế, các trạng thái, ảnh chụp từng khổ màn hình.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('kiem-tra-tro-nang', m('Kiểm tra trợ năng (WCAG 2.1 AA)'), 'design', m('Dùng khi rà soát khả năng truy cập: tương phản, bàn phím, trình đọc màn hình, cỡ vùng bấm.'), ['studio', 'qa', 'tester'], `
# Kiểm tra trợ năng (WCAG 2.1 AA)

## Danh sách kiểm tra
- [ ] Tương phản chữ thường ≥ 4.5:1, chữ lớn / biểu tượng ≥ 3:1.
- [ ] Dùng được hoàn toàn bằng bàn phím: Tab theo thứ tự hợp lý, thấy vòng focus, không kẹt focus, Esc đóng hộp thoại.
- [ ] Ảnh có \`alt\` (ảnh trang trí: \`alt=""\`); biểu tượng-nút có \`aria-label\`.
- [ ] Ô nhập có nhãn gắn với ô; lỗi được đọc lên (aria-live / aria-describedby) và nói cách sửa.
- [ ] Tiêu đề h1–h6 đúng thứ bậc; vùng trang (header, nav, main) rõ ràng.
- [ ] Vùng bấm ≥ 24×24 px (nên 44×44 trên điện thoại).
- [ ] Không chỉ dùng màu để truyền thông tin; tôn trọng \`prefers-reduced-motion\`.
- [ ] Phóng to 200% không vỡ bố cục.

## Báo cáo
Mỗi lỗi: vị trí, tiêu chí WCAG, mức độ (chặn / nghiêm trọng / nhỏ), cách sửa cụ thể.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('danh-gia-thiet-ke', m('Góp ý thiết kế có cấu trúc'), 'design', m('Dùng khi được nhờ nhận xét một màn hình, bản mẫu hoặc ảnh chụp giao diện.'), ['studio', 'director'], `
# Góp ý thiết kế có cấu trúc

Nhận xét theo thứ tự, mỗi mục nêu **điều thấy được → vì sao quan trọng → đề xuất**:
1. **Mục tiêu:** màn hình có giúp người dùng làm xong việc chính nhanh không?
2. **Phân cấp & bố cục:** mắt đi đâu trước? Có thứ gì tranh chú ý?
3. **Nội dung:** chữ có rõ, ngắn, đúng giọng sản phẩm?
4. **Nhất quán:** có lệch hệ thống thiết kế (màu, cỡ, khoảng cách, thành phần)?
5. **Trạng thái biên:** trống, lỗi, dữ liệu dài, mạng chậm.
6. **Trợ năng:** tương phản, bàn phím, nhãn.

Kết thúc bằng 3 thay đổi đáng làm nhất, xếp theo tác động.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('ra-soat-bao-mat', m('Rà soát bảo mật mã nguồn'), 'security', m('Dùng khi review thay đổi mã, API mới, xử lý đăng nhập, dữ liệu người dùng hoặc trước khi phát hành.'), ['qa', 'engineering', 'dev'], `
# Rà soát bảo mật mã nguồn

## Trọng tâm (theo OWASP Top 10)
- **Kiểm soát truy cập:** mọi API kiểm tra người dùng và quyền ở phía máy chủ; không tin id từ client.
- **Tiêm mã:** truy vấn có tham số (SQL/NoSQL), không ghép chuỗi lệnh shell, escape dữ liệu khi hiển thị (XSS).
- **Xác thực & phiên:** băm mật khẩu (scrypt/argon2/bcrypt), cookie HttpOnly + SameSite, giới hạn số lần thử.
- **Bí mật:** không có khoá / token trong mã, log, thông báo lỗi trả về client.
- **Dữ liệu nhạy cảm:** chỉ trả trường cần thiết; mã hoá khi lưu nếu cần.
- **SSRF / tải tệp:** kiểm tra địa chỉ gọi ra ngoài, loại và kích thước tệp, đường dẫn (không cho "../").
- **Cấu hình:** CORS chặt, header bảo mật, tắt chế độ debug khi chạy thật.
- **Phụ thuộc:** gói có lỗ hổng đã biết.

## Cách báo cáo
Mỗi phát hiện: tệp:dòng, mức (nghiêm trọng / cao / trung bình / thấp), kịch bản khai thác ngắn, cách sửa. Không báo điều chưa chứng minh được – ghi rõ "nghi ngờ" nếu chưa chắc.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('bi-mat-va-phu-thuoc', m('Vệ sinh bí mật & thư viện'), 'security', m('Dùng khi kiểm tra rò rỉ khoá, cấu hình .env, cập nhật / kiểm tra lỗ hổng thư viện.'), ['engineering', 'dev', 'qa'], `
# Vệ sinh bí mật & thư viện

## Bí mật
1. Tìm khoá lộ trong mã và lịch sử: chuỗi giống \`sk-\`, \`ghp_\`, \`AKIA\`, \`-----BEGIN\`, \`password=\`.
2. \`.env*\` phải nằm trong \`.gitignore\`; có \`.env.example\` chỉ chứa tên biến.
3. Khoá đã lộ: **thu hồi và tạo khoá mới trước**, rồi mới xoá khỏi mã.

## Thư viện
1. Chạy công cụ kiểm tra của hệ sinh thái (\`npm audit\`, \`pip-audit\`, \`cargo audit\`…) – chỉ đọc báo cáo, không tự nâng cấp hàng loạt.
2. Ưu tiên lỗ hổng có đường khai thác thật trong dự án; ghi lý do nếu tạm chấp nhận.
3. Nâng cấp từng gói, chạy kiểm thử sau mỗi lần; cập nhật lockfile.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('mo-hinh-hoa-moi-de-doa', m('Mô hình hoá mối đe doạ (STRIDE)'), 'security', m('Dùng khi thiết kế tính năng mới có dữ liệu nhạy cảm, thanh toán, quyền hạn hoặc tích hợp bên ngoài.'), ['engineering', 'director'], `
# Mô hình hoá mối đe doạ (STRIDE)

1. Vẽ luồng dữ liệu: người dùng → client → API → dịch vụ / CSDL / bên thứ ba; đánh dấu ranh giới tin cậy.
2. Với mỗi thành phần, hỏi 6 câu STRIDE:
   - **S**poofing – giả mạo danh tính được không?
   - **T**ampering – sửa dữ liệu trên đường đi / khi lưu?
   - **R**epudiation – có nhật ký để truy vết?
   - **I**nformation disclosure – lộ dữ liệu?
   - **D**enial of service – làm sập / cạn tài nguyên?
   - **E**levation of privilege – leo quyền?
3. Ghi bảng: mối đe doạ · khả năng · tác động · biện pháp · người phụ trách.
4. Ưu tiên biện pháp rẻ mà chặn được nhiều (xác thực, kiểm tra quyền, giới hạn tần suất, nhật ký).
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('review-ma-nguon', m('Review mã nguồn'), 'engineering', m('Dùng khi xem xét một thay đổi mã (PR, diff) trước khi hợp nhất.'), ['qa', 'dev', 'engineering'], `
# Review mã nguồn

## Thứ tự xem
1. **Đúng yêu cầu?** Đọc mô tả / nhiệm vụ trước, rồi xem diff có làm đúng và đủ.
2. **Lỗi logic:** điều kiện biên, null/undefined, bất đồng bộ, xử lý lỗi, dữ liệu rỗng.
3. **Bảo mật & dữ liệu:** quyền, đầu vào người dùng, bí mật.
4. **Kiểm thử:** có test cho hành vi mới / lỗi đã sửa?
5. **Đọc hiểu:** tên rõ, hàm ngắn, không lặp, theo phong cách sẵn có.
6. **Hiệu năng:** vòng lặp gọi mạng / CSDL, truy vấn thiếu index.

## Ghi nhận xét
- Phân loại: **Bắt buộc sửa** / **Nên sửa** / **Gợi ý**.
- Mỗi nhận xét chỉ đúng chỗ (tệp:dòng) và đưa cách sửa.
- Kết luận: duyệt / cần sửa, kèm lý do ngắn.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('chien-luoc-kiem-thu', m('Chiến lược kiểm thử'), 'testing', m('Dùng khi lập kế hoạch kiểm thử, viết test hoặc quyết định cần kiểm tra gì trước khi phát hành.'), ['qa', 'tester', 'dev'], `
# Chiến lược kiểm thử

## Chọn loại test
- **Đơn vị:** logic thuần (tính toán, chuyển đổi, kiểm tra hợp lệ) – nhanh, nhiều.
- **Tích hợp:** API + CSDL thật / giả lập, luồng nhiều thành phần.
- **Đầu-cuối (E2E):** vài luồng quan trọng nhất của người dùng (đăng nhập, mua, tạo dữ liệu chính).

## Ca kiểm thử
Với mỗi tính năng: đường thành công · đầu vào sai · biên (rỗng, rất dài, 0, âm, trùng) · quyền (không đăng nhập, sai vai trò) · lỗi mạng / dịch vụ ngoài.

## Quy tắc
- Test độc lập, không phụ thuộc thứ tự; dữ liệu tự tạo và tự dọn.
- Sửa lỗi nào thì thêm test tái hiện lỗi đó trước.
- Báo cáo: số test, đạt / lỗi, lệnh để chạy lại, rủi ro chưa được kiểm.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('go-loi-co-he-thong', m('Gỡ lỗi có hệ thống'), 'testing', m('Dùng khi gặp lỗi khó, hành vi lạ, test chập chờn hoặc sự cố chưa rõ nguyên nhân.'), ['dev', 'bugfix', 'qa'], `
# Gỡ lỗi có hệ thống

1. **Tái hiện:** viết lại các bước chính xác; thu nhỏ đến ví dụ nhỏ nhất còn lỗi.
2. **Thu thập bằng chứng:** thông báo lỗi đầy đủ, stack trace, log quanh thời điểm, phiên bản, môi trường.
3. **Đặt giả thuyết** – mỗi lần một giả thuyết, kèm cách kiểm chứng rẻ nhất.
4. **Chia đôi:** git bisect, bật / tắt từng phần, so sánh môi trường chạy được và không chạy được.
5. **Sửa tận gốc**, không che triệu chứng (try/catch nuốt lỗi, tăng timeout).
6. **Chứng minh:** test tái hiện lỗi trước khi sửa phải đỏ, sau khi sửa phải xanh.
7. **Ghi lại:** nguyên nhân, cách sửa, cách phòng lặp lại.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('thiet-ke-api', m('Thiết kế API'), 'engineering', m('Dùng khi tạo hoặc sửa API (REST/JSON): đường dẫn, dữ liệu vào/ra, mã lỗi, phân trang.'), ['engineering', 'dev'], `
# Thiết kế API

- **Tài nguyên là danh từ số nhiều:** \`GET /projects\`, \`POST /projects\`, \`GET /projects/:id\`, \`PATCH /projects/:id\`.
- **Mã trạng thái đúng nghĩa:** 200/201/204; 400 dữ liệu sai; 401 chưa đăng nhập; 403 không có quyền; 404 không thấy; 409 xung đột; 422 không hợp lệ; 429 quá nhiều; 5xx lỗi máy chủ.
- **Lỗi có cấu trúc:** \`{ "error": "thông điệp cho người", "code": "MA_LOI", "details": {...} }\`.
- **Kiểm tra đầu vào ở máy chủ** (schema), trả lỗi chỉ rõ trường nào sai.
- **Phân trang:** \`?limit=&cursor=\` (ổn định hơn offset); trả \`nextCursor\`.
- **Lọc / sắp xếp** qua query, có giới hạn tối đa.
- **Tương thích ngược:** chỉ thêm trường; đổi nghĩa thì tạo phiên bản / trường mới.
- **Idempotency** cho thao tác tạo quan trọng (khoá Idempotency-Key).
- Viết ví dụ request / response cho mỗi đường dẫn.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('toi-uu-hieu-nang', m('Tối ưu hiệu năng web'), 'engineering', m('Dùng khi trang chậm, bundle lớn, API chậm hoặc cần cải thiện Core Web Vitals.'), ['dev', 'engineering'], `
# Tối ưu hiệu năng web

## Đo trước
Lighthouse / Web Vitals (LCP, INP, CLS), thời gian API, kích thước bundle. Ghi số liệu trước–sau.

## Phía trình duyệt
- Chia nhỏ mã, tải lười thành phần nặng (biểu đồ, 3D, trình soạn thảo).
- Ảnh đúng kích thước, định dạng hiện đại, \`loading="lazy"\`; đặt sẵn kích thước để tránh nhảy bố cục.
- Tránh render lại thừa: memo hoá, không tạo hàm / đối tượng mới mỗi lần render khi không cần.
- Danh sách dài: ảo hoá.

## Phía máy chủ
- Truy vấn có index; tránh N+1; chỉ lấy trường cần.
- Bộ nhớ đệm ngắn cho dữ liệu đọc nhiều; nén phản hồi.
- Công việc nặng chuyển sang hàng đợi nền.

Mỗi thay đổi: lý do, số liệu trước–sau, rủi ro.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('phat-hanh-an-toan', m('Phát hành an toàn'), 'ops', m('Dùng khi chuẩn bị triển khai / phát hành phiên bản mới lên môi trường thật.'), ['engineering', 'director', 'qa'], `
# Phát hành an toàn

## Trước khi phát hành
- [ ] Build và toàn bộ test đạt; không còn lỗi chặn.
- [ ] Thay đổi CSDL có kịch bản chuyển đổi **và** cách quay lại; đã thử trên bản sao dữ liệu.
- [ ] Biến môi trường / bí mật mới đã có ở môi trường đích.
- [ ] Ghi chú phát hành: thay đổi chính, ảnh hưởng người dùng, việc cần làm thủ công.
- [ ] Có kế hoạch quay lại phiên bản trước (rollback) và người trực.

## Khi phát hành
- Phát hành dần nếu được (một phần người dùng / cờ tính năng).
- Theo dõi lỗi, độ trễ, tỷ lệ thành công 15–30 phút đầu.

## Sau phát hành
- Xác nhận các luồng chính chạy đúng; cập nhật tài liệu; đóng các nhiệm vụ liên quan.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('bao-cao-su-co', m('Báo cáo sự cố (postmortem)'), 'ops', m('Dùng sau một sự cố / lỗi lớn để viết báo cáo nguyên nhân và hành động phòng ngừa.'), ['engineering', 'director'], `
# Báo cáo sự cố (không đổ lỗi)

1. **Tóm tắt:** chuyện gì, khi nào, ảnh hưởng ai, bao lâu.
2. **Dòng thời gian:** phát hiện → xử lý tạm → khắc phục (giờ:phút, nguồn bằng chứng).
3. **Nguyên nhân gốc:** hỏi "vì sao" nhiều lần đến khi gặp lỗ hổng quy trình / hệ thống, không dừng ở "ai làm sai".
4. **Điều làm tốt / chưa tốt** trong phát hiện và xử lý.
5. **Hành động:** mỗi việc có người phụ trách, hạn, cách kiểm chứng (giám sát, test, quy trình).
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('noi-dung-seo', m('Viết nội dung chuẩn SEO'), 'content', m('Dùng khi viết bài blog, trang đích, mô tả sản phẩm cần lên Google.'), ['content', 'marketing'], `
# Viết nội dung chuẩn SEO

1. **Ý định tìm kiếm:** người tìm muốn biết / mua / so sánh gì? Viết đúng ý đó trước tiên.
2. **Từ khoá chính** trong tiêu đề (≤ 60 ký tự), đoạn mở đầu, một tiêu đề phụ; từ khoá liên quan rải tự nhiên.
3. **Cấu trúc:** H1 duy nhất; H2/H3 rõ; đoạn ngắn 2–4 câu; danh sách, bảng khi so sánh.
4. **Thẻ mô tả** 140–160 ký tự, có lời kêu gọi.
5. **Ảnh** có alt mô tả; tên tệp có nghĩa.
6. **Liên kết** nội bộ tới trang liên quan; liên kết ngoài tới nguồn uy tín.
7. **Đáng tin:** số liệu có nguồn, tác giả, ngày cập nhật.
Không nhồi từ khoá, không chép nội dung nơi khác.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('viet-chu-giao-dien', m('Viết chữ trên giao diện'), 'content', m('Dùng khi đặt nhãn nút, thông báo lỗi, trạng thái trống, hướng dẫn ngắn trong ứng dụng.'), ['content', 'studio', 'dev'], `
# Viết chữ trên giao diện

- **Nút = động từ + đối tượng:** "Lưu dự án", "Gửi lời mời" (không "OK", "Xác nhận" chung chung).
- **Lỗi:** chuyện gì xảy ra + cách sửa, không đổ lỗi người dùng: "Mật khẩu cần ít nhất 8 ký tự."
- **Trạng thái trống:** vì sao trống + việc nên làm tiếp + một nút.
- **Hộp thoại xác nhận:** tiêu đề là câu hỏi cụ thể ("Xoá 3 tệp?"), nút ghi đúng hành động ("Xoá"), nói rõ có hoàn tác được không.
- Ngắn, xưng hô nhất quán, cùng một từ cho cùng một khái niệm trong toàn sản phẩm.
- Tránh thuật ngữ kỹ thuật khi người dùng không cần biết.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('viet-prd', m('Viết tài liệu yêu cầu sản phẩm (PRD)'), 'product', m('Dùng khi mô tả tính năng / sản phẩm mới trước khi thiết kế và lập trình.'), ['management', 'director', 'meeting'], `
# Tài liệu yêu cầu sản phẩm (PRD)

1. **Vấn đề:** ai gặp vấn đề gì, bằng chứng (phản hồi, số liệu).
2. **Mục tiêu & chỉ số thành công** (đo được) và phi mục tiêu (không làm gì).
3. **Người dùng & tình huống** sử dụng chính.
4. **Yêu cầu:** câu chuyện người dùng + tiêu chí chấp nhận (Given / When / Then); đánh dấu Bắt buộc / Nên có / Để sau.
5. **Trải nghiệm:** luồng màn hình, trạng thái biên.
6. **Ràng buộc:** kỹ thuật, pháp lý, thời hạn, ngân sách.
7. **Rủi ro & câu hỏi mở**, người quyết định.
8. **Kế hoạch ra mắt** và cách đo sau ra mắt.
`),
  // i18n-ignore – thân SKILL.md (agent đọc) giữ tiếng Việt; tên + mô tả hiển thị dịch qua m()
  skill('phan-tich-du-lieu', m('Phân tích dữ liệu & báo cáo'), 'data', m('Dùng khi cần trả lời câu hỏi kinh doanh bằng số liệu, làm báo cáo, dashboard.'), ['management', 'director', 'marketing'], `
# Phân tích dữ liệu & báo cáo

1. **Câu hỏi cụ thể** và quyết định sẽ dựa vào kết quả.
2. **Nguồn dữ liệu:** định nghĩa từng chỉ số (đếm gì, khoảng thời gian, loại trừ gì); kiểm tra thiếu / trùng / ngoại lai.
3. **Phân tích:** so sánh với kỳ trước / nhóm đối chứng; tách theo phân khúc; cẩn thận nhầm tương quan với nhân quả.
4. **Trình bày:** kết luận trước, số liệu sau; mỗi biểu đồ trả lời một câu hỏi; ghi nguồn và giới hạn.
5. **Đề xuất hành động** kèm mức tin cậy.
`),
];

/** Tên / mô tả được dịch theo ngôn ngữ giao diện (nội dung SKILL.md không có trong từ điển nên giữ nguyên). */
export const SKILL_LIBRARY: LibrarySkill[] = localize(RAW_SKILLS);

export function getLibrarySkill(key: string): LibrarySkill | undefined {
  return RAW_SKILLS.find((s) => s.key === key);
}

export interface PluginBundle {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  skills: string[];
  /** Kết nối từ danh bạ: không cần đăng nhập → cài luôn; cần token / OAuth → gợi ý thêm sau. */
  connectors: string[];
  /** Phòng được gán kỹ năng của gói. */
  departments: string[];
}

/** Gói dựng sẵn (bản gốc tiếng Việt – server dùng bản này khi cài để lưu tên gốc vào CSDL). */
const RAW_BUNDLES: PluginBundle[] = [
  {
    id: 'bo-thiet-ke',
    name: m('Bộ Thiết kế'),
    description: m('Hệ thống thiết kế, góp ý giao diện, kiểm tra trợ năng; kết nối Figma desktop.'),
    category: 'design',
    skills: ['thiet-ke-giao-dien', 'danh-gia-thiet-ke', 'kiem-tra-tro-nang', 'viet-chu-giao-dien'],
    connectors: ['figma-desktop', 'figma', 'canva'],
    departments: ['studio'],
  },
  {
    id: 'bo-bao-mat',
    name: m('Bộ Bảo mật'),
    description: m('Rà soát bảo mật mã nguồn theo OWASP, vệ sinh bí mật & thư viện, mô hình hoá mối đe doạ.'),
    category: 'security',
    skills: ['ra-soat-bao-mat', 'bi-mat-va-phu-thuoc', 'mo-hinh-hoa-moi-de-doa'],
    connectors: ['sentry'],
    departments: ['qa', 'engineering'],
  },
  {
    id: 'bo-ky-su',
    name: m('Bộ Kỹ sư phần mềm'),
    description: m('Review mã, thiết kế API, tối ưu hiệu năng, gỡ lỗi; tài liệu thư viện mới nhất qua Context7.'),
    category: 'engineering',
    skills: ['review-ma-nguon', 'thiet-ke-api', 'toi-uu-hieu-nang', 'go-loi-co-he-thong'],
    connectors: ['context7', 'github'],
    departments: ['dev', 'engineering', 'bugfix'],
  },
  {
    id: 'bo-kiem-thu',
    name: m('Bộ Kiểm thử & QA'),
    description: m('Chiến lược kiểm thử, gỡ lỗi có hệ thống, kiểm tra trợ năng; Playwright để thử trên trình duyệt thật.'),
    category: 'testing',
    skills: ['chien-luoc-kiem-thu', 'go-loi-co-he-thong', 'kiem-tra-tro-nang'],
    connectors: ['playwright'],
    departments: ['qa', 'tester'],
  },
  {
    id: 'bo-van-hanh',
    name: m('Bộ Vận hành'),
    description: m('Danh sách phát hành an toàn, báo cáo sự cố, vệ sinh bí mật.'),
    category: 'ops',
    skills: ['phat-hanh-an-toan', 'bao-cao-su-co', 'bi-mat-va-phu-thuoc'],
    connectors: ['vercel', 'sentry'],
    departments: ['engineering'],
  },
  {
    id: 'bo-noi-dung',
    name: m('Bộ Nội dung & SEO'),
    description: m('Viết nội dung chuẩn SEO, chữ trên giao diện; tìm kiếm web qua Brave.'),
    category: 'content',
    skills: ['noi-dung-seo', 'viet-chu-giao-dien'],
    connectors: ['brave-search', 'notion'],
    departments: ['content', 'marketing'],
  },
  {
    id: 'bo-san-pham',
    name: m('Bộ Sản phẩm & Dữ liệu'),
    description: m('Viết PRD, phân tích dữ liệu & báo cáo; kết nối Linear, Notion.'),
    category: 'product',
    skills: ['viet-prd', 'phan-tich-du-lieu'],
    connectors: ['linear', 'notion', 'supabase'],
    departments: ['management', 'director'],
  },
];

/** Gói hiển thị trên giao diện: tên / mô tả dịch theo ngôn ngữ. */
export const PLUGIN_BUNDLES: PluginBundle[] = localize(RAW_BUNDLES);

export function getPluginBundle(id: string): PluginBundle | undefined {
  return RAW_BUNDLES.find((b) => b.id === id);
}
