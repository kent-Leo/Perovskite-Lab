import { fmt } from '../domain/math';
import type {
  AssistantAnomaly,
  AssistantProcessingResult,
} from '../domain/assistant-processing-v0.9.1-2026.10.27';

const kindLabel: Record<AssistantAnomaly['kind'], string> = {
  'positive-spike': '孤立正异常尖峰',
  'negative-spike': '孤立负异常尖峰',
  scattering: '疑似散射干扰',
  unrepairable: '连续异常区间',
};
const statusLabel: Record<AssistantAnomaly['status'], string> = {
  repaired: '已修复',
  masked: '已屏蔽',
  unresolved: '仅标记',
  suggested: '仅标记',
};

/** One row per affected measurement point, so every changed value is inspectable. */
export function AssistantRecords({ result }: { result: AssistantProcessingResult }) {
  const rows = result.anomalies.flatMap((anomaly) =>
    anomaly.wavelengths.map((wavelength, index) => ({
      anomaly,
      wavelength,
      original: anomaly.originalValues[index],
      processed: anomaly.processedValues[index],
    })),
  );
  return (
    <section className="assistant-card" aria-label="杂峰处理记录">
      <div className="assistant-section-head">
        <div>
          <h3>杂峰处理记录</h3>
          <p>
            共 {result.anomalies.length} 条记录 / {rows.length} 个受影响测量点。屏蔽值在处理后数据中留空，
            不会生成无法验证的荧光强度。
          </p>
        </div>
      </div>
      {rows.length ? (
        <div className="assistant-table-scroll">
          <table className="assistant-records">
            <thead>
              <tr>
                <th>记录</th>
                <th>异常类型</th>
                <th>状态</th>
                <th>波长 / nm</th>
                <th>原始强度</th>
                <th>处理后强度</th>
                <th>方法</th>
                <th>处理理由</th>
                <th>AI 辅助</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ anomaly, wavelength, original, processed }, index) => (
                <tr key={`${anomaly.id}-${wavelength}-${index}`}>
                  <td>{anomaly.id}</td>
                  <td>{kindLabel[anomaly.kind]}</td>
                  <td>
                    <span className={`assistant-status ${anomaly.status}`}>
                      {statusLabel[anomaly.status]}
                    </span>
                  </td>
                  <td>{fmt(wavelength, 5)}</td>
                  <td>{fmt(original, 6)}</td>
                  <td>{processed === null ? '—（留空）' : fmt(processed, 6)}</td>
                  <td>{anomaly.method}</td>
                  <td title={anomaly.reason}>{anomaly.reason}</td>
                  <td title={anomaly.aiNote ?? ''}>{anomaly.aiNote || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="assistant-note">当前没有异常记录。原始光谱与处理后光谱在数值上一致。</p>
      )}
    </section>
  );
}
