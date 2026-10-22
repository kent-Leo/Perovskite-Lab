import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useWorkspace } from '../state/workspace';
import { activeSheetIdOf } from '../domain/workbook';
import { concentrationGradient, units, normalizeConcentrationUnit } from '../domain/math';
interface BrowserTool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
}
interface ModelContext {
  registerTool: (tool: BrowserTool, options: { signal: AbortSignal }) => void | Promise<void>;
}
// Optional standard-browser integration. Ordinary browsers do not need this API.
export function useLabTools() {
  const { w, update } = useWorkspace(),
    latest = useRef(w);
  latest.current = w;
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: BrowserTool) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(
          () => {},
        );
      } catch {
        /* unsupported experimental implementation */
      }
    };
    register({
      name: 'lab_read_workspace_summary',
      title: '读取实验工作区摘要',
      description:
        'Read the current local workspace counts and sample names without modifying data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (!input || typeof input !== 'object' || Object.keys(input).length)
          throw new Error('No input properties are accepted');
        const state = latest.current;
        return {
          demo: state.demo,
          spectra: state.spectra.map((s) => ({
            name: s.name,
            points: s.points.length,
            visible: s.visible,
          })),
          objects: state.objects.length,
          calibrationPoints: state.calibration.length,
          concentrationUnit: state.calUnit,
        };
      },
    });
    register({
      name: 'lab_configure_concentration_gradient',
      title: '设置浓度梯度',
      description:
        'Validate and update the visible concentration-gradient settings and return the dilution plan. This changes only the local workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          stock: { type: 'number', exclusiveMinimum: 0 },
          volumeML: { type: 'number', exclusiveMinimum: 0 },
          fixedML: { type: 'number', minimum: 0 },
          targets: {
            type: 'array',
            items: { type: 'number', minimum: 0 },
            minItems: 1,
            maxItems: 1000,
          },
          unit: { type: 'string', enum: units },
          targetUnit: { type: 'string', enum: units },
        },
        required: ['stock', 'volumeML', 'fixedML', 'targets', 'unit'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object') throw new Error('Invalid gradient input');
        const p = input as Record<string, unknown>;
        if (
          Object.keys(p).some(
            (k) => !['stock', 'volumeML', 'fixedML', 'targets', 'unit', 'targetUnit'].includes(k),
          ) ||
          typeof p.stock !== 'number' ||
          typeof p.volumeML !== 'number' ||
          typeof p.fixedML !== 'number' ||
          typeof p.unit !== 'string' ||
          !units.includes(normalizeConcentrationUnit(p.unit)) ||
          (p.targetUnit !== undefined && (typeof p.targetUnit !== 'string' || !units.includes(normalizeConcentrationUnit(p.targetUnit)))) ||
          !Array.isArray(p.targets) ||
          p.targets.length > 1000 ||
          p.targets.some((v) => typeof v !== 'number')
        )
          throw new Error('Invalid gradient input');
        const unit = normalizeConcentrationUnit(p.unit);
        const targetUnit = normalizeConcentrationUnit((p.targetUnit as string | undefined) ?? p.unit);
        const plan = concentrationGradient(p.stock, unit, p.volumeML, p.targets as number[], targetUnit, p.fixedML);
        flushSync(() =>
          update((prev) => {
            // 列头单位元数据按 sheet 存放：写入当前活动 gradient sheet。
            const sheetId = activeSheetIdOf(prev, 'gradient'),
              metadata = prev.sheetMetadata?.[sheetId];
            return {
              sheetMetadata: {
                ...prev.sheetMetadata,
                [sheetId]: {
                  ...metadata,
                  target: { ...metadata?.target, unit: targetUnit },
                },
              },
              gradient: {
                stock: String(p.stock),
                volume: String(p.volumeML),
                fixed: String(p.fixedML),
                targets: p.targets!.toString(),
                unit,
                targetUnit,
              },
            };
          }),
        );
        return { groups: plan.length, unit: targetUnit, stockUnit: unit, plan };
      },
    });
    return () => lifecycle.abort();
  }, [update]);
}
