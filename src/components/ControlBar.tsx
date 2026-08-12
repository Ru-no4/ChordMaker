import { useProjectStore } from '../store/useProjectStore';
import {
  CHORD_DIVISIONS,
  CHORD_RESOLUTION_LABELS,
  QUANTIZE_OPTIONS,
  type ChordResolution,
  type QuantizeValue,
} from '../lib/grid';
import { InstrumentSelect } from './InstrumentSelect';
import { NumberField } from './NumberField';
import { PositionReadout } from './PositionReadout';
import { ProjectFileControls } from './ProjectFileControls';
import { ToolStrip } from './ToolStrip';
import './ControlBar.css';

const TIME_SIGNATURES = [
  { label: '4/4', numerator: 4, denominator: 4 },
  { label: '3/4', numerator: 3, denominator: 4 },
  { label: '2/4', numerator: 2, denominator: 4 },
  { label: '6/8', numerator: 6, denominator: 8 },
  { label: '9/8', numerator: 9, denominator: 8 },
  { label: '12/8', numerator: 12, denominator: 8 },
  { label: '5/4', numerator: 5, denominator: 4 },
  { label: '7/8', numerator: 7, denominator: 8 },
];

interface ControlBarProps {
  onPlay: () => void;
  onStop: () => void;
  onPause: () => void;
  onJumpToStart: () => void;
  onOpenHelp: () => void;
}

export function ControlBar({
  onPlay,
  onStop,
  onPause,
  onJumpToStart,
  onOpenHelp,
}: ControlBarProps) {
  const bpm = useProjectStore((s) => s.bpm);
  const setBpm = useProjectStore((s) => s.setBpm);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const setTimeSignature = useProjectStore((s) => s.setTimeSignature);
  const bars = useProjectStore((s) => s.bars);
  const setBars = useProjectStore((s) => s.setBars);
  const loop = useProjectStore((s) => s.loop);
  const toggleLoop = useProjectStore((s) => s.toggleLoop);
  const followPlayhead = useProjectStore((s) => s.followPlayhead);
  const toggleFollowPlayhead = useProjectStore((s) => s.toggleFollowPlayhead);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const quantize = useProjectStore((s) => s.quantize);
  const setQuantize = useProjectStore((s) => s.setQuantize);
  const snap = useProjectStore((s) => s.snap);
  const toggleSnap = useProjectStore((s) => s.toggleSnap);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const setChordResolution = useProjectStore((s) => s.setChordResolution);
  const volumeDb = useProjectStore((s) => s.volumeDb);
  const setVolumeDb = useProjectStore((s) => s.setVolumeDb);
  const isPlaying = useProjectStore((s) => s.isPlaying);

  const sigLabel = `${timeSignature.numerator}/${timeSignature.denominator}`;

  return (
    <header className="control-bar">
      {/* ---- 左ゾーン: トランスポート ---- */}
      <div className="cb-zone cb-zone--left">
        <div className="cb-transport">
          <button
            type="button"
            className="cb-btn"
            onClick={onJumpToStart}
            title="先頭へ戻る"
            aria-label="先頭へ戻る"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="2" y="3" width="2" height="10" fill="currentColor" />
              <path d="M14 3.2v9.6L7.4 8z" fill="currentColor" />
              <path d="M8.6 3.2v9.6L2 8z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className={`cb-btn cb-btn--play ${isPlaying ? 'is-active' : ''}`}
            onClick={isPlaying ? onPause : onPlay}
            title={isPlaying ? '一時停止 (Space)' : '再生 (Space)'}
            aria-label={isPlaying ? '一時停止' : '再生'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="3" y="2" width="4" height="12" fill="currentColor" />
                <rect x="9" y="2" width="4" height="12" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M4 2.5v11l10-5.5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="cb-btn"
            onClick={onStop}
            title="停止 (Esc)"
            aria-label="停止"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className={`cb-btn cb-btn--loop ${loop ? 'is-active' : ''}`}
            onClick={toggleLoop}
            title="ループ再生"
            aria-pressed={loop}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M4 5h7a2.5 2.5 0 0 1 0 5H9m-4 1H5a2.5 2.5 0 0 1 0-5h1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M4 3.2 1.8 5 4 6.8z" fill="currentColor" />
            </svg>
            <span>LOOP</span>
          </button>
          <button
            type="button"
            className={`cb-btn cb-btn--loop ${followPlayhead ? 'is-active' : ''}`}
            onClick={toggleFollowPlayhead}
            title="再生ヘッドを画面中央に追従させる"
            aria-pressed={followPlayhead}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path
                d="M3.4 5.6 1.2 8l2.2 2.4M12.6 5.6 14.8 8l-2.2 2.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>FOLLOW</span>
          </button>
        </div>

        <div className="cb-transport">
          <button
            type="button"
            className="cb-btn"
            onClick={undo}
            disabled={!canUndo}
            title="元に戻す (Ctrl+Z)"
            aria-label="元に戻す"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M3 7h6.5a3.5 3.5 0 0 1 0 7H6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path d="M5.6 3.6 2 7l3.6 3.4z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="cb-btn"
            onClick={redo}
            disabled={!canRedo}
            title="やり直す (Ctrl+Y)"
            aria-label="やり直す"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M13 7H6.5a3.5 3.5 0 0 0 0 7H10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path d="M10.4 3.6 14 7l-3.6 3.4z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <ProjectFileControls />

        <PositionReadout />

        <div className="cb-sep" />

        <div className="cb-field cb-field--bpm">
          <label className="cb-label" htmlFor="bpm-input">
            BPM
          </label>
          <div className="cb-bpm-group">
            <NumberField
              id="bpm-input"
              className="cb-number"
              min={20}
              max={300}
              value={bpm}
              onCommit={setBpm}
            />
            <input
              type="range"
              className="cb-slider"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              aria-label="BPM スライダー"
            />
          </div>
        </div>

        <div className="cb-field">
          <label className="cb-label" htmlFor="sig-select">
            拍子
          </label>
          <select
            id="sig-select"
            className="cb-select"
            value={sigLabel}
            onChange={(e) => {
              const found = TIME_SIGNATURES.find((t) => t.label === e.target.value);
              if (found) {
                setTimeSignature({
                  numerator: found.numerator,
                  denominator: found.denominator,
                });
              }
            }}
          >
            {TIME_SIGNATURES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="cb-field">
          <label className="cb-label" htmlFor="bars-input">
            小節数
          </label>
          <NumberField
            id="bars-input"
            className="cb-number cb-number--narrow"
            min={1}
            max={64}
            value={bars}
            onCommit={setBars}
          />
        </div>
      </div>

      {/* ---- 右ゾーン: ツール / グリッド / 表示 ---- */}
      <div className="cb-zone cb-zone--right">
        <ToolStrip />

        <div className="cb-field">
          <span className="cb-label" title="コードを判定する時間の刻み（小節を何分割するか）">
            Chord
          </span>
          <div className="cb-segmented" role="group" aria-label="コード解像度">
            {CHORD_DIVISIONS.map((res) => (
              <button
                key={res}
                type="button"
                className={`cb-seg ${chordResolution === res ? 'is-active' : ''}`}
                onClick={() => setChordResolution(res as ChordResolution)}
                aria-pressed={chordResolution === res}
              >
                {CHORD_RESOLUTION_LABELS[res]}
              </button>
            ))}
          </div>
        </div>

        <div className="cb-field">
          <span className="cb-label">Quantize</span>
          <div className="cb-segmented" role="group" aria-label="クオンタイズ">
            {QUANTIZE_OPTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className={`cb-seg ${quantize === q ? 'is-active' : ''}`}
                onClick={() => setQuantize(q as QuantizeValue)}
                aria-pressed={quantize === q}
              >
                1/{q}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={`cb-btn cb-btn--wide ${snap ? 'is-active' : ''}`}
          onClick={toggleSnap}
          aria-pressed={snap}
          title="グリッドへの吸着"
        >
          SNAP {snap ? 'ON' : 'OFF'}
        </button>

        <div className="cb-sep" />

        <InstrumentSelect />

        <div className="cb-field cb-field--volume">
          <label className="cb-label" htmlFor="vol-slider">
            Volume
          </label>
          <input
            id="vol-slider"
            type="range"
            className="cb-slider cb-slider--short"
            min={-40}
            max={0}
            value={volumeDb}
            onChange={(e) => setVolumeDb(Number(e.target.value))}
            aria-label="音量"
          />
        </div>

        <button
          type="button"
          className="cb-btn cb-btn--help"
          onClick={onOpenHelp}
          title="操作一覧（?）"
          aria-label="操作一覧を開く"
        >
          ?
        </button>
      </div>
    </header>
  );
}
