import { useEffect } from 'react';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** キャンセル（何もせず閉じる） */
  onCancel: () => void;
  /** 保存せずそのまま実行する */
  onConfirm: () => void;
  /** .chrd として保存してから実行する */
  onSaveThenConfirm: () => void;
}

/** 破壊的な操作（全削除・初期化）の前に、保存の要否を選ばせる確認ダイアログ */
export function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
  onSaveThenConfirm,
}: ConfirmDialogProps) {
  const { t } = useT();
  const cd = strings.confirmDialog;

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
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-backdrop" onClick={onCancel} />
      <div className="confirm-panel">
        <h2 className="confirm-panel__title">{title}</h2>
        <p className="confirm-panel__message">{message}</p>
        <div className="confirm-panel__actions">
          <button type="button" className="cb-btn" onClick={onCancel}>
            {t(cd.cancel)}
          </button>
          <button type="button" className="cb-btn" onClick={onSaveThenConfirm}>
            {t(cd.saveThenOk)}
          </button>
          <button
            type="button"
            className="cb-btn confirm-panel__danger"
            onClick={onConfirm}
          >
            {t(cd.ok)}
          </button>
        </div>
      </div>
    </div>
  );
}
