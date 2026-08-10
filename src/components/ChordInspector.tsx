import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { chordResolutionSteps } from '../lib/grid';
import { candidateToMidi, midiToName } from '../lib/theory';
import { CATEGORY_ORDER, CATEGORY_STYLES, styleFor } from '../lib/colors';
import { segmentAt, segmentsFor } from '../lib/segmentation';
import { useActiveSegmentStart } from '../hooks/useActiveSegment';
import './ChordInspector.css';

interface ChordInspectorProps {
  onPreview: (midis: number[]) => void;
}

/**
 * 選択中コードブロックの判定結果を表示する。
 * ブロックが複数コードに分かれている場合は、セグメントを切り替えて見られる。
 */
export function ChordInspector({ onPreview }: ChordInspectorProps) {
  const blocks = useProjectStore((s) => s.blocks);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const setSegmentNotes = useProjectStore((s) => s.setSegmentNotes);

  const selected = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const resolutionSteps = chordResolutionSteps(timeSignature, chordResolution);

  const segments = useMemo(
    () => (selected ? segmentsFor(selected, resolutionSteps) : []),
    [selected, resolutionSteps],
  );
  const activeStart = useActiveSegmentStart(selected, segments, !!selected);
  const segment = activeStart === null ? null : segmentAt(segments, activeStart);

  if (!selected || !segment) {
    return (
      <div className="inspector inspector--legend">
        <span className="inspector__title">コードタイプ</span>
        <div className="inspector__legend">
          {CATEGORY_ORDER.map((cat) => (
            <span key={cat} className="legend-item">
              <span
                className="legend-item__swatch"
                style={{
                  background: CATEGORY_STYLES[cat].base,
                  borderColor: CATEGORY_STYLES[cat].accent,
                }}
              />
              {CATEGORY_STYLES[cat].label}
            </span>
          ))}
        </div>
        <span className="inspector__hint">
          コードブロックをクリックすると判定結果を表示します
        </span>
      </div>
    );
  }

  const detection = segment.detection;
  const style = styleFor(detection.chord?.category ?? null);

  return (
    <div className="inspector">
      {/* ---- セグメント切替（小節内に複数コードがある場合） ---- */}
      {segments.length > 1 && (
        <div className="inspector__section">
          <span className="inspector__label">小節内のコード</span>
          <div className="chip-row">
            {segments.map((seg, i) => {
              const sstyle = styleFor(seg.detection.chord?.category ?? null);
              return (
                <button
                  key={seg.start}
                  type="button"
                  className={`chip chip--seg ${seg.start === segment.start ? 'is-active' : ''}`}
                  style={{ borderColor: sstyle.accent }}
                  onClick={() => selectSegment(seg.start)}
                >
                  <span className="chip__index">{i + 1}</span>
                  <span className="chip__symbol">
                    {seg.detection.chord?.symbol ?? '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- 判定結果 ---- */}
      <div className="inspector__main" style={{ borderColor: style.accent }}>
        <span className="inspector__label">DETECTED</span>
        <span className="inspector__symbol" style={{ color: style.accent }}>
          {detection.kind === 'chord'
            ? detection.chord!.symbol
            : detection.kind === 'candidates'
              ? '判定中'
              : '—'}
        </span>
        {detection.kind === 'chord' && (
          <span className="inspector__badge" style={{ background: style.base }}>
            {style.label}
          </span>
        )}
      </div>

      {/* ---- 構成音 ---- */}
      <div className="inspector__section">
        <span className="inspector__label">構成音</span>
        <span className="inspector__notes">
          {detection.notes.length > 0
            ? detection.notes.map(midiToName).join('  ')
            : '未入力'}
        </span>
        {detection.kind === 'chord' && (
          <span className="inspector__degrees">
            {detection.chord!.degrees.join(' · ')}
          </span>
        )}
        {detection.intervalName && (
          <span className="inspector__degrees">{detection.intervalName}</span>
        )}
      </div>

      {/* ---- 候補提示（単音・2音） ---- */}
      {detection.kind === 'candidates' && detection.candidates.length > 0 && (
        <div className="inspector__section inspector__section--grow">
          <span className="inspector__label">候補（クリックで確定）</span>
          <div className="chip-row">
            {detection.candidates.map((c) => {
              const cstyle = styleFor(c.category);
              const midis = candidateToMidi(c, detection.notes[0] ?? 48);
              return (
                <button
                  key={`${c.root}-${c.quality}`}
                  type="button"
                  className="chip"
                  style={{ borderColor: cstyle.accent, background: `${cstyle.base}33` }}
                  onClick={() => {
                    setSegmentNotes(selected.id, segment.start, segment.length, midis);
                    onPreview(midis);
                  }}
                  title={`+${c.missing.length} 音を補完`}
                >
                  <span className="chip__symbol">{c.symbol}</span>
                  {c.missing.length > 0 && (
                    <span className="chip__meta">+{c.missing.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- 別解釈 ---- */}
      {detection.kind === 'chord' && detection.alternatives.length > 0 && (
        <div className="inspector__section inspector__section--grow">
          <span className="inspector__label">別解釈</span>
          <div className="chip-row">
            {detection.alternatives.map((alt) => {
              const astyle = styleFor(alt.category);
              return (
                <span
                  key={alt.symbol}
                  className="chip chip--static"
                  style={{ borderColor: `${astyle.accent}66` }}
                >
                  <span className="chip__symbol">{alt.symbol}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        className="inspector__play"
        disabled={segment.midis.length === 0}
        onClick={() => onPreview(segment.midis)}
      >
        ♪ 試聴
      </button>
    </div>
  );
}
