import { useMemo } from 'react';
import { selectActiveTrackBlocks, useProjectStore, type ChordBlockItem } from '../store/useProjectStore';
import { chordResolutionSteps } from '../lib/grid';
import { candidateToMidi, formatIntervalName, midiToName, pitchClass } from '../lib/theory';
import { CATEGORY_ORDER, CATEGORY_STYLES, styleFor } from '../lib/colors';
import { segmentAt, segmentsFor, type ChordSegment } from '../lib/segmentation';
import { useActiveSegmentStart } from '../hooks/useActiveSegment';
import { VOICING_PRESETS, buildVoicing, voiceLeadMidis } from '../lib/voicing';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ChordInspector.css';

/**
 * アクティブセグメントの直前に鳴っていたコードの実音を探す。
 * 同じブロック内に前のセグメントがあればそれを、無ければ直前に終わる
 * ブロックの最後のセグメントを見る（ブロックを跨いだボイスリーディング用）。
 */
function precedingChordMidis(
  blocks: ChordBlockItem[],
  resolutionSteps: number,
  block: ChordBlockItem,
  segment: ChordSegment,
): number[] {
  if (segment.start > 0) {
    const segs = segmentsFor(block, resolutionSteps);
    const idx = segs.findIndex((s) => s.start === segment.start);
    if (idx > 0) return segs[idx - 1].midis;
  }
  const absStart = block.start + segment.start;
  const prevBlock = blocks
    .filter((b) => b.id !== block.id && b.start + b.length <= absStart)
    .sort((a, b) => b.start - a.start)[0];
  if (!prevBlock) return [];
  const prevSegs = segmentsFor(prevBlock, resolutionSteps);
  return prevSegs[prevSegs.length - 1]?.midis ?? [];
}

interface ChordInspectorProps {
  onPreview: (midis: number[]) => void;
}

/**
 * 選択中コードブロックの判定結果を表示する。
 * ブロックが複数コードに分かれている場合は、セグメントを切り替えて見られる。
 */
export function ChordInspector({ onPreview }: ChordInspectorProps) {
  const blocks = useProjectStore(selectActiveTrackBlocks);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectedBlockIds = useProjectStore((s) => s.selectedBlockIds);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const setSegmentNotes = useProjectStore((s) => s.setSegmentNotes);
  const applyBulkSegmentNotes = useProjectStore((s) => s.applyBulkSegmentNotes);
  const clearBlockSelection = useProjectStore((s) => s.clearBlockSelection);
  const { t, locale } = useT();
  const ci = strings.chordInspector;

  const selected = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const resolutionSteps = chordResolutionSteps(timeSignature, chordResolution);

  const segments = useMemo(
    () => (selected ? segmentsFor(selected, resolutionSteps) : []),
    [selected, resolutionSteps],
  );
  const activeStart = useActiveSegmentStart(selected, segments, !!selected);
  const segment = activeStart === null ? null : segmentAt(segments, activeStart);

  const precedingMidis = useMemo(
    () =>
      selected && segment
        ? precedingChordMidis(blocks, resolutionSteps, selected, segment)
        : [],
    [blocks, resolutionSteps, selected, segment],
  );

  // ---- 複数ブロック選択中: 通常の単一コード表示より優先して一括操作パネルを出す ----
  if (selectedBlockIds.length > 0) {
    const handleChainVoiceLead = () => {
      const targets = blocks
        .filter((b) => selectedBlockIds.includes(b.id))
        .sort((a, b) => a.start - b.start);
      if (targets.length < 2) return;

      const updates: Array<{
        blockId: string;
        segStart: number;
        segLength: number;
        midis: number[];
      }> = [];
      let prevMidis: number[] | null = null;

      for (const block of targets) {
        for (const seg of segmentsFor(block, resolutionSteps)) {
          if (seg.detection.kind !== 'chord' || seg.midis.length === 0) continue;
          if (prevMidis === null) {
            // 先頭のコードは据え置き、以降の基準にする
            prevMidis = seg.midis;
            continue;
          }
          const pcs = [...new Set(seg.midis.map(pitchClass))];
          const newMidis = voiceLeadMidis(pcs, prevMidis);
          if (newMidis.length === 0) continue;
          updates.push({ blockId: block.id, segStart: seg.start, segLength: seg.length, midis: newMidis });
          prevMidis = newMidis;
        }
      }
      if (updates.length > 0) applyBulkSegmentNotes(updates);
    };

    return (
      <div className="inspector inspector--multi">
        <span className="inspector__label">
          {locale === 'ja'
            ? `${selectedBlockIds.length}個選択中`
            : `${selectedBlockIds.length} selected`}
        </span>
        <div className="chip-row">
          <button
            type="button"
            className="chip"
            disabled={selectedBlockIds.length < 2}
            title={t(ci.chainVoiceLeadTitle)}
            onClick={handleChainVoiceLead}
          >
            {t(ci.chainVoiceLead)}
          </button>
          <button type="button" className="chip" onClick={clearBlockSelection}>
            {t(ci.clearSelection)}
          </button>
        </div>
        <span className="inspector__hint">{t(ci.reselectHint)}</span>
      </div>
    );
  }

  if (!selected || !segment) {
    return (
      <div className="inspector inspector--legend">
        <span className="inspector__title">{t(ci.chordTypeTitle)}</span>
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
        <span className="inspector__hint">{t(ci.clickHint)}</span>
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
          <span className="inspector__label">{t(ci.chordsInBar)}</span>
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
        <span className="inspector__label">{t(ci.detected)}</span>
        <span className="inspector__symbol" style={{ color: style.accent }}>
          {detection.kind === 'chord'
            ? detection.chord!.symbol
            : detection.kind === 'candidates'
              ? t(ci.detecting)
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
        <span className="inspector__label">{t(ci.notes)}</span>
        <span className="inspector__notes">
          {detection.notes.length > 0
            ? detection.notes.map(midiToName).join('  ')
            : t(ci.notEntered)}
        </span>
        {detection.kind === 'chord' && (
          <span className="inspector__degrees">
            {detection.chord!.degrees.join(' · ')}
          </span>
        )}
        {detection.intervalSemitones !== null && (
          <span className="inspector__degrees">
            {formatIntervalName(detection.intervalSemitones, locale)}
          </span>
        )}
      </div>

      {/* ---- ボイシング ---- */}
      {detection.kind === 'chord' && (
        <div className="inspector__section">
          <span className="inspector__label">{t(ci.voicing)}</span>
          <div className="chip-row">
            {VOICING_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                title={t(p.title)}
                onClick={() => {
                  const pcs = [...new Set(segment.midis.map(pitchClass))];
                  const midis = buildVoicing(
                    detection.chord!.root,
                    pcs,
                    Math.min(...segment.midis),
                    p.id,
                  );
                  setSegmentNotes(selected.id, segment.start, segment.length, midis);
                  onPreview(midis);
                }}
              >
                {t(p.label)}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              disabled={precedingMidis.length === 0}
              title={precedingMidis.length === 0 ? t(ci.noPrecedingChord) : t(ci.voiceLeadTitle)}
              onClick={() => {
                const pcs = [...new Set(segment.midis.map(pitchClass))];
                const midis = voiceLeadMidis(pcs, precedingMidis);
                if (midis.length === 0) return;
                setSegmentNotes(selected.id, segment.start, segment.length, midis);
                onPreview(midis);
              }}
            >
              Voice Lead
            </button>
          </div>
        </div>
      )}

      {/* ---- 候補提示（単音・2音） ---- */}
      {detection.kind === 'candidates' && detection.candidates.length > 0 && (
        <div className="inspector__section inspector__section--grow">
          <span className="inspector__label">{t(ci.candidates)}</span>
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
                  title={
                    locale === 'ja'
                      ? `+${c.missing.length} 音を補完`
                      : `completes ${c.missing.length} note${c.missing.length === 1 ? '' : 's'}`
                  }
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
          <span className="inspector__label">{t(ci.alternatives)}</span>
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
        {t(ci.preview)}
      </button>
    </div>
  );
}
