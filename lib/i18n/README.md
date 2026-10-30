# Đa ngôn ngữ (i18n)

Giao diện có 10 ngôn ngữ: English (mặc định cho người mới), Tiếng Việt, 简体中文, 日本語, 한국어, Español, Français, Deutsch, ไทย, Bahasa Indonesia.

## Cách hoạt động

- **Khoá dịch chính là câu tiếng Việt gốc.** Viết giao diện bằng tiếng Việt như trước, chỉ cần bọc: `t('Dự án mới')`.
  Tiếng Việt không cần từ điển; các ngôn ngữ khác tra trong `lib/i18n/messages/*.ts`.
- Lựa chọn lưu ở `localStorage['vp-lang']` + cookie `vp_lang`. Layout gốc (`app/layout.tsx`) đọc cookie, đặt `<html lang>`
  và chỉ gửi từ điển của ngôn ngữ đang chọn xuống `I18nProvider`. Đổi ngôn ngữ = lưu + tải lại trang (`changeLocale`).
- Không có cookie → tiếng Anh (`DEFAULT_LOCALE`).

## API (dùng được ở mọi nơi phía trình duyệt, không cần hook)

```ts
import { t, tc, m, localize, localizedContent, formatDate, formatNumber, intlLocale } from '@/lib/i18n';

t('Lưu')                                   // "Save"
t('{n} agent đang làm', { n: 3 })          // biến trong ngoặc nhọn – KHÔNG ghép chuỗi / template literal
tc('nav', 'Khác')                          // cùng câu nhưng dịch khác theo ngữ cảnh → khoá 'nav::Khác'
const TABS = localize([{ label: 'Tổng quan' }]) // hằng số cấp module: thuộc tính chuỗi tự dịch lúc đọc
const L = m('Tổng quan'); …; t(L)          // hoặc đánh dấu rồi dịch lúc hiển thị
localizedContent(msg.content, msg.meta)    // tin nhắn hệ thống do máy chủ tạo bằng sysMsg()
```

- **Không gọi `t()` ở cấp module** (chạy trước khi ngôn ngữ được đặt) – dùng `localize()` hoặc `m()`.
- Dữ liệu dựng sẵn trong CSDL (tên phòng ban, giai đoạn, tầng…) hiển thị qua `t(dept.name)`: có trong từ điển thì dịch, tên do người dùng đặt giữ nguyên.
- Số nhiều (trong bản dịch): `{n, plural, one {# task} other {# tasks}}`.
- Định dạng ngày/giờ/số: `lib/client/format.ts` (`timeAgo`, `dateTime`, `clock`) và `formatDate`/`formatNumber` tự theo ngôn ngữ.

## Phía máy chủ

- `lib/i18n/server.ts`: `requestLocale()` (cookie), `tl(locale, key, vars)`, `dictionary(locale)`. Không import từ mã trình duyệt.
- Lỗi API: `fail('Không tìm thấy dự án {id}', 404, { id })` hoặc `throw new LocalizedError(key, vars, status)` (`lib/server/http.ts`);
  giao diện dịch qua `lib/client/api.ts`. Lỗi tĩnh `fail(m('…'))` cũng tự dịch.
- Tin nhắn hệ thống trong chat: `sysMsg(key, vars)` (`lib/i18n/format.ts`) lưu `content` tiếng Việt + `meta.i18n` để giao diện dịch lại.
- Agent trả lời theo ngôn ngữ của dự án (`project.language`, lấy từ cookie khi người dùng gửi yêu cầu) hoặc `settings.language`.

## Thêm / sửa câu

1. Bọc câu bằng `t()`.
2. Thêm bản dịch vào tệp nhóm phù hợp trong `messages/` (một dòng mỗi câu, đủ 9 ngôn ngữ: en, zh, ja, ko, es, fr, de, th, id).
3. Chạy `node scripts/i18n-check.cjs` (hoặc `npm run i18n:check`): báo câu chưa bọc, khoá động, câu thiếu bản dịch.
   Bỏ qua một dòng có chủ ý: chú thích `i18n-ignore`.

## Thuật ngữ thống nhất

| Tiếng Việt | en | zh | ja | ko | es | fr | de | th | id |
|---|---|---|---|---|---|---|---|---|---|
| dự án | project | 项目 | プロジェクト | 프로젝트 | proyecto | projet | Projekt | โปรเจกต์ | proyek |
| nhiệm vụ | task | 任务 | タスク | 작업 | tarea | tâche | Aufgabe | งาน | tugas |
| phòng ban | department | 部门 | 部署 | 부서 | departamento | service | Abteilung | แผนก | departemen |
| giai đoạn | phase | 阶段 | フェーズ | 단계 | fase | phase | Phase | ระยะ | fase |
| quy trình | workflow | 工作流 | ワークフロー | 워크플로 | flujo de trabajo | workflow | Workflow | เวิร์กโฟลว์ | alur kerja |
| phê duyệt | approval / approve | 审批 / 批准 | 承認 | 승인 | aprobación / aprobar | approbation / approuver | Genehmigung / genehmigen | การอนุมัติ / อนุมัติ | persetujuan / setujui |
| giám đốc | director | 总监 | ディレクター | 디렉터 | director | directeur | Direktor | ผู้อำนวยการ | direktur |
| CEO tổng | Chief CEO | 总 CEO | 統括 CEO | 총괄 CEO | CEO general | PDG général | Haupt-CEO | CEO ใหญ่ | CEO utama |
| tầng / toà nhà / văn phòng | floor / building / office | 楼层 / 大楼 / 办公室 | フロア / ビル / オフィス | 층 / 건물 / 사무실 | planta / edificio / oficina | étage / bâtiment / bureau | Etage / Gebäude / Büro | ชั้น / อาคาร / สำนักงาน | lantai / gedung / kantor |
| agent | agent | 智能体 | エージェント | 에이전트 | agente | agent | Agent | เอเจนต์ | agen |
| kết nối AI / nhà cung cấp | AI connection / provider | AI 连接 / 提供商 | AI 接続 / プロバイダー | AI 연결 / 제공자 | conexión de IA / proveedor | connexion IA / fournisseur | KI-Verbindung / Anbieter | การเชื่อมต่อ AI / ผู้ให้บริการ | koneksi AI / penyedia |
| lượt chạy | run | 运行 | 実行 | 실행 | ejecución | exécution | Lauf | การรัน | eksekusi |
| hạn mức | quota / limit | 额度 | クォータ | 한도 | cuota | quota | Kontingent | โควตา | kuota |
| lịch định kỳ | routine | 定时任务 | 定期実行 | 루틴 | rutina | routine | Routine | งานตามกำหนดเวลา | rutinitas |
| mục tiêu / kỹ năng | goal / skill | 目标 / 技能 | 目標 / スキル | 목표 / 스킬 | objetivo / habilidad | objectif / compétence | Ziel / Fähigkeit | เป้าหมาย / ทักษะ | sasaran / keterampilan |
| ngân sách / chi phí | budget / cost | 预算 / 成本 | 予算 / コスト | 예산 / 비용 | presupuesto / coste | budget / coût | Budget / Kosten | งบประมาณ / ค่าใช้จ่าย | anggaran / biaya |
| hộp thư | inbox | 收件箱 | 受信箱 | 받은편지함 | bandeja de entrada | boîte de réception | Posteingang | กล่องข้อความ | kotak masuk |
| tài liệu | document | 文档 | ドキュメント | 문서 | documento | document | Dokument | เอกสาร | dokumen |
| đánh giá agent | agent evals | 智能体评测 | エージェント評価 | 에이전트 평가 | evaluaciones de agentes | évaluations d’agents | Agent-Evaluierungen | การประเมินเอเจนต์ | evaluasi agen |
| quyền (chỉ đọc / đọc & ghi / toàn quyền) | permission (read-only / read & write / full access) | 权限（只读 / 读写 / 完全控制） | 権限（読み取り専用 / 読み書き / フルアクセス） | 권한(읽기 전용 / 읽기·쓰기 / 전체 권한) | permiso (solo lectura / lectura y escritura / acceso total) | permission (lecture seule / lecture et écriture / accès complet) | Berechtigung (nur lesen / lesen & schreiben / Vollzugriff) | สิทธิ์ (อ่านอย่างเดียว / อ่านและเขียน / สิทธิ์เต็ม) | izin (hanya baca / baca & tulis / akses penuh) |

Giữ nguyên tên sản phẩm / kỹ thuật: Văn Phòng AI, Claude Code, Codex, MCP, API, CLI, token, Telegram, MongoDB, JSON…
