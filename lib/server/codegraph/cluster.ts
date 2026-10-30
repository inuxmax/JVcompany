// Bước 4 – chia đồ thị thành các phân hệ (community) bằng thuật toán Louvain (tối đa hoá modularity), không cần AI.
// Graphify dùng Leiden (hoặc Louvain của networkx khi không cài Leiden); đây là bản Louvain gọn cho đồ thị vô hướng có trọng số.

/** Đồ thị vô hướng: danh sách kề có trọng số theo chỉ số nút 0…n-1. */
export type Adjacency = Map<number, number>[];

/** Một vòng "di chuyển cục bộ": mỗi nút thử chuyển sang phân hệ của hàng xóm nếu modularity tăng. */
function localMoving(adj: Adjacency, resolution: number): { community: number[]; moved: boolean } {
  const n = adj.length;
  const community = Array.from({ length: n }, (_, i) => i);
  const k = adj.map((nb) => [...nb.values()].reduce((a, b) => a + b, 0));
  const m2 = k.reduce((a, b) => a + b, 0) || 1; // = 2m
  const tot = [...k];
  let moved = false;
  let improved = true;
  let rounds = 0;
  while (improved && rounds++ < 20) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const ci = community[i];
      // Trọng số từ i tới từng phân hệ lân cận
      const links = new Map<number, number>();
      for (const [j, w] of adj[i]) if (j !== i) links.set(community[j], (links.get(community[j]) ?? 0) + w);
      tot[ci] -= k[i];
      let best = ci;
      let bestGain = (links.get(ci) ?? 0) - (resolution * tot[ci] * k[i]) / m2;
      for (const [c, w] of links) {
        const gain = w - (resolution * tot[c] * k[i]) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          best = c;
        }
      }
      tot[best] += k[i];
      if (best !== ci) {
        community[i] = best;
        improved = true;
        moved = true;
      }
    }
  }
  return { community, moved };
}

/** Louvain nhiều tầng: di chuyển cục bộ → gộp phân hệ thành siêu nút → lặp lại. Trả về số phân hệ cho từng nút gốc. */
export function louvain(adj: Adjacency, resolution = 1): number[] {
  let membership = Array.from({ length: adj.length }, (_, i) => i);
  let graph = adj;
  for (let level = 0; level < 10; level++) {
    const { community, moved } = localMoving(graph, resolution);
    // Đánh số lại liên tục
    const remap = new Map<number, number>();
    for (const c of community) if (!remap.has(c)) remap.set(c, remap.size);
    membership = membership.map((c) => remap.get(community[c])!);
    if (!moved || remap.size === graph.length) break;
    const next: Adjacency = Array.from({ length: remap.size }, () => new Map());
    graph.forEach((nb, i) => {
      const ci = remap.get(community[i])!;
      for (const [j, w] of nb) {
        const cj = remap.get(community[j])!;
        next[ci].set(cj, (next[ci].get(cj) ?? 0) + w);
      }
    });
    graph = next;
  }
  return membership;
}
