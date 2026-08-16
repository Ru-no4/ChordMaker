import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';
import {
  STEPS_PER_WHOLE,
  ZOOM_FACTOR,
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  ZOOM_Y_MAX,
  ZOOM_Y_MIN,
  beatWidth,
  displayBars,
  edgeMarginSteps,
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
import { AddTrackDialog } from './AddTrackDialog';
import { Playhead } from './Playhead';
import { TrackLane } from './TrackLane';
import { ZoomSlider } from './ZoomSlider';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ChordTimeline.css';

/**
 * 鍵盤幅と揃えた左ガター幅。
 * トラック名がミュート/ソロ/削除ボタンに圧迫されて読めない問題への対応で、
 * 従来（120px）より20%広くしてある。増えた分はガター内の縦並び操作カラム
 * （ChordTimeline.css の .timeline__gutter-actions）に充てる。
 */
export const GUTTER_WIDTH = 144;

/** 再生範囲ハンドル（三角形のつまみ）の幅。CSS 側の .ruler__range-handle と揃える */
const RANGE_HANDLE_WIDTH = 12;

interface ChordTimelineProps {
  onSeek: (step: number) => void;
}

export function ChordTimeline({ onSeek }: ChordTimelineProps) {
  const tracks = useProjectStore((s) => s.tracks);
  const activeTrackId = useProjectStore((s) => s.activeTrackId);
  const addTrack = useProjectStore((s) => s.addTrack);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const setBars = useProjectStore((s) => s.setBars);
  const rangeStart = useProjectStore((s) => s.rangeStart);
  const setRangeStart = useProjectStore((s) => s.setRangeStart);
  const addBarAtStart = useProjectStore((s) => s.addBarAtStart);
  const beginTransaction = useProjectStore((s) => s.beginTransaction);
  const endTransaction = useProjectStore((s) => s.endTransaction);
  const zoomX = useProjectStore((s) => s.zoomX);
  const chordZoomY = useProjectStore((s) => s.chordZoomY);
  const chordTrackAreaHeight = useProjectStore((s) => s.chordTrackAreaHeight);
  const zoomXBy = useProjectStore((s) => s.zoomXBy);
  const chordZoomYBy = useProjectStore((s) => s.chordZoomYBy);
  const setZoomX = useProjectStore((s) => s.setZoomX);
  const setChordZoomY = useProjectStore((s) => s.setChordZoomY);
  const { t } = useT();
  const ct = strings.chordTimeline;
  const tl = strings.trackLane;
  const te = strings.timelineEdge;

  const [showAddTrackChooser, setShowAddTrackChooser] = useState(false);

  const { ref, onScroll } = useSyncedScroll<HTMLDivElement>();
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const barsContentRef = useRef<HTMLDivElement | null>(null);
  const addBarStartRef = useRef<HTMLButtonElement | null>(null);
  const addBarEndRef = useRef<HTMLButtonElement | null>(null);
  const rangeEndDragRef = useRef<{ originX: number; origValue: number } | null>(null);
  const rangeStartDragRef = useRef<{ originX: number; origValue: number } | null>(null);

  const stepW = stepWidth(timeSignature, zoomX);
  const barW = stepsPerBar(timeSignature) * stepW;
  // 再生範囲スライダーは小節単位ではなく、小節内を四分音符単位で動かせるようにする
  const rangeSnapBars = (STEPS_PER_WHOLE / 4) / stepsPerBar(timeSignature);
  // 先頭・末尾に確保する余白（スクロールを端まで持っていくと見える。ここに小節追加ボタンを置く）
  const marginPx = edgeMarginSteps(timeSignature) * stepW;
  // 開始位置が終了位置以降まで来てしまっている（入れ替わっている）間は無効な範囲として扱う
  const rangeValid = rangeStart < bars;
  const rangeBandLeft = Math.min(rangeStart, bars) * barW + marginPx;
  const rangeBandWidth = Math.abs(bars - rangeStart) * barW;
  const rangeStartHandleLeft = rangeStart * barW + marginPx;
  const rangeEndHandleLeft = bars * barW + marginPx - RANGE_HANDLE_WIDTH;
  const handleAddBarStart = useCallback(() => {
    addBarAtStart();
    const playhead = usePlayheadStore.getState();
    playhead.setStep(playhead.step + stepsPerBar(timeSignature));
  }, [addBarAtStart, timeSignature]);
  const handleAddBarEnd = useCallback(() => setBars(bars + 1), [bars, setBars]);

  /**
   * コードトラックが1本も無いときだけ、通常/コードトラックの選択肢を出す
   * （消してしまうと戻せなくなるコードトラックの復元導線）。
   * コードトラックが既にある場合は、これまで通り即座に通常トラックを追加する。
   */
  const handleAddTrackClick = useCallback(() => {
    if (tracks.some((track) => track.kind === 'chord')) {
      addTrack('notes');
    } else {
      setShowAddTrackChooser(true);
    }
  }, [addTrack, tracks]);

  // 表示上の小節数。全トラックのうち、bars を超えて置かれた内容があれば、そこまで表示を伸ばす
  const allBlocks = useMemo(() => tracks.flatMap((tr) => tr.blocks), [tracks]);
  const shownBars = displayBars(timeSignature, bars, allBlocks);
  const total = totalSteps(timeSignature, shownBars);
  const contentWidth = total * stepW;
  const laneWidth = contentWidth + marginPx * 2;
  const beatsPerBar = timeSignature.numerator;
  // 小節追加＋アイコンの初期縦位置（マウント直後、スクロール前の想定）。
  // 実際の値は syncAddBarTop がスクロール位置も含めて算出し直す。
  const initialAddBarTop = Math.min(chordTrackAreaHeight, tracks.length * laneHeight(chordZoomY)) / 2;

  // 再生ヘッドを中央に保つ。横スクロールは scrollSync でピアノロールにも伝わる。
  usePlayheadFollow(ref, stepW, GUTTER_WIDTH, marginPx);

  const gridStyle = useMemo(
    () => ({
      backgroundImage: [
        `repeating-linear-gradient(90deg, var(--grid-bar) 0 1px, transparent 1px ${barW}px)`,
        `repeating-linear-gradient(90deg, var(--grid-beat) 0 1px, transparent 1px ${beatWidth(zoomX)}px)`,
        `repeating-linear-gradient(90deg, var(--grid-32) 0 1px, transparent 1px ${stepW}px)`,
      ].join(','),
      // 先頭の余白ぶん、格子模様の起点を右へずらして中身の step 0 と揃える
      backgroundPosition: `${marginPx}px 0`,
    }),
    [barW, marginPx, stepW, zoomX],
  );

  /* --- ルーラー（クリック＆ドラッグで再生位置を移動） --- */
  const scrubRef = useRef(false);
  const lastClientXRef = useRef(0);

  const seekFrom = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(total, (clientX - rect.left - marginPx) / stepW)));
    },
    [marginPx, onSeek, stepW, total],
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

  /**
   * 小節追加ボタン（左右の＋アイコン）を、「トラックエリアのうち、実際に
   * トラック（黒背景）がある部分」の、現在表示されている高さの中間に来る
   * よう縦位置を合わせる。トラックエリアはピアノロールとの境界をドラッグして
   * トラックの合計高さより広げられるため、単純にトラックエリアの表示高さ
   * （chordTrackAreaHeight）で中央寄せすると、はみ出した空欄部分に
   * アイコンが落ち込んでしまう。そこで「トラック全体の高さ（レーン高さ×
   * トラック数）」と「トラックエリアの表示高さ」のうち狭い方を使う。
   * トラック数ぶん重複して出すのはやめ、トラックエリア全体で1組だけ表示する。
   * 再描画を挟まないよう、他の scrollSync 系と同じく DOM を直接書き換える。
   */
  const syncAddBarTop = useCallback(() => {
    const scrollTop = ref.current?.scrollTop ?? 0;
    const tracksHeight = tracks.length * laneHeight(chordZoomY);
    // 現在のスクロール位置から下に、実際にトラックが残っている高さ
    const remainingTracksHeight = Math.max(0, tracksHeight - scrollTop);
    const visibleHeight = Math.min(chordTrackAreaHeight, remainingTracksHeight);
    const top = scrollTop + visibleHeight / 2;
    if (addBarStartRef.current) addBarStartRef.current.style.top = `${top}px`;
    if (addBarEndRef.current) addBarEndRef.current.style.top = `${top}px`;
  }, [chordTrackAreaHeight, chordZoomY, tracks.length, ref]);

  useEffect(() => {
    syncAddBarTop();
  }, [syncAddBarTop]);

  /**
   * BARS 行は独自のスクロールを持たない（overflow:hidden）ので、
   * トラックエリア（.timeline__scroll）が横スクロールするたびに、
   * BARS 行の中身を同じ量だけ transform でずらして追従させる。
   * 再描画を挟まないよう、scrollSync と同じく DOM を直接書き換える。
   */
  const handleScroll = useCallback(() => {
    onScroll();
    if (barsContentRef.current && ref.current) {
      barsContentRef.current.style.transform = `translateX(${-ref.current.scrollLeft}px)`;
    }
    syncAddBarTop();
  }, [onScroll, ref, syncAddBarTop]);

  /** Ctrl+ホイールで拡大縮小（Shift 併用で縦＝コードトラック自身のズーム） */
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      if (e.shiftKey) chordZoomYBy(factor);
      else zoomXBy(factor);
    },
    [chordZoomYBy, zoomXBy],
  );

  return (
    <section className="timeline" aria-label={t(ct.ariaLabel)}>
      {/*
        ---- BARS 行 ----
        「何小節目か」「再生範囲」を表す行。トラックエリアとは完全に別行にし、
        overflow:hidden の中で中身だけを横スクロール量ぶん transform でずらす
        （＝独自のスクロールバーは持たない。縦スクロールもそもそも不要）。
      ---- */}
      <div className="timeline__bars-row">
        <div className="timeline__gutter timeline__gutter--ruler">
          <span className="timeline__gutter-label">BARS</span>
        </div>
        <div className="timeline__bars-viewport">
          <div ref={barsContentRef} className="timeline__bars-content">
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
              <div className="ruler__margin" style={{ width: marginPx }} />
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
              <div className="ruler__margin" style={{ width: marginPx }} />

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

            {/* ---- 再生ヘッド（BARS 行ぶん。旗マーカーはこちらだけに出す） ---- */}
            <Playhead stepW={stepW} offset={marginPx} variant="timeline" />
          </div>
        </div>
        <div className="timeline__bars-vzoom-spacer" aria-hidden="true" />
      </div>

      {/* ---- トラックエリア（BARS 行より下、独立してスクロールする） ---- */}
      <div className="timeline__viewport">
        <div
          className="timeline__scroll"
          ref={ref}
          onScroll={handleScroll}
          onWheel={onWheel}
          style={{ height: chordTrackAreaHeight }}
        >
          <div className="timeline__inner" style={{ width: GUTTER_WIDTH + laneWidth }}>
            {/* ---- トラックごとのコードレーン ---- */}
            {tracks.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                isActive={track.id === activeTrackId}
                canRemove={tracks.length > 1}
                stepW={stepW}
                marginPx={marginPx}
                contentWidth={contentWidth}
                laneWidth={laneWidth}
                chordZoomY={chordZoomY}
                gridStyle={gridStyle}
                scrollRef={ref}
              />
            ))}

            {/* ---- トラック追加 ---- */}
            <div className="timeline__row timeline__row--add-track">
              <div className="timeline__gutter" />
              <button
                type="button"
                className="timeline__add-track"
                onClick={handleAddTrackClick}
                title={t(tl.addTrackTitle)}
                aria-label={t(tl.addTrackAria)}
              >
                {t(tl.addTrackLabel)}
              </button>
            </div>

            {/*
              ---- 小節追加（左右の＋）----
              トラックごとに重複させず、トラックエリア全体で1組だけ表示する。
              横位置はコンテンツ基準（スクロールに合わせて一緒に動く）、
              縦位置は「実際にトラックがある部分」の現在の表示高さの中間
              （syncAddBarTop で JS 側から同期。トラックエリアをトラックの
              合計高さより広げていても、その空欄部分には落ち込まない。
              表示倍率が変わってもアイコン自体の大きさは変えない —
              CSS 側は固定サイズのまま）。
            ---- */}
            <button
              ref={addBarStartRef}
              type="button"
              className="timeline-add-bar timeline-add-bar--start"
              style={{ left: GUTTER_WIDTH + marginPx / 2, top: initialAddBarTop }}
              onClick={handleAddBarStart}
              title={t(te.addBarAtStartTitle)}
              aria-label={t(te.addBarAtStartAria)}
            >
              +
            </button>
            <button
              ref={addBarEndRef}
              type="button"
              className="timeline-add-bar timeline-add-bar--end"
              style={{
                left: GUTTER_WIDTH + marginPx + contentWidth + marginPx / 2,
                top: initialAddBarTop,
              }}
              onClick={handleAddBarEnd}
              title={t(te.addBarAtEndTitle)}
              aria-label={t(te.addBarAtEndAria)}
            >
              +
            </button>

            {/*
              ---- 再生ヘッド（全レーンを貫通。旗マーカーは BARS 側にあるのでここでは出さない） ----
              親（.timeline__inner）は「トラック追加」行まで含んでしまうため、
              height を明示してトラック本体（レーン合計高さ）で止める
              （syncAddBarTop の tracksHeight と同じ計算式）。
            ---- */}
            <Playhead
              stepW={stepW}
              offset={GUTTER_WIDTH + marginPx}
              variant="timeline"
              showFlag={false}
              height={tracks.length * laneHeight(chordZoomY)}
            />
          </div>
        </div>

        {/*
          ---- 縦ズーム（ピアノロールの .pr-vzoom と同じ考え方）。
          スクロール領域の外側の専用カラムに置くことで、水平スクロール幅の計算に
          巻き込まれず常に右端に固定される。高さはコードトラックエリアの表示高さ
          （chordTrackAreaHeight）に揃える（chordZoomY はトラックを跨いで共有の
          値なので、コントロールは1つでよい）。
        ---- */}
        <div className="timeline__vzoomcol">
          <div className="timeline__vzoom" style={{ height: chordTrackAreaHeight }}>
            <ZoomSlider
              orientation="vertical"
              compact
              value={chordZoomY}
              min={ZOOM_Y_MIN}
              max={ZOOM_Y_MAX}
              onChange={setChordZoomY}
              ariaLabel={t(ct.zoomVAria)}
            />
          </div>
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

      {showAddTrackChooser && (
        <AddTrackDialog
          onChooseNormal={() => {
            addTrack('notes');
            setShowAddTrackChooser(false);
          }}
          onChooseChord={() => {
            addTrack('chord');
            setShowAddTrackChooser(false);
          }}
          onCancel={() => setShowAddTrackChooser(false)}
        />
      )}
    </section>
  );
}
