// Khung ứng dụng: menu điều hướng, trạng thái hệ thống, giao diện sáng/tối, chọn ngôn ngữ, định dạng thời gian.
import type { Catalog } from '../locales';

const messages: Catalog = {
  'Công ty phần mềm vận hành bởi các AI Agent chuyên môn – giao việc, phê duyệt, điều khiển máy tính.': { en: 'A software company run by specialist AI agents – assign work, approve, control your computer.', zh: '由专业 AI 智能体运营的软件公司——分派工作、审批、控制电脑。', ja: '専門 AI エージェントが運営するソフトウェア会社 – 作業の割り当て、承認、PC 操作。', ko: '전문 AI 에이전트가 운영하는 소프트웨어 회사 – 작업 배정, 승인, 컴퓨터 제어.', es: 'Una empresa de software dirigida por agentes de IA especializados: asigna trabajo, aprueba y controla tu ordenador.', fr: 'Une entreprise logicielle gérée par des agents IA spécialisés – confiez du travail, approuvez, pilotez votre ordinateur.', de: 'Ein Softwareunternehmen, betrieben von spezialisierten KI-Agents – Arbeit zuweisen, genehmigen, den Computer steuern.', th: 'บริษัทซอฟต์แวร์ที่ขับเคลื่อนด้วยเอเจนต์ AI เฉพาะทาง – มอบหมายงาน อนุมัติ ควบคุมคอมพิวเตอร์', id: 'Perusahaan perangkat lunak yang dijalankan agen AI spesialis – bagikan tugas, setujui, kendalikan komputer.' },
  'Công ty AI Agent': { en: 'AI agent company', zh: 'AI 智能体公司', ja: 'AI エージェント企業', ko: 'AI 에이전트 회사', es: 'Empresa de agentes IA', fr: 'Entreprise d’agents IA', de: 'KI-Agent-Firma', th: 'บริษัทเอเจนต์ AI', id: 'Perusahaan agen AI' },
  // Menu điều hướng
  'Điều hướng': { en: 'Navigation', zh: '导航', ja: 'ナビゲーション', ko: '탐색', es: 'Navegación', fr: 'Navigation', de: 'Navigation', th: 'การนำทาง', id: 'Navigasi' },
  'Tổng quan': { en: 'Overview', zh: '概览', ja: '概要', ko: '개요', es: 'Resumen', fr: 'Aperçu', de: 'Übersicht', th: 'ภาพรวม', id: 'Ringkasan' },
  'Hộp thư': { en: 'Inbox', zh: '收件箱', ja: '受信箱', ko: '받은편지함', es: 'Bandeja de entrada', fr: 'Boîte de réception', de: 'Posteingang', th: 'กล่องข้อความ', id: 'Kotak masuk' },
  'Văn phòng': { en: 'Office', zh: '办公室', ja: 'オフィス', ko: '사무실', es: 'Oficina', fr: 'Bureau', de: 'Büro', th: 'สำนักงาน', id: 'Kantor' },
  'Dự án': { en: 'Projects', zh: '项目', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyectos', fr: 'Projets', de: 'Projekte', th: 'โปรเจกต์', id: 'Proyek' },
  'Nhiệm vụ': { en: 'Tasks', zh: '任务', ja: 'タスク', ko: '작업', es: 'Tareas', fr: 'Tâches', de: 'Aufgaben', th: 'งาน', id: 'Tugas' },
  'Kết nối AI': { en: 'AI connections', zh: 'AI 连接', ja: 'AI 接続', ko: 'AI 연결', es: 'Conexiones de IA', fr: 'Connexions IA', de: 'KI-Verbindungen', th: 'การเชื่อมต่อ AI', id: 'Koneksi AI' },
  'Cài đặt': { en: 'Settings', zh: '设置', ja: '設定', ko: '설정', es: 'Ajustes', fr: 'Paramètres', de: 'Einstellungen', th: 'การตั้งค่า', id: 'Pengaturan' },
  'Hướng dẫn': { en: 'Guide', zh: '使用指南', ja: 'ガイド', ko: '가이드', es: 'Guía', fr: 'Guide', de: 'Anleitung', th: 'คู่มือ', id: 'Panduan' },
  'Công ty': { en: 'Company', zh: '公司', ja: '会社', ko: '회사', es: 'Empresa', fr: 'Entreprise', de: 'Unternehmen', th: 'บริษัท', id: 'Perusahaan' },
  'Sơ đồ tổ chức': { en: 'Org chart', zh: '组织架构', ja: '組織図', ko: '조직도', es: 'Organigrama', fr: 'Organigramme', de: 'Organigramm', th: 'ผังองค์กร', id: 'Bagan organisasi' },
  'Kết nối dịch vụ': { en: 'Service connections', zh: '服务连接', ja: 'サービス接続', ko: '서비스 연결', es: 'Conexiones de servicios', fr: 'Connexions de services', de: 'Dienstverbindungen', th: 'การเชื่อมต่อบริการ', id: 'Koneksi layanan' },
  'Tài khoản & phân quyền': { en: 'Accounts & permissions', zh: '账户与权限', ja: 'アカウントと権限', ko: '계정 및 권한', es: 'Cuentas y permisos', fr: 'Comptes et autorisations', de: 'Konten & Berechtigungen', th: 'บัญชีและสิทธิ์', id: 'Akun & izin' },
  'Công ty & dữ liệu': { en: 'Company & data', zh: '公司与数据', ja: '会社とデータ', ko: '회사 및 데이터', es: 'Empresa y datos', fr: 'Entreprise et données', de: 'Unternehmen & Daten', th: 'บริษัทและข้อมูล', id: 'Perusahaan & data' },
  'Vận hành': { en: 'Operations', zh: '运营', ja: '運用', ko: '운영', es: 'Operaciones', fr: 'Opérations', de: 'Betrieb', th: 'การดำเนินงาน', id: 'Operasional' },
  'Lịch định kỳ': { en: 'Routines', zh: '定时任务', ja: '定期実行', ko: '루틴', es: 'Rutinas', fr: 'Routines', de: 'Routinen', th: 'งานตามกำหนดเวลา', id: 'Rutinitas' },
  'Chi phí & ngân sách': { en: 'Costs & budgets', zh: '成本与预算', ja: 'コストと予算', ko: '비용 및 예산', es: 'Costes y presupuestos', fr: 'Coûts et budgets', de: 'Kosten & Budgets', th: 'ค่าใช้จ่ายและงบประมาณ', id: 'Biaya & anggaran' },
  'Đánh giá agent': { en: 'Agent evals', zh: '智能体评测', ja: 'エージェント評価', ko: '에이전트 평가', es: 'Evaluaciones de agentes', fr: 'Évaluations d’agents', de: 'Agent-Evaluierungen', th: 'การประเมินเอเจนต์', id: 'Evaluasi agen' },
  'Nhật ký hoạt động': { en: 'Activity log', zh: '活动日志', ja: 'アクティビティログ', ko: '활동 기록', es: 'Registro de actividad', fr: 'Journal d’activité', de: 'Aktivitätsprotokoll', th: 'บันทึกกิจกรรม', id: 'Log aktivitas' },
  'Dự án mới': { en: 'New project', zh: '新项目', ja: '新規プロジェクト', ko: '새 프로젝트', es: 'Nuevo proyecto', fr: 'Nouveau projet', de: 'Neues Projekt', th: 'โปรเจกต์ใหม่', id: 'Proyek baru' },
  'Mở rộng menu': { en: 'Expand menu', zh: '展开菜单', ja: 'メニューを展開', ko: '메뉴 펼치기', es: 'Expandir menú', fr: 'Déplier le menu', de: 'Menü ausklappen', th: 'ขยายเมนู', id: 'Bentangkan menu' },
  'Thu gọn menu': { en: 'Collapse menu', zh: '收起菜单', ja: 'メニューを折りたたむ', ko: '메뉴 접기', es: 'Contraer menú', fr: 'Replier le menu', de: 'Menü einklappen', th: 'ย่อเมนู', id: 'Ciutkan menu' },
  'new::Dự án': { en: 'Project', zh: '项目', ja: 'プロジェクト', ko: '프로젝트', es: 'Proyecto', fr: 'Projet', de: 'Projekt', th: 'โปรเจกต์', id: 'Proyek' },
  'nav::Khác': { en: 'More', zh: '更多', ja: 'その他', ko: '더보기', es: 'Más', fr: 'Plus', de: 'Mehr', th: 'เพิ่มเติม', id: 'Lainnya' },
  'nav::Thêm': { en: 'More', zh: '更多', ja: 'その他', ko: '더보기', es: 'Más', fr: 'Plus', de: 'Mehr', th: 'เพิ่มเติม', id: 'Lainnya' },
  // Trạng thái hệ thống
  'Trạng thái hệ thống': { en: 'System status', zh: '系统状态', ja: 'システムの状態', ko: '시스템 상태', es: 'Estado del sistema', fr: 'État du système', de: 'Systemstatus', th: 'สถานะระบบ', id: 'Status sistem' },
  'Hệ thống sẵn sàng': { en: 'System ready', zh: '系统就绪', ja: 'システム準備完了', ko: '시스템 준비됨', es: 'Sistema listo', fr: 'Système prêt', de: 'System bereit', th: 'ระบบพร้อม', id: 'Sistem siap' },
  'Kiểm tra hệ thống': { en: 'Check system', zh: '检查系统', ja: 'システムを確認', ko: '시스템 확인', es: 'Revisar sistema', fr: 'Vérifier le système', de: 'System prüfen', th: 'ตรวจสอบระบบ', id: 'Periksa sistem' },
  '{n} agent đang làm': { en: '{n, plural, one {# agent working} other {# agents working}}', zh: '{n} 个智能体工作中', ja: '{n} 体のエージェントが作業中', ko: '에이전트 {n}명 작업 중', es: '{n, plural, one {# agente trabajando} other {# agentes trabajando}}', fr: '{n, plural, one {# agent au travail} other {# agents au travail}}', de: '{n, plural, one {# Agent arbeitet} other {# Agents arbeiten}}', th: 'เอเจนต์ทำงานอยู่ {n} ตัว', id: '{n} agen sedang bekerja' },
  '{n} đang chạy': { en: '{n} running', zh: '{n} 个运行中', ja: '{n} 件実行中', ko: '{n}개 실행 중', es: '{n} en ejecución', fr: '{n} en cours', de: '{n} laufen', th: 'กำลังรัน {n}', id: '{n} berjalan' },
  'status::Tạm dừng': { en: 'Paused', zh: '已暂停', ja: '一時停止中', ko: '일시 중지됨', es: 'En pausa', fr: 'En pause', de: 'Pausiert', th: 'หยุดชั่วคราว', id: 'Dijeda' },
  'Đã kết nối': { en: 'Connected', zh: '已连接', ja: '接続済み', ko: '연결됨', es: 'Conectado', fr: 'Connecté', de: 'Verbunden', th: 'เชื่อมต่อแล้ว', id: 'Terhubung' },
  'Mất kết nối': { en: 'Disconnected', zh: '连接已断开', ja: '切断されました', ko: '연결 끊김', es: 'Desconectado', fr: 'Déconnecté', de: 'Getrennt', th: 'ขาดการเชื่อมต่อ', id: 'Terputus' },
  'Trực tuyến': { en: 'Online', zh: '在线', ja: 'オンライン', ko: '온라인', es: 'En línea', fr: 'En ligne', de: 'Online', th: 'ออนไลน์', id: 'Daring' },
  'Đang nối…': { en: 'Connecting…', zh: '连接中…', ja: '接続中…', ko: '연결 중…', es: 'Conectando…', fr: 'Connexion…', de: 'Verbinde…', th: 'กำลังเชื่อมต่อ…', id: 'Menghubungkan…' },
  // Giao diện & ngôn ngữ
  'Giao diện': { en: 'Appearance', zh: '外观', ja: '外観', ko: '화면 모드', es: 'Apariencia', fr: 'Apparence', de: 'Darstellung', th: 'ธีม', id: 'Tampilan' },
  'Sáng': { en: 'Light', zh: '浅色', ja: 'ライト', ko: '라이트', es: 'Claro', fr: 'Clair', de: 'Hell', th: 'สว่าง', id: 'Terang' },
  'Tối': { en: 'Dark', zh: '深色', ja: 'ダーク', ko: '다크', es: 'Oscuro', fr: 'Sombre', de: 'Dunkel', th: 'มืด', id: 'Gelap' },
  'Theo hệ thống': { en: 'Match system', zh: '跟随系统', ja: 'システムに合わせる', ko: '시스템 설정 따르기', es: 'Según el sistema', fr: 'Selon le système', de: 'Wie System', th: 'ตามระบบ', id: 'Ikuti sistem' },
  'Ngôn ngữ': { en: 'Language', zh: '语言', ja: '言語', ko: '언어', es: 'Idioma', fr: 'Langue', de: 'Sprache', th: 'ภาษา', id: 'Bahasa' },
  // Định dạng thời gian (lib/client/format.ts)
  'vừa xong': { en: 'just now', zh: '刚刚', ja: 'たった今', ko: '방금', es: 'ahora mismo', fr: 'à l’instant', de: 'gerade eben', th: 'เมื่อสักครู่', id: 'baru saja' },
};

export default messages;
