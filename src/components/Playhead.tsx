import { usePlayheadStore } from '../store/usePlayheadStore';

interface PlayheadProps {
  stepW: number;
  /** タイムラインでは左ガター分オフセットする */
  offset?: number;
  variant?: 'timeline' | 'roll';
}

/** 再生ヘッド。毎フレーム更新されるためコンポーネントを分離している。 */
export function Playhead({ stepW, offset = 0, variant = 'timeline' }: PlayheadProps) {
  const step = usePlayheadStore((s) => s.step);
  return (
    <div
      className={variant === 'timeline' ? 'playhead' : 'pr-playhead'}
      style={{ left: offset + step * stepW }}
      aria-hidden="true"
    >
      {variant === 'timeline' && <div className="playhead__flag" />}
    </div>
  );
}
