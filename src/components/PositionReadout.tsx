import { usePlayheadStore } from '../store/usePlayheadStore';
import { useProjectStore } from '../store/useProjectStore';
import { formatPosition } from '../lib/grid';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';

/** コントロールバーの再生位置表示（小節.拍.32分） */
export function PositionReadout() {
  const step = usePlayheadStore((s) => s.step);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const { t } = useT();

  return (
    <div className="cb-readout" title={t(strings.positionReadout.title)}>
      <span className="cb-readout__label">POSITION</span>
      <span className="cb-readout__value">{formatPosition(step, timeSignature)}</span>
    </div>
  );
}
