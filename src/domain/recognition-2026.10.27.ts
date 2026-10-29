import { defaultStyle, palette, uid, type ChartStyle } from './types';

export type Preprocessing = 'center' | 'zscore';
export type RecognitionChart = 'scores' | 'loadings' | 'tree' | 'heatmap';
export interface Probe { id: string; name: string; color: string; selected: boolean }
export interface BlankBatch { id: string; name: string; values: Record<string, string> }
export interface RecognitionRow {
  id: string; sample: string; ion: string; replicate: string; batchId: string;
  values: Record<string, string>;
}
export interface RecognitionSettings {
  preprocessing: Preprocessing;
  decimals: number;
  pcX: number; pcY: number;
  cutMode: 'count' | 'height'; clusterCount: number; cutHeight: string;
  heatmap: 'q' | 'zscore';
  shape: 'circle' | 'square' | 'triangle' | 'diamond';
  opacity: number; labels: boolean;
  ionShapes?: Record<string, RecognitionSettings['shape']>;
  chartLayout?: 'single' | 'paired';
  paperStyleVersion?: 1;
  ionColors: Record<string, string>; clusterColors: Record<string, string>;
  heatColors: { negative: string; zero: string; positive: string };
  styles: Record<RecognitionChart, ChartStyle>;
}
export interface AnalysisTable { name: string; headers: string[]; rows: (string | number | null)[][] }
export interface RecognitionData {
  schema: 1;
  /** Missing only on legacy sheets whose values contain F rather than q. */
  inputMode?: 'q';
  demo: boolean;
  probes: Probe[]; batches: BlankBatch[]; rows: RecognitionRow[];
  intensitySource?: { probes: Probe[]; batches: BlankBatch[]; rows: RecognitionRow[] };
  settings: RecognitionSettings;
  snapshot?: {
    table: AnalysisTable; sourceSheetId: string; sourceName: string;
    sourceFingerprint: string; capturedAt: string;
  };
}
export const RECOGNITION_LIMITS = { samples: 500, probes: 24 };
export const preprocessingLabel = (mode: Preprocessing) => mode === 'center'
  ? '仅中心化' : '中心化＋Z-score 标准化（样本标准差，ddof=1）';
export function defaultRecognition(): RecognitionData {
  const style = (xLabel: string, yLabel: string): ChartStyle => ({
    ...defaultStyle('spectra'), xLabel, yLabel, points: true, fontFamily: 'Perovskite Lab Sans',
  });
  return {
    schema: 1, inputMode: 'q', demo: false,
    probes: [0, 1, 2].map((i) => ({ id: `probe-${i + 1}`, name: `探针 ${i + 1}`, color: palette[i], selected: true })),
    batches: [], rows: [],
    settings: {
      preprocessing: 'zscore', decimals: 4, pcX: 0, pcY: 1,
      cutMode: 'count', clusterCount: 2, cutHeight: '', heatmap: 'q',
      shape: 'circle', opacity: 0.85, labels: false, ionShapes: {}, chartLayout: 'single', paperStyleVersion: 1,
      ionColors: {}, clusterColors: {},
      heatColors: { negative: '#3b6eb0', zero: '#ffffff', positive: '#c84b45' },
      styles: {
        scores: { ...style('PC1', 'PC2'), grid: false, legend: 'none', lineWidth: 1.1, fontFamily: 'Arial' },
        loadings: style('PC1', 'PC2'),
        tree: { ...style('Ward 合并高度', '离子'), grid: false, legend: 'none', lineWidth: 1.1, fontFamily: 'Arial' },
        heatmap: style('探针', '样本 / 离子 / 平行编号'),
      },
    },
  };
}
/** Explicitly synthetic, fixed quenching rates; never a source of PCA coordinates. */
export function demoRecognition(): RecognitionData {
  const d = defaultRecognition();
  d.demo = true;
  const q = [[0.74, 0.19, 0.35], [0.71, 0.21, 0.38], [0.17, 0.76, 0.30], [0.20, 0.72, 0.33], [-0.21, 0.10, 0.78], [-0.18, 0.13, 0.75]];
  d.rows = q.map((values, i) => ({
    id: uid(), sample: `演示-${Math.floor(i / 2) + 1}`, ion: ['Fe³⁺', 'CO₃²⁻', 'Cu²⁺'][Math.floor(i / 2)],
    replicate: String(i % 2 + 1), batchId: '',
    values: Object.fromEntries(d.probes.map((p, j) => [p.id, String(values[j])])),
  }));
  return d;
}
export const finiteValue = (s: string | undefined): number | null => {
  if (typeof s !== 'string' || !s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** Bare numbers are q; an explicit percent sign represents Q (%). */
export function quenchingValue(s: string | undefined): number | null {
  if (typeof s !== 'string') return null;
  const text = s.trim(), percent = /[%％]$/.test(text);
  const value = finiteValue(percent ? text.slice(0, -1) : text);
  return value === null ? null : percent ? value / 100 : value;
}
export interface CellIssue {
  table: 'raw' | 'blank'; row: number; column: number; reason: string;
  probeId?: string; blocking: boolean;
}
export interface Responses { q: (number | null)[][]; issues: CellIssue[] }
/** Never zip measurements from different rows. All lookups use immutable probe / batch IDs. */
export function quenching(d: RecognitionData): Responses {
  const issues: CellIssue[] = [];
  if (d.inputMode === 'q') {
    const keys = new Set<string>();
    const q = d.rows.map((row, r) => {
      [row.sample, row.ion, row.replicate].forEach((v, c) => {
        if (!v.trim()) issues.push({ table: 'raw', row: r, column: c, blocking: true,
          reason: `${['样本 ID', '离子种类', '平行编号'][c]}不能为空；请明确同一行的实验对应关系` });
      });
      const key = JSON.stringify([row.sample.trim(), row.replicate.trim()]);
      if (keys.has(key)) issues.push({ table: 'raw', row: r, column: 2, blocking: true,
        reason: '样本 ID＋平行编号重复，请使用唯一的实验编号' });
      keys.add(key);
      return d.probes.map((probe, c) => {
        const value = quenchingValue(row.values[probe.id]);
        if (value === null) issues.push({ table: 'raw', row: r, column: c + 3,
          probeId: probe.id, blocking: probe.selected,
          reason: `${probe.name}：猝灭率必须为有限数值，可输入 0.74 或 74%；空值不能按零处理` });
        return value;
      });
    });
    return { q, issues };
  }
  const invalidBlanks = new Set<string>();
  const batchNames = d.batches.map((b) => b.name.trim());
  batchNames.forEach((name, row) => {
    if (!name || batchNames.filter((other) => other === name).length > 1)
      issues.push({ table: 'blank', row, column: 0, blocking: true, reason: '批次名称不能为空或重复，避免粘贴时匹配到错误批次' });
  });
  d.batches.forEach((batch, r) => d.probes.forEach((probe, c) => {
    const f0 = finiteValue(batch.values[probe.id]);
    if (f0 === null || f0 <= 0) {
      invalidBlanks.add(`${batch.id}/${probe.id}`);
      issues.push({ table: 'blank', row: r, column: c + 1, probeId: probe.id,
        reason: `${batch.name} / ${probe.name}：F₀ 必须为有限正数，不能留空`,
        blocking: probe.selected && d.rows.some((row) => row.batchId === batch.id) });
    }
  }));
  const keys = new Set<string>();
  const q = d.rows.map((row, r) => {
    [row.sample, row.ion, row.replicate].forEach((v, c) => {
      if (!v.trim()) issues.push({ table: 'raw', row: r, column: c, blocking: true,
        reason: `${['样本 ID', '离子种类', '平行编号'][c]}不能为空；请明确同一行的实验对应关系` });
    });
    const key = JSON.stringify([row.sample.trim(), row.replicate.trim()]);
    if (keys.has(key)) issues.push({ table: 'raw', row: r, column: 2, blocking: true,
      reason: '样本 ID＋平行编号重复，请使用唯一的实验编号' });
    keys.add(key);
    const batch = d.batches.find((b) => b.id === row.batchId);
    if (!batch) issues.push({ table: 'raw', row: r, column: 3, blocking: true, reason: '请选择有效的空白批次' });
    return d.probes.map((probe, c) => {
      const f = finiteValue(row.values[probe.id]);
      if (f === null) issues.push({ table: 'raw', row: r, column: c + 4,
        probeId: probe.id, blocking: probe.selected, reason: `${probe.name}：F 必须为有限数值，空值不能按零处理` });
      const f0 = batch ? finiteValue(batch.values[probe.id]) : null;
      if (batch && invalidBlanks.has(`${batch.id}/${probe.id}`))
        issues.push({ table: 'raw', row: r, column: c + 4, probeId: probe.id,
          blocking: probe.selected, reason: `${probe.name} 关联的 ${batch.name} 空白值无效，请修正空白表` });
      if (f === null || f0 === null || f0 <= 0) return null;
      const value = (f0 - f) / f0;
      if (!Number.isFinite(value)) {
        issues.push({ table: 'raw', row: r, column: c + 4, probeId: probe.id, blocking: probe.selected,
          reason: '猝灭率超出有限数值范围，请检查 F 和 F₀ 的数量级' });
        return null;
      }
      return value;
    });
  });
  return { q, issues };
}
/** Convert legacy F/F₀ once, retaining an independent copy of every source record. */
export function asQuenchingInput(d: RecognitionData): RecognitionData {
  // Upgrade presentation once, keeping every measurement and numerical setting intact.
  if (!d.settings.paperStyleVersion) {
    const scores = d.settings.styles.scores, tree = d.settings.styles.tree;
    const typography = { fontFamily: scores.fontFamily, fontSize: scores.fontSize,
      lineWidth: scores.lineWidth === 2.4 ? 1.1 : scores.lineWidth };
    d = { ...d, settings: { ...d.settings, paperStyleVersion: 1, styles: { ...d.settings.styles,
      scores: { ...scores, ...typography, grid: false, legend: 'none', axes: { ...scores.axes,
        top: { ...scores.axes?.top, visible: false }, right: { ...scores.axes?.right, visible: false } } },
      tree: { ...tree, ...typography, grid: false, legend: 'none',
        xLabel: tree.xLabel === '样本 / 离子 / 平行编号' ? 'Ward 合并高度' : tree.xLabel,
        yLabel: tree.yLabel === 'Ward 距离' ? '离子' : tree.yLabel },
    } } };
  }
  if (d.inputMode === 'q') return d;
  const { q } = quenching(d);
  return { ...d, inputMode: 'q', batches: [],
    intensitySource: structuredClone({ probes: d.probes, batches: d.batches, rows: d.rows }),
    rows: d.rows.map((row, i) => ({ ...row, batchId: '',
      values: Object.fromEntries(d.probes.map((p, j) => [p.id, q[i][j] === null ? '' : String(q[i][j])])),
    })),
  };
}
export interface PreparedMatrix { matrix: number[][]; means: number[]; scales: number[] }
export function preprocess(matrix: number[][], mode: Preprocessing): PreparedMatrix {
  const n = matrix.length, p = matrix[0]?.length ?? 0;
  if (n < 2) throw new Error('至少需要 2 行有效样本 / 平行实验');
  if (!p || matrix.some((row) => row.length !== p || row.some((v) => !Number.isFinite(v))))
    throw new Error('响应矩阵必须为完整的有限数值矩阵');
  const means = Array.from({ length: p }, (_, j) => matrix.reduce((s, row) => s + row[j] / n, 0));
  const centered = matrix.map((row) => row.map((v, j) => v - means[j]));
  const deviations = means.map((_, j) => Math.hypot(...centered.map((row) => row[j])) / Math.sqrt(n - 1));
  deviations.forEach((sd, j) => {
    // Repeated decimal inputs can leave a rounding residual after centering.
    if (sd === 0 || matrix.every((row) => row[j] === matrix[0][j]))
      throw new Error(`第 ${j + 1} 个所选探针为零方差列，请取消选择或补充有差异的数据`);
    if (!Number.isFinite(sd)) throw new Error('数值范围过大，无法可靠计算方差');
  });
  const scales = deviations.map((sd) => mode === 'zscore' ? sd : 1);
  const result = centered.map((row) => row.map((v, j) => v / scales[j]));
  if (result.some((row) => row.some((v) => !Number.isFinite(v)))) throw new Error('预处理产生非有限数值');
  return { matrix: result, means, scales };
}
export interface PCAResult {
  eigenvalues: number[]; explained: number[]; cumulative: number[];
  scores: number[][]; loadings: number[][]; rank: number;
}
/** Symmetric Jacobi eigensolver on XᵀX/(n−1); eigenvectors are unit-length loadings. */
export function pca(matrix: number[][]): PCAResult {
  const n = matrix.length, p = matrix[0]?.length ?? 0;
  if (n < 2 || p < 2) throw new Error('PCA 至少需要 2 行样本和 2 个有效探针');
  if (matrix.some((row) => row.length !== p || row.some((x) => !Number.isFinite(x))))
    throw new Error('PCA 输入必须为完整的有限数值矩阵');
  const a = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) =>
    matrix.reduce((s, row) => s + row[i] * row[j] / (n - 1), 0)));
  if (a.some((row) => row.some((v) => !Number.isFinite(v)))) throw new Error('协方差矩阵超出有限数值范围');
  const v: number[][] = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => +(i === j)));
  const norm = Math.max(...a.flat().map(Math.abs));
  if (!(norm > 0)) throw new Error('响应矩阵为零秩，无法计算 PCA');
  // Scale before rotation, so convergence and rank tests are relative to the data.
  a.forEach((row) => row.forEach((x, j) => { row[j] = x / norm; }));
  let converged = false;
  for (let iteration = 0; iteration < 100 * p * p; iteration++) {
    let i = 0, j = 1, largest = 0;
    for (let r = 0; r < p; r++) for (let c = r + 1; c < p; c++)
      if (Math.abs(a[r][c]) > largest) { largest = Math.abs(a[r][c]); i = r; j = c; }
    if (largest < 1e-14) { converged = true; break; }
    const angle = 0.5 * Math.atan2(2 * a[i][j], a[j][j] - a[i][i]);
    const c = Math.cos(angle), s = Math.sin(angle), x = a[i][i], y = a[j][j], z = a[i][j];
    for (let k = 0; k < p; k++) if (k !== i && k !== j) {
      const ki = a[k][i], kj = a[k][j];
      a[k][i] = a[i][k] = c * ki - s * kj;
      a[k][j] = a[j][k] = s * ki + c * kj;
    }
    a[i][i] = c * c * x - 2 * s * c * z + s * s * y;
    a[j][j] = s * s * x + 2 * s * c * z + c * c * y;
    a[i][j] = a[j][i] = 0;
    for (let k = 0; k < p; k++) {
      const ki = v[k][i], kj = v[k][j];
      v[k][i] = c * ki - s * kj; v[k][j] = s * ki + c * kj;
    }
  }
  if (!converged) throw new Error('PCA 特征分解未收敛，请检查数据数量级');
  const order = Array.from({ length: p }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  const threshold = a[order[0]][order[0]] * Math.max(n, p) * Number.EPSILON * 100;
  const valid = order.filter((i) => a[i][i] > threshold).slice(0, Math.min(n - 1, p));
  if (!valid.length) throw new Error('响应矩阵秩不足，无法计算有效主成分');
  const eigenvalues = valid.map((i) => a[i][i] * norm);
  const total = order.reduce((s, i) => s + Math.max(0, a[i][i] * norm), 0);
  const loadings = v.map((row) => valid.map((i) => row[i]));
  // Deterministic orientation only; the mathematical sign remains arbitrary.
  valid.forEach((_, c) => {
    const pivot = loadings.reduce((best, row, i) => Math.abs(row[c]) > Math.abs(loadings[best][c]) ? i : best, 0);
    if (loadings[pivot][c] < 0) loadings.forEach((row) => { row[c] *= -1; });
  });
  const scores = matrix.map((row) => valid.map((_, c) => row.reduce((s, x, j) => s + x * loadings[j][c], 0)));
  const explained = eigenvalues.map((x) => x / total);
  let cumulative = 0;
  return { eigenvalues, explained, cumulative: explained.map((x) => cumulative += x), scores, loadings, rank: valid.length };
}
export interface Merge { left: number; right: number; height: number; size: number }
export interface Hierarchy { merges: Merge[]; order: number[]; size: number }
/** Euclidean + Ward, SciPy-compatible distance recurrence. No labels enter this function. */
export function ward(matrix: number[][]): Hierarchy {
  const n = matrix.length;
  if (n < 2) throw new Error('聚类至少需要 2 个样本');
  const p = matrix[0].length;
  if (!p || matrix.some((row) => row.length !== p || row.some((x) => !Number.isFinite(x))))
    throw new Error('聚类输入必须为完整的有限数值矩阵');
  const size = Array(2 * n - 1).fill(1), active = new Set(Array.from({ length: n }, (_, i) => i));
  const distances = new Map<number, number>();
  const stride = 2 * n;
  const key = (i: number, j: number) => Math.min(i, j) * stride + Math.max(i, j);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const distance = Math.hypot(...matrix[i].map((x, k) => x - matrix[j][k]));
    if (!Number.isFinite(distance)) throw new Error('聚类距离不是有限数值，请检查数据数量级');
    distances.set(key(i, j), distance);
  }
  const merges: Merge[] = [];
  for (let step = 0; step < n - 1; step++) {
    let left = -1, right = -1, height = Infinity;
    const nodes = [...active].sort((a, b) => a - b);
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const distance = distances.get(key(nodes[a], nodes[b]))!;
      if (distance < height) { height = distance; left = nodes[a]; right = nodes[b]; }
    }
    if (left < 0) throw new Error('Ward 聚类未找到有限距离');
    const id = n + step;
    size[id] = size[left] + size[right];
    active.delete(left); active.delete(right);
    for (const other of active) {
      const total = size[id] + size[other];
      // Normalize the recurrence before squaring to avoid overflow.
      const a = distances.get(key(other, left))!, b = distances.get(key(other, right))!;
      const scale = Math.max(a, b, height);
      const squared = scale === 0 ? 0 : ((size[other] + size[left]) * (a / scale) ** 2
        + (size[other] + size[right]) * (b / scale) ** 2 - size[other] * (height / scale) ** 2) / total;
      const distance = scale * Math.sqrt(Math.max(0, squared));
      if (!Number.isFinite(distance)) throw new Error('Ward 更新距离超出有限数值范围');
      distances.set(key(other, id), distance);
    }
    active.add(id);
    merges.push({ left, right, height, size: size[id] });
  }
  const order: number[] = [];
  const visit = (id: number) => {
    if (id < n) order.push(id);
    else { const m = merges[id - n]; visit(m.left); visit(m.right); }
  };
  visit(2 * n - 2);
  return { merges, order, size: n };
}
export function cutHierarchy(h: Hierarchy, mode: 'count' | 'height', value: number): number[] {
  if (!Number.isFinite(value) || (mode === 'count'
    ? !Number.isInteger(value) || value < 1 || value > h.size : value < 0))
    throw new Error(mode === 'count' ? `聚类数须为 1–${h.size} 的整数` : '截断高度须为有限非负数');
  const groups = new Map<number, number[]>(Array.from({ length: h.size }, (_, i) => [i, [i]]));
  for (let i = 0; i < h.merges.length; i++) {
    const merge = h.merges[i];
    if (mode === 'count' ? groups.size <= value : merge.height > value) break;
    groups.set(h.size + i, [...groups.get(merge.left)!, ...groups.get(merge.right)!]);
    groups.delete(merge.left); groups.delete(merge.right);
  }
  const labels = Array(h.size).fill(0);
  [...groups.values()].sort((a, b) => Math.min(...a) - Math.min(...b)).forEach((group, i) =>
    group.forEach((row) => { labels[row] = i + 1; }));
  return labels;
}
export interface RecognitionAnalysis extends Responses {
  selected: Probe[]; prepared?: PreparedMatrix; standardized?: number[][];
  pca?: PCAResult; hierarchy?: Hierarchy; clusters?: number[];
  errors: string[]; warnings: string[];
}
export function analyzeRecognition(d: RecognitionData): RecognitionAnalysis {
  const responses = quenching(d), selected = d.probes.filter((p) => p.selected);
  const result: RecognitionAnalysis = { ...responses, selected, errors: [], warnings: [] };
  const names = d.probes.map((p) => p.name.trim());
  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    result.errors.push('探针名称不能为空或重复，请在探针管理中修正'); return result;
  }
  if (responses.issues.some((issue) => issue.blocking)) { result.errors.push('存在缺失或无效数据，请修正已定位的单元格'); return result; }
  if (selected.length < 2) { result.errors.push('至少选择 2 个探针进行识别分析'); return result; }
  if (d.rows.length > RECOGNITION_LIMITS.samples || selected.length > RECOGNITION_LIMITS.probes) {
    result.errors.push(`单 Sheet 最多分析 ${RECOGNITION_LIMITS.samples} 行、${RECOGNITION_LIMITS.probes} 个探针，请拆分工作表`); return result;
  }
  const indices = selected.map((p) => d.probes.findIndex((probe) => probe.id === p.id));
  const matrix = responses.q.map((row) => indices.map((i) => row[i]!));
  try {
    result.prepared = preprocess(matrix, d.settings.preprocessing);
    result.standardized = d.settings.preprocessing === 'zscore' ? result.prepared.matrix : preprocess(matrix, 'zscore').matrix;
    result.pca = pca(result.prepared.matrix);
    result.hierarchy = ward(result.prepared.matrix);
    // A count larger than n is invalid; do not silently change the requested cut.
    result.clusters = cutHierarchy(result.hierarchy, d.settings.cutMode,
      d.settings.cutMode === 'count' ? d.settings.clusterCount : finiteValue(d.settings.cutHeight) ?? NaN);
    if (result.pca.rank < Math.min(selected.length, d.rows.length - 1))
      result.warnings.push(`矩阵秩不足：仅有 ${result.pca.rank} 个有效主成分，其余主成分不生成`);
    if (result.pca.rank < 2) result.warnings.push('仅有 1 个有效主成分，无法绘制二维得分 / 载荷图；请查看数值表');
  } catch (e) {
    // Clear every derived result on failure; never leave an earlier chart visible.
    result.errors.push((e as Error).message);
    delete result.prepared; delete result.standardized; delete result.pca; delete result.hierarchy; delete result.clusters;
  }
  return result;
}
/** Numeric provenance only: names, label colors and chart styles cannot alter the calculation. */
export function recognitionFingerprint(d: RecognitionData): string {
  const input = asQuenchingInput(d);
  return JSON.stringify({ probes: input.probes.map((p) => [p.id, p.selected]),
    rows: input.rows.map((r) => [r.id, input.probes.map((p) => r.values[p.id] ?? '')]),
    preprocessing: input.settings.preprocessing, cut: [input.settings.cutMode, input.settings.clusterCount, input.settings.cutHeight] });
}
const recognitionPalette = [...palette];
function defaultIonColor(index: number): string {
  // Extend the existing eight colors instead of cycling them for larger ion panels.
  while (recognitionPalette.length <= index) {
    const i = recognitionPalette.length;
    let hue = ((i - palette.length) * 137.508 + 20) % 360;
    const lightness = 0.4 + Math.floor((i - palette.length) / 24) % 3 * 0.06;
    let color: string;
    do {
      const a = 0.62 * Math.min(lightness, 1 - lightness);
      color = '#' + [0, 8, 4].map((offset) => {
        const k = (offset + hue / 30) % 12;
        return Math.round((lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
          .toString(16).padStart(2, '0');
      }).join('');
      hue = (hue + 0.5) % 360;
    } while (recognitionPalette.includes(color));
    recognitionPalette.push(color);
  }
  return recognitionPalette[index];
}
export const ionColor = (d: RecognitionData, ion: string) => d.settings.ionColors[ion]
  ?? defaultIonColor(Math.max(0, [...new Set(d.rows.map((r) => r.ion))].indexOf(ion)));
export const clusterColor = (d: RecognitionData, cluster: number) => d.settings.clusterColors[String(cluster)]
  ?? palette[(cluster - 1) % palette.length];

export function addProbe(d: RecognitionData, index = d.probes.length): RecognitionData {
  if (d.probes.length >= RECOGNITION_LIMITS.probes) throw new Error(`每个 Sheet 最多 ${RECOGNITION_LIMITS.probes} 个探针`);
  let number = 1;
  while (d.probes.some((p) => p.name === `探针 ${number}`)) number++;
  const probes = [...d.probes];
  probes.splice(Math.max(0, Math.min(index, probes.length)), 0,
    { id: uid(), name: `探针 ${number}`, color: palette[d.probes.length % palette.length], selected: true });
  return { ...d, probes };
}
export function removeProbe(d: RecognitionData, id: string): RecognitionData {
  const omit = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([key]) => key !== id));
  return { ...d, probes: d.probes.filter((p) => p.id !== id),
    rows: d.rows.map((r) => ({ ...r, values: omit(r.values) })),
    batches: d.batches.map((b) => ({ ...b, values: omit(b.values) })) };
}
export function moveProbe(d: RecognitionData, from: number, to: number): RecognitionData {
  if (from < 0 || to < 0 || from >= d.probes.length || to >= d.probes.length) return d;
  const probes = [...d.probes]; probes.splice(to, 0, probes.splice(from, 1)[0]);
  return { ...d, probes };
}
