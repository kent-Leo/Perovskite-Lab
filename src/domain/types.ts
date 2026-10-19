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
export interface ChartStyle {
  primaryColor?: string;
  secondaryColor?: string;
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
  dashed: boolean;
  legend: 'right' | 'bottom' | 'none';
  widthCm: number;
  dpi: 300 | 600;
}
export interface Series {
  name: string;
  color: string;
  points: Point[];
  kind?: 'line' | 'scatter' | 'bar';
  dashed?: boolean;
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
  title: kind === 'spectra' ? '' : kind === 'screening' ? 'Selectivity' : 'Calibration',
  xLabel:
    kind === 'spectra'
      ? 'Wavelength / nm'
      : kind === 'screening'
        ? 'Analysis object'
        : 'Concentration / μM',
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
  dashed: false,
  legend: kind === 'screening' ? 'none' : 'right',
  widthCm: 16,
  dpi: 300,
});
