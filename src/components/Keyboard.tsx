import { isBlackKey, midiToName, pitchClass } from '../lib/theory';
import { PITCHES, rowHeight } from '../lib/pianoRoll';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';

interface KeyboardProps {
  /** アクティブなコードの構成音（ピッチクラス）。ハイライトに使う */
  activePitches: Set<number>;
  zoomY: number;
  onPreview: (midi: number) => void;
}

/** ピアノロール左側の鍵盤（幅 120px） */
export function Keyboard({ activePitches, zoomY, onPreview }: KeyboardProps) {
  const h = rowHeight(zoomY);
  const { t } = useT();
  return (
    <div className="keyboard" style={{ height: PITCHES.length * h }} aria-label={t(strings.keyboard.ariaLabel)}>
      {PITCHES.map((midi) => {
        const black = isBlackKey(midi);
        const isC = pitchClass(midi) === 0;
        const active = activePitches.has(pitchClass(midi));
        return (
          <button
            key={midi}
            type="button"
            className={[
              'key',
              black ? 'key--black' : 'key--white',
              isC ? 'key--c' : '',
              active ? 'is-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ height: h, fontSize: Math.min(11, Math.max(7, h * 0.6)) }}
            onPointerDown={(e) => {
              // タッチでもその場で発音させる（click を待たない）
              e.preventDefault();
              onPreview(midi);
            }}
            title={midiToName(midi)}
          >
            {(isC || black) && h >= 10 && (
              <span className="key__label">{midiToName(midi)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
