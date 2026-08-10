import { usePlayheadStore } from '../store/usePlayheadStore';
import { useProjectStore } from '../store/useProjectStore';
import { formatPosition } from '../lib/grid';

/** コントロールバーの再生位置表示（小節.拍.32分） */
export function PositionReadout() {
  const step = usePlayheadStore((s) => s.step);
  const timeSignature = useProjectStore((s) => s.timeSignature);

  return (
    <div className="cb-readout" title="小節.拍.32分">
      <span className="cb-readout__label">POSITION</span>
      <span className="cb-readout__value">{formatPosition(step, timeSignature)}</span>
    </div>
  );
}
