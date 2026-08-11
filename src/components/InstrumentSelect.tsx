import { useProjectStore } from '../store/useProjectStore';
import { INSTRUMENT_GROUPS } from '../lib/instruments';
import './InstrumentSelect.css';

/**
 * 音源の切り替え。
 * サンプルの読み込み中も内蔵シンセで鳴り続けるので、選んだ直後から操作できる。
 */
export function InstrumentSelect() {
  const instrumentId = useProjectStore((s) => s.instrumentId);
  const setInstrument = useProjectStore((s) => s.setInstrument);
  const loading = useProjectStore((s) => s.instrumentLoading);
  const error = useProjectStore((s) => s.instrumentError);

  return (
    <div className="cb-field">
      <label className="cb-label" htmlFor="instrument-select">
        音源
      </label>
      <div className="instrument-select">
        <select
          id="instrument-select"
          className="cb-select instrument-select__input"
          value={instrumentId}
          onChange={(e) => setInstrument(e.target.value)}
        >
          {INSTRUMENT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {loading && (
          <span className="instrument-select__status" title="サンプルを読み込み中（今は合成音で鳴ります）">
            <span className="instrument-select__spinner" aria-hidden="true" />
            読込中
          </span>
        )}
        {!loading && error && (
          <span className="instrument-select__status is-error" title={error}>
            読込失敗
          </span>
        )}
      </div>
    </div>
  );
}
