import { useCallback, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  ZOOM_FACTOR,
  beatWidth,
  laneHeight,
  stepWidth,
  stepsPerBar,
  stepsPerBeat,
  totalSteps,
} from '../lib/grid';
import { capturePointer, releasePointer } from '../lib/pointer';
import { useSyncedScroll } from '../lib/scrollSync';
import { useEdgeAutoScroll } from '../hooks/useEdgeAutoScroll';
import { usePlayheadFollow } from '../hooks/usePlayheadFollow';
import { ChordBlock } from './ChordBlock';
import { Playhead } from './Playhead';
import './ChordTimeline.css';

/** 鍵盤幅と揃えた左ガター幅 */
export const GUTTER_WIDTH = 120;

interface ChordTimelineProps {
  onSeek: (step: number) => void;
}

export function ChordTimeline({ onSeek }: ChordTimelineProps) {
  const blocks = useProjectStore((s) => s.blocks);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectBlock = useProjectStore((s) => s.selectBlock);
  const addBlockAt = useProjectStore((s) => s.addBlockAt);
  const editorTool = useProjectStore((s) => s.editorTool);
  const zoomX = useProjectStore((s) => s.zoomX);
  const zoomY = useProjectStore((s) => s.zoomY);
  const zoomXBy = useProjectStore((s) => s.zoomXBy);
  const zoomYBy = useProjectStore((s) => s.zoomYBy);

  const { ref, onScroll } = useSyncedScroll<HTMLDivElement>();
  const panRef = useRef<{ originX: number; scrollLeft: number } | null>(null);

  const stepW = stepWidth(timeSignature, zoomX);
  const barW = stepsPerBar(timeSignature) * stepW;
  const total = totalSteps(timeSignature, bars);
  const laneWidth = total * stepW;
  const laneH = laneHeight(zoomY);
  const beatsPerBar = timeSignature.numerator;

  // 再生ヘッドを中央に保つ。横スクロールは scrollSync でピアノロールにも伝わる。
  usePlayheadFollow(ref, stepW, GUTTER_WIDTH);

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

  /* --- レーン背景 --- */
  const onLanePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // ブロック上ではブロック側が処理済み
      if (e.currentTarget !== e.target) return;

      // 手ツール / 中ボタンはビューのスクロール
      if (editorTool === 'pan' || e.button === 1) {
        capturePointer(e.currentTarget, e.pointerId);
        panRef.current = { originX: e.clientX, scrollLeft: ref.current?.scrollLeft ?? 0 };
        return;
      }
      if (e.button !== 0) return;

      if (editorTool === 'draw') {
        // 鉛筆はタップでブロック追加
        const rect = e.currentTarget.getBoundingClientRect();
        addBlockAt((e.clientX - rect.left) / stepW);
        return;
      }
      selectBlock(null);
    },
    [addBlockAt, editorTool, ref, selectBlock, stepW],
  );

  const onLanePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (!pan || !ref.current) return;
      ref.current.scrollLeft = pan.scrollLeft - (e.clientX - pan.originX);
    },
    [ref],
  );

  const onLanePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

  /* --- ルーラー（クリック＆ドラッグで再生位置を移動） --- */
  const scrubRef = useRef(false);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const lastClientXRef = useRef(0);

  const seekFrom = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(total, (clientX - rect.left) / stepW)));
    },
    [onSeek, stepW, total],
  );

  // 端まで持っていったら自動でスクロールし、その分も位置に反映する
  const rulerAutoScroll = useEdgeAutoScroll(ref, {
    onScrolled: () => {
      if (scrubRef.current) seekFrom(lastClientXRef.current);
    },
  });

  const onRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      capturePointer(e.currentTarget, e.pointerId);
      scrubRef.current = true;
      lastClientXRef.current = e.clientX;
      seekFrom(e.clientX);
    },
    [seekFrom],
  );

  const onRulerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!scrubRef.current) return;
      lastClientXRef.current = e.clientX;
      seekFrom(e.clientX);
      rulerAutoScroll.update(e.clientX, e.clientY);
    },
    [rulerAutoScroll, seekFrom],
  );

  const onRulerPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      scrubRef.current = false;
      rulerAutoScroll.stop();
      releasePointer(e.currentTarget, e.pointerId);
    },
    [rulerAutoScroll],
  );

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

  return (
    <section className="timeline" aria-label="コードタイムライン">
      <div className="timeline__scroll" ref={ref} onScroll={onScroll} onWheel={onWheel}>
        <div className="timeline__inner" style={{ width: GUTTER_WIDTH + laneWidth }}>
          {/* ---- ルーラー ---- */}
          <div className="timeline__row timeline__row--ruler">
            <div className="timeline__gutter timeline__gutter--ruler">
              <span className="timeline__gutter-label">BARS</span>
            </div>
            <div
              ref={rulerRef}
              className="ruler"
              style={{ width: laneWidth }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
              onPointerUp={onRulerPointerUp}
              onPointerCancel={onRulerPointerUp}
              onLostPointerCapture={onRulerPointerUp}
            >
              {Array.from({ length: bars }, (_, i) => (
                <div key={i} className="ruler__bar" style={{ width: barW }}>
                  <span className="ruler__num">{i + 1}</span>
                  {Array.from({ length: beatsPerBar - 1 }, (_, b) => (
                    <span
                      key={b}
                      className="ruler__beat"
                      style={{ left: (b + 1) * stepsPerBeat(timeSignature) * stepW }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ---- コードトラック ---- */}
          <div className="timeline__row timeline__row--chords" style={{ height: laneH }}>
            <div className="timeline__gutter">
              <span className="timeline__gutter-label">CHORD TRACK</span>
              <span className="timeline__gutter-hint">
                {editorTool === 'draw'
                  ? 'タップで追加'
                  : editorTool === 'erase'
                    ? 'タップで削除'
                    : '　'}
              </span>
            </div>
            <div
              className={`chord-lane tool-${editorTool}`}
              style={{ width: laneWidth, height: laneH, ...gridStyle }}
              onPointerDown={onLanePointerDown}
              onPointerMove={onLanePointerMove}
              onPointerUp={onLanePointerUp}
              onPointerCancel={onLanePointerUp}
              onLostPointerCapture={onLanePointerUp}
            >
              {blocks.map((block) => (
                <ChordBlock
                  key={block.id}
                  block={block}
                  stepW={stepW}
                  zoomY={zoomY}
                  selected={block.id === selectedBlockId}
                />
              ))}
            </div>
          </div>

          {/* ---- 再生ヘッド（ルーラー＋レーンを貫通） ---- */}
          <Playhead stepW={stepW} offset={GUTTER_WIDTH} variant="timeline" />
        </div>
      </div>
    </section>
  );
}
