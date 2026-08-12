import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  ZOOM_FACTOR,
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  ZOOM_Y_MAX,
  ZOOM_Y_MIN,
  beatWidth,
  chordResolutionSteps,
  displayBars,
  stepWidth,
  stepsPerBar,
  totalSteps,
} from '../lib/grid';
import { isBlackKey, pitchClass } from '../lib/theory';
import { styleFor } from '../lib/colors';
import { segmentAt, segmentsFor } from '../lib/segmentation';
import { PITCHES, gridHeight, rowHeight, rowTop } from '../lib/pianoRoll';
import { useSyncedScroll } from '../lib/scrollSync';
import { usePianoRollGesture } from '../hooks/usePianoRollGesture';
import { useActiveSegmentStart } from '../hooks/useActiveSegment';
import { GUTTER_WIDTH } from './ChordTimeline';
import { Keyboard } from './Keyboard';
import { Note } from './Note';
import { Playhead } from './Playhead';
import { ZoomSlider } from './ZoomSlider';
import './PianoRoll.css';

interface PianoRollProps {
  onPreview: (midi: number) => void;
}

export function PianoRoll({ onPreview }: PianoRollProps) {
  const blocks = useProjectStore((s) => s.blocks);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectedNoteIds = useProjectStore((s) => s.selectedNoteIds);
  const open = useProjectStore((s) => s.pianoRollOpen);
  const setPianoRollOpen = useProjectStore((s) => s.setPianoRollOpen);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const editorTool = useProjectStore((s) => s.editorTool);
  const clearNotes = useProjectStore((s) => s.clearNotes);
  const zoomX = useProjectStore((s) => s.zoomX);
  const zoomY = useProjectStore((s) => s.zoomY);
  const zoomXBy = useProjectStore((s) => s.zoomXBy);
  const zoomYBy = useProjectStore((s) => s.zoomYBy);
  const setZoomX = useProjectStore((s) => s.setZoomX);
  const setZoomY = useProjectStore((s) => s.setZoomY);

  const { ref, onScroll } = useSyncedScroll<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const centeredRef = useRef(false);

  const stepW = stepWidth(timeSignature, zoomX);
  const barW = stepsPerBar(timeSignature) * stepW;
  // コードトラックと同じ考え方: bars を超えて置かれた内容があれば表示幅を伸ばす
  const shownBars = displayBars(timeSignature, bars, blocks);
  const laneWidth = totalSteps(timeSignature, shownBars) * stepW;
  const rowH = rowHeight(zoomY);
  const height = gridHeight(zoomY);

  const selected = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const resolutionSteps = chordResolutionSteps(timeSignature, chordResolution);

  const segments = useMemo(
    () => (selected ? segmentsFor(selected, resolutionSteps) : []),
    [selected, resolutionSteps],
  );
  const activeStart = useActiveSegmentStart(selected, segments, !!selected);
  const activeSegment = activeStart === null ? null : segmentAt(segments, activeStart);

  const { marquee, eraseHot, handlers } = usePianoRollGesture({
    gridRef,
    scrollRef: ref,
    stepW,
    zoomY,
    onPreview,
  });

  const eraseSet = useMemo(() => new Set(eraseHot), [eraseHot]);
  const selectedSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  /** アクティブセグメントの構成音を鍵盤にハイライト */
  const activePitches = useMemo(
    () => new Set((activeSegment?.midis ?? []).map(pitchClass)),
    [activeSegment],
  );

  const gridStyle = useMemo(
    () => ({
      backgroundImage: [
        `repeating-linear-gradient(90deg, var(--grid-bar) 0 1px, transparent 1px ${barW}px)`,
        `repeating-linear-gradient(90deg, var(--grid-beat) 0 1px, transparent 1px ${beatWidth(zoomX)}px)`,
        `repeating-linear-gradient(90deg, var(--grid-32) 0 1px, transparent 1px ${stepW}px)`,
      ].join(','),
    }),
    [barW, stepW, zoomX],
  );

  // 初回展開時に C3 が中央に来るようにする
  useEffect(() => {
    if (!open || centeredRef.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = Math.max(0, rowTop(48, zoomY) - el.clientHeight / 2);
    centeredRef.current = true;
  }, [open, ref, zoomY]);

  /** Ctrl+ホイールで拡大縮小（Shift 併用で縦） */
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      if (e.shiftKey) zoomYBy(factor);
      else zoomXBy(factor);
    },
    [zoomXBy, zoomYBy],
  );

  const headerStyle = styleFor(activeSegment?.detection.chord?.category ?? null);

  return (
    <section className={`piano-roll ${open ? 'is-open' : ''}`} aria-label="ピアノロール">
      <div className="pr-header">
        <button
          type="button"
          className="pr-toggle"
          onClick={() => setPianoRollOpen(!open)}
          aria-expanded={open}
        >
          <span className={`pr-toggle__caret ${open ? 'is-open' : ''}`} aria-hidden="true">
            ▾
          </span>
          PIANO ROLL
        </button>

        <span className="pr-range">C1 – C6</span>

        {selected ? (
          <span className="pr-current">
            <span
              className="pr-current__swatch"
              style={{ background: headerStyle.base, borderColor: headerStyle.accent }}
            />
            <strong>
              {activeSegment?.detection.chord?.symbol ?? '構成音を配置してください'}
            </strong>
            <span className="pr-current__meta">
              {segments.length > 1 && `${segments.length} chords / `}
              {selected.notes.length} notes
            </span>
          </span>
        ) : (
          <span className="pr-current pr-current--empty">
            コードブロックを選択してください
          </span>
        )}

        <div className="pr-header__right">
          {selectedNoteIds.length > 1 && (
            <span className="pr-selcount">{selectedNoteIds.length} 選択中</span>
          )}
          <button
            type="button"
            className="pr-mini-btn"
            disabled={!selected || selected.notes.length === 0}
            onClick={() => selected && clearNotes(selected.id)}
          >
            構成音クリア
          </button>
        </div>
      </div>

      <div className="pr-main">
        <div className="pr-body" ref={ref} onScroll={onScroll} onWheel={onWheel}>
          <div className="pr-inner" style={{ width: GUTTER_WIDTH + laneWidth, height }}>
            <div className="pr-keys">
              <Keyboard activePitches={activePitches} zoomY={zoomY} onPreview={onPreview} />
            </div>

            <div
              ref={gridRef}
              className="pr-grid"
              data-tool={editorTool}
              style={{ width: laneWidth, height, ...gridStyle }}
              {...handlers}
            >
              {/* 行の明暗（黒鍵行を暗く） */}
              <div className="pr-rows" aria-hidden="true">
                {PITCHES.map((midi) => (
                  <div
                    key={midi}
                    className={[
                      'pr-row',
                      isBlackKey(midi) ? 'pr-row--black' : 'pr-row--white',
                      pitchClass(midi) === 0 ? 'pr-row--octave' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ height: rowH }}
                  />
                ))}
              </div>

              {/* ブロック範囲。選択中は明るく、他はグレー */}
              {blocks.map((b) => (
                <div
                  key={b.id}
                  className={`pr-region ${b.id === selectedBlockId ? 'is-active' : ''}`}
                  style={{ left: b.start * stepW, width: b.length * stepW }}
                />
              ))}

              {/* 選択ブロック内のコードの切れ目。上のコードトラックと位置が揃う */}
              {selected &&
                segments.slice(1).map((seg) => (
                  <div
                    key={seg.start}
                    className="pr-seg-divider"
                    style={{ left: (selected.start + seg.start) * stepW }}
                  />
                ))}

              {/*
                ノートはブロックを跨いで編集できる。
                選択中ブロック以外は控えめに描くが、選択・移動・削除は同じように行える。
              */}
              {blocks.flatMap((b) => {
                const segs = segmentsFor(b, resolutionSteps);
                return b.notes.map((n) => (
                  <Note
                    key={n.id}
                    note={n}
                    blockStart={b.start}
                    stepW={stepW}
                    zoomY={zoomY}
                    style={styleFor(segmentAt(segs, n.start)?.detection.chord?.category ?? null)}
                    selected={selectedSet.has(n.id)}
                    erasing={eraseSet.has(n.id)}
                    dimmed={b.id !== selectedBlockId}
                  />
                ));
              })}

              {marquee && (
                <div
                  className="pr-marquee"
                  style={{
                    left: marquee.left,
                    top: marquee.top,
                    width: marquee.width,
                    height: marquee.height,
                  }}
                />
              )}

              <Playhead stepW={stepW} variant="roll" />
            </div>
          </div>
        </div>

        {/* ---- 縦ズーム（右端、縦スクロールバーの隣。Cubase のキーエディタを参考） ---- */}
        <div className="pr-vzoom">
          <ZoomSlider
            orientation="vertical"
            value={zoomY}
            min={ZOOM_Y_MIN}
            max={ZOOM_Y_MAX}
            onChange={setZoomY}
            ariaLabel="ピアノロールの縦方向表示倍率"
          />
        </div>
      </div>

      {/* ---- 横ズーム（下端、水平スクロールバーの隣） ---- */}
      <div className="pr-footer">
        <ZoomSlider
          orientation="horizontal"
          value={zoomX}
          min={ZOOM_X_MIN}
          max={ZOOM_X_MAX}
          onChange={setZoomX}
          ariaLabel="ピアノロールの横幅表示倍率"
        />
      </div>
    </section>
  );
}
