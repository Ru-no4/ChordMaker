import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  ProjectFileError,
  downloadProjectFile,
  parseProjectFile,
  serializeProject,
  type ProjectFileErrorCode,
} from '../lib/projectFile';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ProjectFileControls.css';

const ERROR_MESSAGES: Record<ProjectFileErrorCode, { ja: string; en: string }> = {
  'invalid-json': strings.errors.invalidJson,
  'invalid-format': strings.errors.invalidFormat,
  'wrong-app': strings.errors.wrongApp,
  'unsupported-version': strings.errors.unsupportedVersion,
  'corrupt-blocks': strings.errors.corruptBlocks,
  'corrupt-time-signature': strings.errors.corruptTimeSignature,
  'corrupt-settings': strings.errors.corruptSettings,
};

/** ファイル名に使えない文字を避けつつ、日時を埋め込んだ既定のファイル名 */
function defaultFilename(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `chrodmaker-${stamp}`;
}

/**
 * プロジェクトの保存 / 読み込み。
 * サーバーへは何も送らず、ブラウザのダウンロードとファイル選択だけで完結する。
 */
export function ProjectFileControls() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<ProjectFileErrorCode | 'generic' | null>(null);
  const { t } = useT();
  const pf = strings.projectFileControls;

  const bpm = useProjectStore((s) => s.bpm);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const rangeStart = useProjectStore((s) => s.rangeStart);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const quantize = useProjectStore((s) => s.quantize);
  const snap = useProjectStore((s) => s.snap);
  const instrumentId = useProjectStore((s) => s.instrumentId);
  const volumeDb = useProjectStore((s) => s.volumeDb);
  const blocks = useProjectStore((s) => s.blocks);
  const loadProject = useProjectStore((s) => s.loadProject);

  const handleSave = () => {
    const file = serializeProject({
      bpm,
      timeSignature,
      bars,
      rangeStart,
      chordResolution,
      quantize,
      snap,
      instrumentId,
      volumeDb,
      blocks,
    });
    downloadProjectFile(file, defaultFilename());
  };

  const handleOpenClick = () => {
    setError(null);
    inputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 同じファイルを選び直しても change が発火するように
    if (!file) return;
    try {
      const text = await file.text();
      loadProject(parseProjectFile(text));
      setError(null);
    } catch (err) {
      setError(err instanceof ProjectFileError ? err.code : 'generic');
    }
  };

  return (
    <div className="cb-transport pf-controls">
      <button
        type="button"
        className="cb-btn"
        onClick={handleSave}
        title={t(pf.saveTitle)}
        aria-label={t(pf.saveAria)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M8 2v7.4M5.2 6.6 8 9.4l2.8-2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2.5 10.5v1.7A1.3 1.3 0 0 0 3.8 13.5h8.4a1.3 1.3 0 0 0 1.3-1.3v-1.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="cb-btn"
        onClick={handleOpenClick}
        title={t(pf.openTitle)}
        aria-label={t(pf.openAria)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M2 4.6c0-.6.5-1.1 1.1-1.1h2.6l1.1 1.3h5.1c.6 0 1.1.5 1.1 1.1v5.6c0 .6-.5 1.1-1.1 1.1H3.1C2.5 12.6 2 12.1 2 11.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".chrd,application/json"
        className="pf-controls__input"
        onChange={(e) => void handleFileChange(e)}
        aria-hidden="true"
        tabIndex={-1}
      />
      {error && (
        <span
          className="pf-controls__error"
          title={error === 'generic' ? t(strings.errors.genericLoadFailed) : t(ERROR_MESSAGES[error])}
        >
          {t(pf.loadFailedShort)}
        </span>
      )}
    </div>
  );
}
