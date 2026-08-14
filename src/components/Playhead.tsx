import { usePlayheadStore } from '../store/usePlayheadStore';

interface PlayheadProps {
  stepW: number;
  /** タイムラインでは左ガター分オフセットする */
  offset?: number;
  variant?: 'timeline' | 'roll';
  /**
   * 先端の旗マーカーを表示するか。既定は variant==='timeline' のときだけ表示。
   * コードトラックは BARS 行とトラックエリアの2箇所に再生ヘッドを描くので、
   * 旗は BARS 行側だけに出し、トラックエリア側では明示的に false にする。
   */
  showFlag?: boolean;
}

/** 再生ヘッド。毎フレーム更新されるためコンポーネントを分離している。 */
export function Playhead({ stepW, offset = 0, variant = 'timeline', showFlag }: PlayheadProps) {
  const step = usePlayheadStore((s) => s.step);
  const flag = showFlag ?? variant === 'timeline';
  return (
    <div
      className={variant === 'timeline' ? 'playhead' : 'pr-playhead'}
      style={{ left: offset + step * stepW }}
      aria-hidden="true"
    >
      {flag && <div className="playhead__flag" />}
    </div>
  );
}
