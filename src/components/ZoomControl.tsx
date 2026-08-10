import { useProjectStore } from '../store/useProjectStore';
import {
  ZOOM_FACTOR,
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  ZOOM_Y_MAX,
  ZOOM_Y_MIN,
} from '../lib/grid';
import './ZoomControl.css';

/** コードトラックとピアノロールの表示倍率（横＝時間軸 / 縦＝音程・ブロック高） */
export function ZoomControl() {
  const zoomX = useProjectStore((s) => s.zoomX);
  const zoomY = useProjectStore((s) => s.zoomY);
  const zoomXBy = useProjectStore((s) => s.zoomXBy);
  const zoomYBy = useProjectStore((s) => s.zoomYBy);
  const resetZoom = useProjectStore((s) => s.resetZoom);

  const rows: Array<{
    label: string;
    title: string;
    value: number;
    min: number;
    max: number;
    by: (factor: number) => void;
  }> = [
    {
      label: 'H',
      title: '横方向（時間軸）の表示倍率',
      value: zoomX,
      min: ZOOM_X_MIN,
      max: ZOOM_X_MAX,
      by: zoomXBy,
    },
    {
      label: 'V',
      title: '縦方向（音程・ブロック高）の表示倍率',
      value: zoomY,
      min: ZOOM_Y_MIN,
      max: ZOOM_Y_MAX,
      by: zoomYBy,
    },
  ];

  return (
    <div className="zoom-control" role="group" aria-label="表示倍率">
      {rows.map((row) => (
        <div key={row.label} className="zoom-row">
          <span className="zoom-row__label" title={row.title}>
            {row.label}
          </span>
          <button
            type="button"
            className="zoom-btn"
            onClick={() => row.by(1 / ZOOM_FACTOR)}
            disabled={row.value <= row.min + 1e-6}
            aria-label={`${row.label} 縮小`}
          >
            −
          </button>
          <span className="zoom-row__value">{Math.round(row.value * 100)}%</span>
          <button
            type="button"
            className="zoom-btn"
            onClick={() => row.by(ZOOM_FACTOR)}
            disabled={row.value >= row.max - 1e-6}
            aria-label={`${row.label} 拡大`}
          >
            ＋
          </button>
        </div>
      ))}
      <button
        type="button"
        className="zoom-reset"
        onClick={resetZoom}
        disabled={zoomX === 1 && zoomY === 1}
        title="表示倍率を100%へ戻す"
      >
        100%
      </button>
    </div>
  );
}
