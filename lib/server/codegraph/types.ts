// Đồ thị tri thức của mã nguồn (chuyển phần lõi của Graphify sang TypeScript): nút = tệp / hàm / lớp / khái niệm,
// cạnh = gọi / import / kế thừa / dùng… Mỗi cạnh ghi rõ độ tin cậy: EXTRACTED (có trực tiếp trong mã) hay INFERRED (suy ra).

export type NodeKind =
  | 'file'
  | 'doc'
  | 'section'
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'component'
  | 'const'
  | 'table'
  | 'rationale'
  | 'package';

export type Confidence = 'EXTRACTED' | 'INFERRED';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Đường dẫn tương đối (dấu /) tính từ thư mục dự án. */
  file?: string;
  line?: number;
  /** Phân hệ (Louvain); -1 = không xếp (gói bên ngoài). */
  community?: number;
  degree?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: Confidence;
}

/** Một câu lệnh import / include / liên kết tài liệu (đường dẫn chưa giải). */
export interface ImportRef {
  spec: string;
  line: number;
  /** Liên kết trong tài liệu Markdown (cạnh "references" thay vì "imports"). */
  link?: boolean;
}

/** Kết quả trích một tệp (trước khi gộp). `refs` = lời gọi / tham chiếu theo tên, gộp xong mới giải ra cạnh. */
export interface FileExtraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refs: { from: string; name: string; relation: string }[];
  imports: ImportRef[];
  /** Tên cục bộ → { module, tên được import } ('default' | '*' | tên). */
  bindings: Record<string, { spec: string; imported: string }>;
  /** Tên được export → id nút ('default' = export mặc định). */
  exports: Record<string, string>;
  language: string;
  chars: number;
}

export interface Community {
  id: number;
  label: string;
  size: number;
  /** Nút tiêu biểu (bậc cao nhất) của phân hệ. */
  top: string[];
  /** Thư mục chính. */
  dir: string;
}

export interface GraphStats {
  files: number;
  nodes: number;
  edges: number;
  communities: number;
  extractedPct: number;
  inferredPct: number;
  languages: Record<string, number>;
  /** Ước tính token nếu agent đọc toàn bộ mã (≈ 4 ký tự / token). */
  corpusTokens: number;
  /** Token của bản đồ mã đưa vào lời nhắc. */
  mapTokens: number;
  buildMs: number;
  /** Tệp bị bỏ qua vì vượt giới hạn. */
  skipped: number;
}

export interface CodeGraph {
  schemaVersion: 1;
  generator: 'vanphong-codegraph';
  root: string;
  builtAt: string;
  nodes: GraphNode[];
  links: GraphEdge[];
  communities: Community[];
  stats: GraphStats;
}
