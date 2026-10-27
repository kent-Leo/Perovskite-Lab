import { describe, it, expect } from 'vitest';
import { concentrationGradient, convertConcentration, convertConcentrationText, units } from '../src/domain/math';
import { demoWorkspace, normalizeWorkspaceUnits } from '../src/state/workspace';

describe('gradient concentration units', () => {
  it('exposes explicit concentration labels and accepts historical aliases', () => {
    expect(units).toEqual(['mol/L', 'mmol/L', 'µmol/L', 'nmol/L', 'mg/L', 'µg/L']);
    for (const alias of ['μM', 'µM', 'uM', 'μmol/L', 'µmol/L']) {
      expect(convertConcentration(1, alias, 'nmol/L')).toBe(1000);
    }
    expect(convertConcentration(1, 'mM', 'µmol/L')).toBe(1000);
    expect(convertConcentration(1000, 'µg/L', 'mg/L')).toBe(1);
  });
  it('computes the same physical plan for independently selected stock and target units', () => {
    const plan = concentrationGradient(1, 'mmol/L', 10, [0, 1, 10], 'µmol/L', 1);
    expect(plan.map(r => r.stockUL)).toEqual([0, 10, 100]);
    expect(plan.map(r => r.solventML)).toEqual([9, 8.99, 8.9]);
    expect(concentrationGradient(1000, 'µmol/L', 10, [0, 1000, 10000], 'nmol/L', 1)
      .map(r => r.stockUL)).toEqual([0, 10, 100]);
  });
  it('preserves blanks, separators and invalid drafts during unit changes', () => {
    expect(convertConcentrationText('0\n\n1\nwrong\n10', 'µmol/L', 'nmol/L'))
      .toBe('0\n\n1000\nwrong\n10000');
    expect(convertConcentrationText('0，1; 10', 'µmol/L', 'mmol/L')).toBe('0，0.001; 0.01');
  });
  it('rejects mixed dimensions, overflow and overfilled recipes', () => {
    expect(() => concentrationGradient(1, 'mmol/L', 10, [1], 'mg/L')).toThrow('不能直接混用');
    expect(() => convertConcentration(Infinity, 'mol/L', 'nmol/L')).toThrow('有限数值');
    expect(() => convertConcentration(1e308, 'mol/L', 'nmol/L')).toThrow('有限数值');
    expect(() => concentrationGradient(1, 'mmol/L', 10, [950], 'µmol/L', 1)).toThrow('超过最终体积');
    expect(() => concentrationGradient(1, 'mmol/L', 10, [1001], 'µmol/L')).toThrow('目标浓度');
  });
  it('migrates legacy workspaces without changing concentrations or custom metadata', () => {
    const old = demoWorkspace();
    old.gradient.unit = 'μM';
    delete old.gradient.targetUnit;
    old.calUnit = 'nM';
    old.spectra[0].unit = 'mM';
    old.objects[0].unit = 'μg/L';
    old.styles.calibration.xLabel = 'Concentration / μM';
    old.sheetMetadata = { gradient: { target: { unit: 'μM', title: '自定义浓度' } } };
    const next = normalizeWorkspaceUnits(old);
    expect(next.gradient).toEqual({ ...old.gradient, unit: 'µmol/L', targetUnit: 'µmol/L' });
    expect(next.calUnit).toBe('nmol/L');
    expect(next.spectra[0].unit).toBe('mmol/L');
    expect(next.objects[0].unit).toBe('µg/L');
    expect(next.styles.calibration.xLabel).toBe('Concentration / µmol/L');
    expect(next.sheetMetadata?.gradient?.target).toEqual({ unit: 'µmol/L', title: '自定义浓度' });
  });
});
