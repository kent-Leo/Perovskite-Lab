import { useMemo } from 'react';
import { chartSVG } from '../domain/chart';
import { processedSegments, type AssistantProcessingResult } from '../domain/assistant-processing-v0.9.1-2026.10.27';
import { defaultStyle, type Series } from '../domain/types';
import type { ParsedSpectrumFile } from '../services/f7100-v0.9.1-2026.10.27';
import { ErrorNote } from './ui';

export type AssistantChartView = 'compare' | 'original';

/** Self-contained SVG chart; masked points are marked but never connected. */
export function AssistantSpectrumChart({
  parsed,
  result,
  view,
  title,
}: {
  parsed: ParsedSpectrumFile;
  result: AssistantProcessingResult | null;
  view: AssistantChartView;
  title?: string;
}) {
  const chart = useMemo(() => {
    try {
      const series: Series[] = [];
      const originalPoints = parsed.points.map((point) => ({ x: point.x, y: point.y }));
      const grey = '#9aa9a3';
      series.push({
        name: '原始光谱',
        color: grey,
        dashed: true,
        points: originalPoints,
      });
      if (view === 'compare' && result) {
        processedSegments(result.points).forEach((points, index) => {
          if (!points.length) return;
          series.push({
            name: '处理后光谱',
            color: '#177962',
            points,
            ...(points.length === 1 ? { kind: 'scatter' as const } : {}),
            ...(index === 0 ? {} : { dashed: false }),
          });
        });
        const repaired = result.points
          .filter((point) => !point.deleted && point.status === 'repaired')
          .map((point) => ({ x: point.x, y: point.processed as number }));
        if (repaired.length)
          series.push({ name: '已修复点', color: '#c58b2d', kind: 'scatter', points: repaired });
        const unresolved = result.points
          .filter((point) => !point.deleted && point.status === 'unresolved')
          .map((point) => ({ x: point.x, y: point.original }));
        if (unresolved.length)
          series.push({ name: '仅标记异常', color: '#d0693f', kind: 'scatter', points: unresolved });
        const masked = result.points
          .filter((point) => !point.deleted && point.status === 'masked')
          .map((point) => ({ x: point.x, y: point.original }));
        if (masked.length)
          series.push({ name: '屏蔽区间', color: '#a63f35', kind: 'scatter', points: masked });
      }
      const style = {
        ...defaultStyle('spectra'),
        title: title ?? (view === 'compare' ? '原始与处理后光谱对比' : '原始发射光谱'),
        legend: 'none' as const,
        grid: true,
        points: false,
        fontSize: 14,
      };
      return { svg: chartSVG({ series }, style), error: '' };
    } catch (e) {
      return { svg: '', error: (e as Error).message };
    }
  }, [parsed, result, view, title]);
  return (
    <div className="assistant-chart" data-testid="assistant-chart">
      {view === 'compare' && result ? (
        <ul className="assistant-legend" aria-label="光谱图例">
          <li><span style={{ background: '#9aa9a3' }} />原始测量值</li>
          <li><span style={{ background: '#177962' }} />处理后光谱</li>
          <li><span style={{ background: '#c58b2d' }} />已修复点（局部插值）</li>
          <li><span style={{ background: '#d0693f' }} />仅标记异常</li>
          <li><span style={{ background: '#a63f35' }} />屏蔽区间（不连线）</li>
          <li className="assistant-legend-note">基础算法保护主峰；人工编辑另行确认</li>
        </ul>
      ) : (
        <ul className="assistant-legend" aria-label="光谱图例">
          <li><span style={{ background: '#9aa9a3' }} />原始测量值</li>
          <li className="assistant-legend-note">{parsed.points.length} 个测量点 · 未处理</li>
        </ul>
      )}
      {chart.error ? (
        <ErrorNote>{chart.error}</ErrorNote>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: chart.svg }} />
      )}
    </div>
  );
}
