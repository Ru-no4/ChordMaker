import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { useProjectStore, type Track } from '../store/useProjectStore';
import { DEFAULT_CHORD_ZOOM_Y, laneHeight } from '../lib/grid';
import { capturePointer, isTap, releasePointer } from '../lib/pointer';
import { ChordBlock } from './ChordBlock';
import { TrackLaneResizeHandle } from './TrackLaneResizeHandle';
import { instrumentLabel } from '../lib/instruments';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';

/** グリップをドラッグして並べ替えたと判定する、隣のレーンへ跨いだと見なす移動量(px) */
const REORDER_STEP_RATIO = 1;

/**
 * ミュート/ソロ/削除の縦並びカラム（.timeline__gutter-actions）のレイアウト値。
 * CSS 側の実寸（ChordTimeline.css の .timeline__gutter-mute 等の width/height、
 * .timeline__gutter の padding-top/bottom）と一致させておくこと。
 */
const ACTIONS_BUTTON_SIZE = 14;
/** ミュート・ソロ・削除の最大3個ぶんを想定（最後の1本で削除ボタンが無い場合も、
 *  計算を単純にするためこの想定のまま — gapがやや控えめになるだけで実害は無い） */
const ACTIONS_BUTTON_COUNT = 3;
const ACTIONS_DEFAULT_GAP = 3;
const ACTIONS_MIN_GAP = 1;
/** .timeline__gutter の padding-top + padding-bottom */
const ACTIONS_VERTICAL_PADDING = 8;

interface TrackLaneProps {
  track: Track;
  isActive: boolean;
  /** 最後の1本は削除できない */
  canRemove: boolean;
  stepW: number;
  marginPx: number;
  contentWidth: number;
  laneWidth: number;
  chordZoomY: number;
  gridStyle: CSSProperties;
  /** パン（手ツール）でスクロール位置を直接動かすための、横スクロール要素への参照 */
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * トラック1本ぶんのレーン（ガター + コードブロックを並べる領域）。
 * `ChordTimeline` はこれをトラックの数だけ並べる。
 * 横スクロール・ズーム・小節数などレーン間で共通のレイアウト値は
 * 親から props で受け取り、ブロックの配置・選択などトラック固有の状態だけ
 * ここで扱う。
 */
export function TrackLane({
  track,
  isActive,
  canRemove,
  stepW,
  marginPx,
  contentWidth,
  laneWidth,
  chordZoomY,
  gridStyle,
  scrollRef,
}: TrackLaneProps) {
  const laneHeightOverride = useProjectStore((s) => s.trackSettings[track.id]?.laneHeightPx ?? null);
  // レーンの高さは既定では縦ズーム（chordZoomY）から一律に決まるが、
  // トラックごとに TrackLaneResizeHandle でドラッグして上書きできる。
  const laneH = laneHeightOverride ?? laneHeight(chordZoomY);
  // 縦幅倍率を下げてレーンが低くなったときは、M/S/削除ボタンの間隔を
  // 詰めて収まりやすくする（既定の3pxで収まる高さがあればそのまま、
  // 収まらなければ最小1pxまで縮める。それでも収まらない分は
  // .timeline__gutter の overflow:hidden で従来通り自然に隠れる）
  const actionsGap = useMemo(() => {
    const available = laneH - ACTIONS_VERTICAL_PADDING;
    const buttonsHeight = ACTIONS_BUTTON_SIZE * ACTIONS_BUTTON_COUNT;
    const gapCount = ACTIONS_BUTTON_COUNT - 1;
    const fitGap = (available - buttonsHeight) / gapCount;
    return Math.max(ACTIONS_MIN_GAP, Math.min(ACTIONS_DEFAULT_GAP, fitGap));
  }, [laneH]);
  const editorTool = useProjectStore((s) => s.editorTool);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectedBlockIds = useProjectStore((s) => s.selectedBlockIds);
  const selectBlock = useProjectStore((s) => s.selectBlock);
  const selectBlocks = useProjectStore((s) => s.selectBlocks);
  const addBlockAt = useProjectStore((s) => s.addBlockAt);
  const setActiveTrack = useProjectStore((s) => s.setActiveTrack);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const volumeDb = useProjectStore((s) => s.trackSettings[track.id]?.volumeDb ?? 0);
  const setTrackVolumeDb = useProjectStore((s) => s.setTrackVolumeDb);
  const instrumentId = useProjectStore((s) => s.trackSettings[track.id]?.instrumentId ?? '');
  const muted = useProjectStore((s) => s.trackSettings[track.id]?.muted ?? false);
  const solo = useProjectStore((s) => s.trackSettings[track.id]?.solo ?? false);
  const toggleTrackMute = useProjectStore((s) => s.toggleTrackMute);
  const toggleTrackSolo = useProjectStore((s) => s.toggleTrackSolo);
  const renameTrack = useProjectStore((s) => s.renameTrack);
  const setTrackColor = useProjectStore((s) => s.setTrackColor);
  const moveTrackBy = useProjectStore((s) => s.moveTrackBy);
  const setTrackLaneHeight = useProjectStore((s) => s.setTrackLaneHeight);
  const resetTrackLaneHeight = useProjectStore((s) => s.resetTrackLaneHeight);
  const { t, locale } = useT();
  const tl = strings.trackLane;

  const panRef = useRef<{ originX: number; scrollLeft: number } | null>(null);
  const marqueeRef = useRef<{ originX: number; base: string[]; additive: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; width: number } | null>(null);

  /* --- トラック名のインライン編集 --- */
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(track.name);

  const startRename = useCallback(
    (e: ReactMouseEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      setNameDraft(track.name);
      setEditingName(true);
    },
    [track.name],
  );

  const commitRename = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== track.name) renameTrack(track.id, trimmed);
    setEditingName(false);
  }, [nameDraft, renameTrack, track.id, track.name]);

  /* --- グリップのドラッグで並べ替え（離したときにまとめて1回だけ移動する） --- */
  const reorderRef = useRef<{ originY: number; pointerType: string } | null>(null);

  const onGripPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      capturePointer(e.currentTarget, e.pointerId);
      reorderRef.current = { originY: e.clientY, pointerType: e.pointerType };
    },
    [],
  );

  const onGripPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = reorderRef.current;
      reorderRef.current = null;
      releasePointer(e.currentTarget, e.pointerId);
      if (!drag) return;
      const dy = e.clientY - drag.originY;
      if (isTap(drag.pointerType, 0, dy)) return; // タップは何もしない（並べ替え専用のハンドルなので）
      const steps = Math.round(dy / (laneH * REORDER_STEP_RATIO));
      if (steps !== 0) moveTrackBy(track.id, steps);
    },
    [laneH, moveTrackBy, track.id],
  );

  const onLanePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // ブロック上ではブロック側が処理済み
      if (e.currentTarget !== e.target) return;

      // 手ツール / 中ボタンはビューのスクロール
      if (editorTool === 'pan' || e.button === 1) {
        capturePointer(e.currentTarget, e.pointerId);
        panRef.current = { originX: e.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0 };
        return;
      }
      if (e.button !== 0) return;

      if (editorTool === 'draw') {
        // 鉛筆はタップでブロック追加
        const rect = e.currentTarget.getBoundingClientRect();
        addBlockAt(track.id, (e.clientX - rect.left - marginPx) / stepW);
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

      selectBlock(track.id, null);
    },
    [addBlockAt, editorTool, marginPx, scrollRef, selectBlock, selectedBlockIds, stepW, track.id],
  );

  const onLanePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (pan && scrollRef.current) {
        scrollRef.current.scrollLeft = pan.scrollLeft - (e.clientX - pan.originX);
        return;
      }

      const mq = marqueeRef.current;
      if (!mq) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const left = Math.min(mq.originX, x);
      const width = Math.abs(x - mq.originX);
      setMarquee({ left, width });

      const hitStart = (left - marginPx) / stepW;
      const hitEnd = (left + width - marginPx) / stepW;
      const ids = track.blocks
        .filter((b) => b.start < hitEnd && b.start + b.length > hitStart)
        .map((b) => b.id);
      selectBlocks(track.id, mq.additive ? [...mq.base, ...ids] : ids);
    },
    [marginPx, scrollRef, selectBlocks, stepW, track.blocks, track.id],
  );

  const onLanePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

  return (
    <div className="timeline__row timeline__row--chords" style={{ height: laneH }}>
      <div
        className={`timeline__gutter ${isActive ? 'is-active' : ''}`}
        onClick={() => setActiveTrack(track.id)}
        title={t(tl.selectTitle)}
      >
        <div className="timeline__gutter-main">
          <div className="timeline__gutter-head">
            <button
              type="button"
              className="timeline__gutter-grip"
              onPointerDown={onGripPointerDown}
              onPointerUp={onGripPointerUp}
              onPointerCancel={onGripPointerUp}
              onLostPointerCapture={onGripPointerUp}
              onClick={(e) => e.stopPropagation()}
              title={t(tl.reorderTitle)}
              aria-label={t(tl.reorderAria)}
            >
              ⠿
            </button>
            <input
              type="color"
              className="timeline__gutter-swatch"
              value={track.color}
              onChange={(e) => setTrackColor(track.id, e.target.value)}
              title={t(tl.colorTitle)}
              aria-label={t(tl.colorAria)}
            />
            {editingName ? (
              <input
                type="text"
                className="timeline__gutter-label-input"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  else if (e.key === 'Escape') {
                    setNameDraft(track.name);
                    setEditingName(false);
                  }
                }}
              />
            ) : (
              <span className="timeline__gutter-label" onClick={startRename} title={t(tl.renameTitle)}>
                {track.name}
              </span>
            )}
          </div>
          <span
            className="timeline__gutter-instrument"
            title={instrumentLabel(instrumentId, locale)}
          >
            {instrumentLabel(instrumentId, locale)}
          </span>
          {chordZoomY >= DEFAULT_CHORD_ZOOM_Y && (
            <div className="timeline__gutter-vol" title={`${volumeDb} dB`}>
              <input
                type="range"
                className="timeline__gutter-vol-slider"
                min={-40}
                max={0}
                value={volumeDb}
                onChange={(e) => setTrackVolumeDb(track.id, Number(e.target.value))}
                aria-label={t(tl.volumeAria)}
              />
            </div>
          )}
        </div>
        {/*
          ---- ×/M/S を縦に並べる専用カラム ----
          ガター横幅を広げて確保した分をここに充てることで、トラック名を
          横に圧迫せずに常時表示できるようにしている。
        ---- */}
        <div className="timeline__gutter-actions" style={{ gap: actionsGap }}>
          <button
            type="button"
            className={`timeline__gutter-mute ${muted ? 'is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackMute(track.id);
            }}
            title={t(tl.muteTitle)}
            aria-label={t(tl.muteAria)}
            aria-pressed={muted}
          >
            M
          </button>
          <button
            type="button"
            className={`timeline__gutter-solo ${solo ? 'is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleTrackSolo(track.id);
            }}
            title={t(tl.soloTitle)}
            aria-label={t(tl.soloAria)}
            aria-pressed={solo}
          >
            S
          </button>
          {canRemove && (
            <button
              type="button"
              className="timeline__gutter-remove"
              onClick={(e) => {
                e.stopPropagation();
                removeTrack(track.id);
              }}
              title={t(tl.removeTitle)}
              aria-label={t(tl.removeAria)}
            >
              ×
            </button>
          )}
        </div>
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
        {/* 先頭・末尾の余白。非選択エリアよりさらに暗くする */}
        <div className="timeline-margin-shade" style={{ left: 0, width: marginPx }} />
        <div
          className="timeline-margin-shade"
          style={{ left: marginPx + contentWidth, width: marginPx }}
        />

        <div className="chord-lane__content" style={{ left: marginPx }}>
          {track.blocks.map((block) => (
            <ChordBlock
              key={block.id}
              trackId={track.id}
              block={block}
              stepW={stepW}
              zoomY={chordZoomY}
              laneH={laneH}
              selected={block.id === selectedBlockId || selectedBlockIds.includes(block.id)}
              trackKind={track.kind}
              trackColor={track.color}
            />
          ))}
        </div>

        {marquee && (
          <div
            className="chord-lane__marquee"
            style={{ left: marquee.left, width: marquee.width }}
          />
        )}

        <TrackLaneResizeHandle
          height={laneH}
          onResize={(px) => setTrackLaneHeight(track.id, px)}
          onReset={() => resetTrackLaneHeight(track.id)}
        />
      </div>
    </div>
  );
}
