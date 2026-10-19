import type { Spectrum, ObjectRow, CalibrationRow, ChartStyle } from '../domain/types';
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(value: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}
export interface Experiment {
  id: string;
  projectId?: string;
  name: string;
  createdAt: string;
  conditions: Record<string, string>;
  spectra: Spectrum[];
  objects: ObjectRow[];
  calibration: CalibrationRow[];
  chartStyles: Record<string, ChartStyle>;
  rawFileIds: string[];
}
export interface Project {
  id: string;
  name: string;
  description: string;
  experimentIds: string[];
  literatureIds: string[];
}
export interface Literature {
  id: string;
  title: string;
  authors: string[];
  journal: string;
  year: number;
  doi?: string;
  pdfAssetId?: string;
  tags: string[];
  metrics: Record<string, string>;
}
export interface LabRepositories {
  experiments: Repository<Experiment>;
  projects: Repository<Project>;
  literature: Repository<Literature>;
}
// No remote implementation in MVP. Supply HTTP/IndexedDB adapters here later.
