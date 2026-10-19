import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Worksheet } from './Worksheet-v0.2.0-2026.10.19';
import {
  WORKSHEET_LIMITS,
  WORKSHEET_VERSION,
  type WorksheetColumn,
} from '../domain/worksheet-v0.2.0-2026.10.19';
import { numeric } from '../domain/math';
import '../styles.css';

function WorksheetDemo() {
  const [rows, setRows] = useState([
    ['500', '100', '40'],
    ['510', '220', '90'],
    ['520', '150', '60'],
  ]);
  const [columns, setColumns] = useState<WorksheetColumn[]>([
    { key: 'wavelength', title: '波长', unit: 'nm', designation: 'X', type: 'number' },
    { key: 'sample-a', title: 'Sample A', unit: 'a.u.', designation: 'Y', type: 'number' },
    { key: 'sample-b', title: 'Sample B', unit: 'a.u.', designation: 'Y', type: 'number' },
    {
      key: 'difference',
      title: '强度差',
      unit: 'a.u.',
      designation: 'Result',
      readOnly: true,
      comment: 'B − C · 自动计算',
    },
  ]);
  const [notice, setNotice] = useState('');
  const [sheet, setSheet] = useState('Sheet1');
  const data = rows.map((row) => {
    const a = numeric(row[1]),
      b = numeric(row[2]);
    return columns.map((col, c) =>
      col.key === 'difference' ? (a === null || b === null ? '' : String(a - b)) : (row[c] ?? ''),
    );
  });
  return (
    <main className="worksheet-demo">
      <header>
        <span>PEROVSKITE LAB / WORKSHEET</span>
        <h1>
          Origin 式工作表 <small>v{WORKSHEET_VERSION}</small>
        </h1>
        <p>
          使用示例光谱体验单元格编辑、区域复制粘贴和撤销。列名称、单位、备注均可修改，灰色列自动计算
          B − C。
        </p>
      </header>
      <Worksheet
        book="光谱工作簿"
        sheet={sheet}
        onRenameSheet={setSheet}
        columns={columns}
        rows={data}
        onChange={setRows}
        onMetadataChange={(c, field, value) =>
          setColumns((all) => all.map((col, i) => (i === c ? { ...col, [field]: value } : col)))
        }
        onAddColumn={() => {
          if (
            columns.length >= WORKSHEET_LIMITS.columns ||
            Math.max(6, rows.length) * (columns.length + 1) > WORKSHEET_LIMITS.cells
          ) {
            setNotice('已达到工作表列数或单元格上限');
            return;
          }
          setColumns((all) => [
            ...all,
            {
              key: `sample-${all.length}`,
              title: `Sample ${all.length - 1}`,
              designation: 'Y',
              type: 'number',
              unit: 'a.u.',
            },
          ]);
          setNotice('');
        }}
      />
      <p className="worksheet-demo-note">
        这是独立组件演示页，数据仅保留在当前页面，刷新后恢复示例。主应用的四个分析页面已接入工作表。
        {notice && <strong role="alert"> {notice}</strong>}
      </p>
      <p>
        <a href="./index.html">返回 Perovskite Lab</a>
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorksheetDemo />
  </StrictMode>,
);
