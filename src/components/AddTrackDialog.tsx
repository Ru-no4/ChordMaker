import { useEffect } from 'react';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ConfirmDialog.css';

interface AddTrackDialogProps {
  onChooseNormal: () => void;
  onChooseChord: () => void;
  onCancel: () => void;
}

/**
 * トラック一覧にコードトラックが1本も無いときだけ、「トラックを追加」の
 * 押下で表示する選択ダイアログ。見た目は ConfirmDialog と同じモーダル
 * （CSS を再利用、選択肢が2つ+キャンセルという構成だけが違う）。
 */
export function AddTrackDialog({ onChooseNormal, onChooseChord, onCancel }: AddTrackDialogProps) {
  const { t } = useT();
  const atd = strings.addTrackDialog;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={t(atd.title)}>
      <div className="confirm-backdrop" onClick={onCancel} />
      <div className="confirm-panel">
        <h2 className="confirm-panel__title">{t(atd.title)}</h2>
        <p className="confirm-panel__message">{t(atd.message)}</p>
        <div className="confirm-panel__actions">
          <button type="button" className="cb-btn" onClick={onCancel}>
            {t(atd.cancel)}
          </button>
          <button type="button" className="cb-btn" onClick={onChooseNormal} title={t(atd.normalTrackHint)}>
            {t(atd.normalTrack)}
          </button>
          <button type="button" className="cb-btn" onClick={onChooseChord} title={t(atd.chordTrackHint)}>
            {t(atd.chordTrack)}
          </button>
        </div>
      </div>
    </div>
  );
}
