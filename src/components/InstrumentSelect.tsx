import { useProjectStore } from '../store/useProjectStore';
import { INSTRUMENT_GROUPS } from '../lib/instruments';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './InstrumentSelect.css';

interface InstrumentSelectProps {
  trackId: string;
}

/**
 * 音源の切り替え。選択中トラック（trackId）に対して働く。
 * サンプルの読み込み中も内蔵シンセで鳴り続けるので、選んだ直後から操作できる。
 */
export function InstrumentSelect({ trackId }: InstrumentSelectProps) {
  const instrumentId = useProjectStore((s) => s.trackSettings[trackId]?.instrumentId ?? '');
  const setTrackInstrument = useProjectStore((s) => s.setTrackInstrument);
  const loading = useProjectStore((s) => s.trackInstrumentLoading[trackId] ?? false);
  const error = useProjectStore((s) => s.trackInstrumentError[trackId] ?? false);
  const { t } = useT();
  const is = strings.instrumentSelect;

  return (
    <div className="cb-field">
      <label className="cb-label" htmlFor="instrument-select">
        {t(is.label)}
      </label>
      <div className="instrument-select">
        <select
          id="instrument-select"
          className="cb-select instrument-select__input"
          value={instrumentId}
          onChange={(e) => setTrackInstrument(trackId, e.target.value)}
        >
          {INSTRUMENT_GROUPS.map((group) => (
            <optgroup key={group.label.ja} label={t(group.label)}>
              {group.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t(preset.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {loading && (
          <span className="instrument-select__status" title={t(is.loadingTitle)}>
            <span className="instrument-select__spinner" aria-hidden="true" />
          </span>
        )}
        {!loading && error && (
          <span
            className="instrument-select__status is-error"
            title={t(strings.errors.instrumentLoadFailed)}
          >
            !
          </span>
        )}
      </div>
    </div>
  );
}
