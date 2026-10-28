import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { resolveAssistantScanRange } from '../src/domain/assistant-scan-range-2026.10.26';
import { assistantProcessingKey, DEFAULT_ASSISTANT_PARAMETERS, processAssistantSpectrum } from '../src/domain/assistant-processing-2026.10.25';
import { buildAssistantWorkbook, assistantAnomalyRows } from '../src/services/assistant-export-2026.10.25';
import { buildAssistantSheetBundle } from '../src/services/assistant-sheet-2026.10.25';
import { parseSpectrumText } from '../src/services/f7100-2026.10.25';
import { previewBatchEdit, replayBatchEdits } from '../src/domain/assistant-batch-edit';
import { buildChatContext } from '../src/domain/assistant-context-2026.10.25';
import { validateChatContext, validateChatReply } from '../shared/ai-chat-2026.10.25';

const parsed = parseSpectrumText('nm,Data\n' + Array.from({length:101}, (_,i) => `${450+i},${10 + 500*Math.exp(-0.5*((450+i-520)/8)**2)}`).join('\n'), '范围.TXT');
const input = { points: parsed.points, rowNumbers: parsed.rowNumbers, excitationNm: 350,
  subtractBlank: false, blankSameConditions: false, parameters: DEFAULT_ASSISTANT_PARAMETERS };
const range = { fromNm: 480, toNm: 540 };
const result = processAssistantSpectrum({ ...input, scanRange: range });
const exported = { parsed, result, audit: { fileName: parsed.fileName, sheetName: '范围_AI处理', excitationNm: 350,
  solvent: '', ai: null, userInstructions: [], exportedOn: '2026.10.26' } };

describe('可修改扫描范围', () => {
  it('uses only selected points for the algorithm, retaining raw values, row numbers and original indices', () => {
    const original = structuredClone(input);
    const direct = processAssistantSpectrum({ ...input, points: input.points.slice(30,91), rowNumbers: input.rowNumbers.slice(30,91) });
    expect(result.points.filter(p => !p.deleted).map(p => p.processed)).toEqual(direct.points.map(p => p.processed));
    expect(result.stats.points).toBe(61);
    expect(result.points.filter(p => p.rangeExcluded)).toHaveLength(40);
    expect(result.points.map(p => [p.x,p.original,p.rowNumber,p.index])).toEqual(input.points.map((p,i) => [p.x,p.y,input.rowNumbers[i],i]));
    expect(input).toEqual(original);
    expect(assistantAnomalyRows(result).filter(r => r.异常类型==='扫描范围筛选')).toHaveLength(40);
    const expanded = processAssistantSpectrum({ ...input, scanRange: null });
    expect(expanded.points.filter(p => !p.deleted)).toHaveLength(101);
    expect(assistantProcessingKey(input)).not.toBe(assistantProcessingKey({ ...input, scanRange: range }));
  });
  it.each([
    {from:'',to:'540'}, {from:'480',to:''}, {from:'NaN',to:'540'}, {from:'540',to:'480'},
    {from:'449',to:'540'}, {from:'480',to:'551'}, {from:'480',to:'483'},
  ])('rejects invalid or insufficient measured ranges %j', draft => {
    expect(() => resolveAssistantScanRange(input.points,draft)).toThrow();
  });
  it('does not conceal invalid raw values outside the selected window', () => {
    const invalid = input.points.map((p,i) => i === 0 ? { ...p, y: NaN } : p);
    expect(() => processAssistantSpectrum({ ...input, points: invalid, scanRange: range })).toThrow('原始光谱');
  });
  it('includes both endpoints and supports decimal boundaries without interpolation', () => {
    expect(resolveAssistantScanRange(input.points,{from:'480.1',to:'539.9'})).toEqual({fromNm:480.1,toNm:539.9});
    const decimal = processAssistantSpectrum({...input,scanRange:{fromNm:480.1,toNm:539.9}});
    expect(decimal.points.filter(p => !p.deleted).map(p => p.x)).toEqual(Array.from({length:59},(_,i)=>481+i));
    expect(result.points.filter(p => !p.deleted).at(-1)!.x).toBe(540);
  });
  it('requires blank coverage only over the selected measurements', () => {
    const blankInput = { ...input, subtractBlank: true, blankSameConditions: true,
      blank: { name:'blank',points:input.points.slice(30,91).map(p=>({x:p.x,y:2})) } };
    expect(() => processAssistantSpectrum(blankInput)).toThrow('未覆盖');
    const corrected = processAssistantSpectrum({...blankInput, scanRange:range});
    expect(corrected.blank!.used).toBe(true);
    expect(corrected.points[70].corrected).toBe(508);
    expect(corrected.points[0].original).toBe(input.points[0].y);
  });
  it('exports full raw data and exactly the same selected processed rows to Excel and Sheet', async () => {
    const wb = XLSX.read(await buildAssistantWorkbook(exported),{type:'array'});
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['原始数据']);
    const processed = XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets['处理后数据'],{defval:''});
    expect(raw).toHaveLength(101); expect(processed).toHaveLength(61);
    expect(processed[0]).toMatchObject({波长_nm:480,源文件行号:32});
    const sheet = buildAssistantSheetBundle({...exported,unit:'µM'});
    expect(sheet.payload.grid.slice(1).map(r=>[r[0],r[1]])).toEqual(processed.map(r=>[String(r.波长_nm),String(r.处理后强度)]));
    expect(sheet.payload.rawSpectra![0].points).toHaveLength(61);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets['AI分析报告']))).toContain('480–540');
  });
  it('replays manual edits in the selected range and rejects operations outside it', () => {
    const doc = { id:'f',name:'范围.TXT',version:'v1',result };
    const plan = { type:'batch-edit',sessionId:'f',revision:'v1',targets:[{fileId:'f',version:'v1'}],
      edits:[{type:'set-point',wavelengthNm:530,value:123,reason:'指定'}] };
    const preview = previewBatchEdit([doc],plan);
    const restored = replayBatchEdits({...doc,version:'v2',result:processAssistantSpectrum(input)},preview.after[0].result);
    expect(restored.result.points.filter(p=>!p.deleted)).toHaveLength(101);
    expect(restored.result.points.find(p=>p.x===530)!.processed).toBe(123);
    expect(() => previewBatchEdit([doc],{...plan,edits:[{type:'delete-range',fromNm:470,toNm:490,reason:'越界'}]})).toThrow();
  });
  it('exposes the processing range to chat and validates batch permissions against it', () => {
    const context = buildChatContext({id:'f',revision:'v1',parse:parsed,parameters:input.parameters,result,
      stale:false,confirmed:false,excitationNm:350,solvent:'',hasBlank:false,subtractBlank:false,blankSameConditions:false},'');
    context.selectedFiles = [{id:'f',name:'范围.TXT',version:'v1',pointCount:101,scanRange:{fromNm:450,toNm:550},processingRange:range,
      summary:{remaining:61,deleted:40,masked:0,maximum:{x:520,y:510}}}];
    expect(validateChatContext(context).preview.processingRange).toEqual(range);
    expect(context.file.scanRange).toEqual({fromNm:450,toNm:550});
    expect(() => validateChatReply({reply:'越界',operation:{type:'batch-edit',sessionId:'f',revision:'v1',targets:[{fileId:'f',version:'v1'}],
      edits:[{type:'delete-range',fromNm:460,toNm:490,reason:'越界'}]}},context)).toThrow();
  });
});
