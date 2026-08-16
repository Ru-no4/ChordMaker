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
  /**
   * 縦の長さ(px)を明示する場合に指定する。省略時は CSS 側の
   * `top: 0; bottom: 0;` で親要素いっぱいに伸びる。
   * コードトラックエリアでは親（.timeline__inner）が「トラック追加」行まで
   * 含んでしまうため、これを渡さないと再生ヘッドの赤線がそこまで
   * はみ出して見えてしまう。
   */
  height?: number;
}

/** 再生ヘッド。毎フレーム更新されるためコンポーネントを分離している。 */
export function Playhead({ stepW, offset = 0, variant = 'timeline', showFlag, height }: PlayheadProps) {
  const step = usePlayheadStore((s) => s.step);
  const flag = showFlag ?? variant === 'timeline';
  return (
    <div
      className={variant === 'timeline' ? 'playhead' : 'pr-playhead'}
      style={{ left: offset + step * stepW, ...(height !== undefined ? { height } : null) }}
      aria-hidden="true"
    >
      {flag && <div className="playhead__flag" />}
    </div>
  );
}
