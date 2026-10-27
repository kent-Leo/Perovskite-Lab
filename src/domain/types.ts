export type Role = 'blank' | 'target' | 'interferent' | 'control' | 'other';
export const roles: Record<Role, string> = {
  blank: '空白',
  target: '目标物',
  interferent: '干扰物',
  control: '对照',
  other: '其他',
};
export type ResponseMode = 'F' | 'ratio' | 'inverse' | 'quench' | 'percent';
export const responses: Record<ResponseMode, string> = {
  F: 'F',
  ratio: 'F/F₀',
  inverse: 'F₀/F',
  quench: '(F₀−F)/F₀',
  percent: '猝灭率 %',
};
export const palette = [
  '#157c65',
  '#5984c7',
  '#ca9945',
  '#bb6d93',
  '#795bb0',
  '#d46b48',
  '#488e9c',
  '#668446',
];
export interface Point {
  x: number;
  y: number;
  label?: string;
  tooltip?: string;
}
export interface Spectrum {
  id: string;
  name: string;
  role: Role;
  concentration: string;
  unit: string;
  color: string;
  visible: boolean;
  points: Point[];
  source: string;
}
// Per-column header metadata shared by every worksheet.
export interface ColumnMetadata {
  title?: string;
  unit?: string;
  comment?: string;
  color?: string;
}
export interface ObjectRow {
  id: string;
  name: string;
  role: Role;
  concentration: string;
  unit: string;
  intensity: string;
  notes: string;
}
export interface CalibrationRow {
  id: string;
  concentration: string;
  intensity: string;
  included: boolean;
}
export type AxisSide = 'bottom' | 'top' | 'left' | 'right';
export interface AxisStyle {
  visible: boolean;
  label: string;
  tickLabels: boolean;
  ticks: 'out' | 'in' | 'both' | 'none';
  tickLength: number;
  tickWidth: number;
  divisions: number;
}
export const axisSides: AxisSide[] = ['bottom', 'top', 'left', 'right'];
export const axisNames: Record<AxisSide, string> = {
  bottom: '下轴', top: '上轴', left: '左轴', right: '右轴',
};
// Older workspaces have no axes field; retain their bottom/left appearance.
export function chartAxes(style: ChartStyle): Record<AxisSide, AxisStyle> {
  return Object.fromEntries(axisSides.map((side) => [side, {
    visible: side === 'bottom' || side === 'left',
    tickLabels: true, ticks: 'out', tickLength: 5, tickWidth: 1.1, divisions: 5,
    ...style.axes?.[side],
    // Persisted partial axes may omit their title; blank titles remain valid.
    label: (side === 'bottom' ? style.xLabel : side === 'left' ? style.yLabel : style.axes?.[side]?.label) ?? '',
  }])) as Record<AxisSide, AxisStyle>;
}
export interface ChartStyle {
  axes?: Partial<Record<AxisSide, Partial<AxisStyle>>>;
  primaryColor?: string;
  secondaryColor?: string;
  /** Legacy shared chart title (v0.5.5 and earlier); v0.6.0 stores titles per sheet. */
  title: string;
  xLabel: string;
  yLabel: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  lineWidth: number;
  pointSize: number;
  fontSize: number;
  fontFamily: string;
  grid: boolean;
  points: boolean;
  // Show every data point's y value next to the mark (optional: older workspaces omit it).
  pointValues?: boolean;
  dashed: boolean;
  legend: 'right' | 'bottom' | 'free' | 'none';
  // Free legend position as a fraction of the canvas width/height.
  legendX?: number;
  legendY?: number;
  // Independent legend font size; falls back to fontSize when unset.
  legendFontSize?: number;
  widthCm: number;
  dpi: 300 | 600;
}
export interface Series {
  name: string;
  color: string;
  points: Point[];
  kind?: 'line' | 'scatter' | 'bar';
  dashed?: boolean;
  /** Set to false for derived lines (for example a fit) that are not measured data points. */
  showPointValues?: boolean;
  pointShape?: 'circle' | 'square' | 'triangle' | 'diamond';
  opacity?: number;
  labels?: boolean;
  arrows?: boolean;
}
export interface PlotData {
  series: Series[];
  categories?: string[];
  annotation?: string;
}
export const uid = () => crypto.randomUUID();
export const defaultStyle = (kind: 'spectra' | 'screening' | 'calibration'): ChartStyle => ({
  primaryColor: '#258873',
  secondaryColor: '#b6873f',
  // Empty by default: each sheet's own title (or the page default) fills it.
  title: '',
  xLabel:
    kind === 'spectra'
      ? 'Wavelength / nm'
      : kind === 'screening'
        ? 'Analysis object'
        : 'Concentration / µmol/L',
  yLabel:
    kind === 'calibration'
      ? '(F₀−F)/F₀'
      : kind === 'screening'
        ? 'F/F₀'
        : 'Fluorescence intensity / a.u.',
  xMin: '',
  xMax: '',
  yMin: '',
  yMax: '',
  lineWidth: 2.4,
  pointSize: 4,
  fontSize: 16,
  fontFamily: 'Arial',
  grid: false,
  points: false,
  pointValues: false,
  dashed: false,
  legend: kind === 'screening' ? 'none' : 'right',
  legendX: 0.72,
  legendY: 0.1,
  widthCm: 16,
  dpi: 300,
});

// ---- Workbook model shared by all four table areas (v0.5.5) ----
export type ImportKind = 'wide' | 'long' | 'objects' | 'calibration';
export interface SheetMapping {
  /** AI result sheets use empty intensities for masked or absent measurements. */
  allowEmptyIntensity?: boolean;
  kind: ImportKind;
  start: number;
  header: boolean;
  x: number;
  ys: number[];
  name: number;
  concentration: number;
  unit: string;
}
export interface GradientSettings {
  stock: string;
  volume: string;
  fixed: string;
  targets: string;
  unit: string;
  targetUnit?: string;
}
export type WorkbookId = 'raw' | 'screening' | 'calibration' | 'gradient' | 'recognition';
export interface WorkbookTab {
  id: string;
  name: string;
  /** Per-sheet chart title for the three plotting pages; empty/missing uses the page default. */
  chartTitle?: string;
}
