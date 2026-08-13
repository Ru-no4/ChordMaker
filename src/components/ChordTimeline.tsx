import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import {
  STEPS_PER_WHOLE,
  ZOOM_FACTOR,
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  beatWidth,
  displayBars,
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
import { ZoomSlider } from './ZoomSlider';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ChordTimeline.css';

/** 鍵盤幅と揃えた左ガター幅 */
export const GUTTER_WIDTH = 120;

/** 再生範囲ハンドル（三角形のつまみ）の幅。CSS 側の .ruler__range-handle と揃える */
const RANGE_HANDLE_WIDTH = 12;

interface ChordTimelineProps {
  onSeek: (step: number) => void;
}

export function ChordTimeline({ onSeek }: ChordTimelineProps) {
  const blocks = useProjectStore((s) => s.blocks);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const setBars = useProjectStore((s) => s.setBars);
  const rangeStart = useProjectStore((s) => s.rangeStart);
  const setRangeStart = useProjectStore((s) => s.setRangeStart);
  const beginTransaction = useProjectStore((s) => s.beginTransaction);
  const endTransaction = useProjectStore((s) => s.endTransaction);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectedBlockIds = useProjectStore((s) => s.selectedBlockIds);
  const selectBlock = useProjectStore((s) => s.selectBlock);
  const selectBlocks = useProjectStore((s) => s.selectBlocks);
  const addBlockAt = useProjectStore((s) => s.addBlockAt);
  const editorTool = useProjectStore((s) => s.editorTool);
  const zoomX = useProjectStore((s) => s.zoomX);
  const zoomY = useProjectStore((s) => s.zoomY);
  const zoomXBy = useProjectStore((s) => s.zoomXBy);
  const zoomYBy = useProjectStore((s) => s.zoomYBy);
  const setZoomX = useProjectStore((s) => s.setZoomX);
  const { t } = useT();
  const ct = strings.chordTimeline;

  const { ref, onScroll } = useSyncedScroll<HTMLDivElement>();
  const panRef = useRef<{ originX: number; scrollLeft: number } | null>(null);
  const marqueeRef = useRef<{ originX: number; base: string[]; additive: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; width: number } | null>(null);
  const rangeEndDragRef = useRef<{ originX: number; origValue: number } | null>(null);
  const rangeStartDragRef = useRef<{ originX: number; origValue: number } | null>(null);

  const stepW = stepWidth(timeSignature, zoomX);
  const barW = stepsPerBar(timeSignature) * stepW;
  // 再生範囲スライダーは小節単位ではなく、小節内を四分音符単位で動かせるようにする
  const rangeSnapBars = (STEPS_PER_WHOLE / 4) / stepsPerBar(timeSignature);
  // 開始位置が終了位置以降まで来てしまっている（入れ替わっている）間は無効な範囲として扱う
  const rangeValid = rangeStart < bars;
  const rangeBandLeft = Math.min(rangeStart, bars) * barW;
  const rangeBandWidth = Math.abs(bars - rangeStart) * barW;
  const rangeStartHandleLeft = rangeStart * barW;
  const rangeEndHandleLeft = bars * barW - RANGE_HANDLE_WIDTH;
  // 表示上の小節数。bars を超えて置かれた内容があれば、そこまで表示を伸ばす
  const shownBars = displayBars(timeSignature, bars, blocks);
  const total = totalSteps(timeSignature, shownBars);
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

      if (editorTool === 'range') {
        // 範囲選択はドラッグで複数ブロックをまとめて選ぶ
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        capturePointer(e.currentTarget, e.pointerId);
        marqueeRef.current = {
          originX: x,
          base: e.shiftKey ? selectedBlockIds : [],
          additive: e.shiftKey,
        };
        setMarquee({ left: x, width: 0 });
        return;
      }

      selectBlock(null);
    },
    [addBlockAt, editorTool, selectBlock, selectedBlockIds, stepW],
  );

  const onLanePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (pan && ref.current) {
        ref.current.scrollLeft = pan.scrollLeft - (e.clientX - pan.originX);
        return;
      }

      const mq = marqueeRef.current;
      if (!mq) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const left = Math.min(mq.originX, x);
      const width = Math.abs(x - mq.originX);
      setMarquee({ left, width });

      const hitStart = left / stepW;
      const hitEnd = (left + width) / stepW;
      const ids = blocks
        .filter((b) => b.start < hitEnd && b.start + b.length > hitStart)
        .map((b) => b.id);
      selectBlocks(mq.additive ? [...mq.base, ...ids] : ids);
    },
    [blocks, ref, selectBlocks, stepW],
  );

  const onLanePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
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

  /**
   * 再生範囲（bars）の終了ハンドル。Cubase のプロジェクト終端マーカーと同じ要領で、
   * ルーラー上のバーをドラッグして小節数を変える。中身の削除は起きない
   * （bars を減らしても、それを超えた位置のブロックはそのまま残る）。
   */
  const onRangeEndDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      capturePointer(e.currentTarget, e.pointerId);
      beginTransaction();
      rangeEndDragRef.current = { originX: e.clientX, origValue: bars };
    },
    [bars, beginTransaction],
  );

  const onRangeEndMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = rangeEndDragRef.current;
      if (!drag) return;
      const deltaBars = (e.clientX - drag.originX) / barW;
      const raw = drag.origValue + deltaBars;
      const next = Math.max(rangeSnapBars, Math.round(raw / rangeSnapBars) * rangeSnapBars);
      if (next !== bars) setBars(next);
    },
    [barW, bars, rangeSnapBars, setBars],
  );

  const onRangeEndUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      rangeEndDragRef.current = null;
      endTransaction();
      releasePointer(e.currentTarget, e.pointerId);
    },
    [endTransaction],
  );

  /**
   * 再生範囲の開始ハンドル。終了ハンドルと同じ要領でドラッグできる。
   * 終了位置を追い越しても止めない — その場合は「入れ替わっている」として
   * 範囲全体が無効（再生範囲扱いしない）になり、見た目もグレーになる。
   */
  const onRangeStartDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      capturePointer(e.currentTarget, e.pointerId);
      beginTransaction();
      rangeStartDragRef.current = { originX: e.clientX, origValue: rangeStart };
    },
    [rangeStart, beginTransaction],
  );

  const onRangeStartMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = rangeStartDragRef.current;
      if (!drag) return;
      const deltaBars = (e.clientX - drag.originX) / barW;
      const raw = drag.origValue + deltaBars;
      const next = Math.max(0, Math.round(raw / rangeSnapBars) * rangeSnapBars);
      if (next !== rangeStart) setRangeStart(next);
    },
    [barW, rangeSnapBars, rangeStart, setRangeStart],
  );

  const onRangeStartUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      rangeStartDragRef.current = null;
      endTransaction();
      releasePointer(e.currentTarget, e.pointerId);
    },
    [endTransaction],
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
    <section className="timeline" aria-label={t(ct.ariaLabel)}>
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
              {Array.from({ length: shownBars }, (_, i) => (
                <div
                  key={i}
                  className={`ruler__bar ${i >= bars ? 'is-overflow' : ''}`}
                  style={{ width: barW }}
                >
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

              {/*
                ---- 再生範囲（rangeStart 〜 bars）。両端をドラッグして変更できる。
                開始・終了が入れ替わっている間は is-invalid でグレーにし、
                再生範囲として扱わない（useTransport 側でも同様にフォールバックする）。
              ---- */}
              <div
                className={`ruler__range ${rangeValid ? '' : 'is-invalid'}`}
                style={{ left: rangeBandLeft, width: rangeBandWidth }}
              />
              <div
                className={`ruler__range-handle ruler__range-handle--start ${rangeValid ? '' : 'is-invalid'}`}
                style={{ left: rangeStartHandleLeft }}
                onPointerDown={onRangeStartDown}
                onPointerMove={onRangeStartMove}
                onPointerUp={onRangeStartUp}
                onPointerCancel={onRangeStartUp}
                onLostPointerCapture={onRangeStartUp}
                title={t(ct.rangeStartHandleTitle)}
              />
              <div
                className={`ruler__range-handle ruler__range-handle--end ${rangeValid ? '' : 'is-invalid'}`}
                style={{ left: rangeEndHandleLeft }}
                onPointerDown={onRangeEndDown}
                onPointerMove={onRangeEndMove}
                onPointerUp={onRangeEndUp}
                onPointerCancel={onRangeEndUp}
                onLostPointerCapture={onRangeEndUp}
                title={t(ct.rangeEndHandleTitle)}
              />
            </div>
          </div>

          {/* ---- コードトラック ---- */}
          <div className="timeline__row timeline__row--chords" style={{ height: laneH }}>
            <div className="timeline__gutter">
              <span className="timeline__gutter-label">CHORD TRACK</span>
              <span className="timeline__gutter-hint">
                {editorTool === 'draw'
                  ? t(ct.tapToAdd)
                  : editorTool === 'erase'
                    ? t(ct.tapToDelete)
                    : ' '}
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
                  selected={block.id === selectedBlockId || selectedBlockIds.includes(block.id)}
                />
              ))}

              {marquee && (
                <div
                  className="chord-lane__marquee"
                  style={{ left: marquee.left, width: marquee.width }}
                />
              )}
            </div>
          </div>

          {/* ---- 再生ヘッド（ルーラー＋レーンを貫通） ---- */}
          <Playhead stepW={stepW} offset={GUTTER_WIDTH} variant="timeline" />
        </div>
      </div>

      {/* ---- ズームスライダー（Cubase のプロジェクト窓右下を参考） ---- */}
      <div className="timeline__zoom">
        <ZoomSlider
          orientation="horizontal"
          value={zoomX}
          min={ZOOM_X_MIN}
          max={ZOOM_X_MAX}
          onChange={setZoomX}
          ariaLabel={t(ct.zoomAria)}
        />
      </div>
    </section>
  );
}
