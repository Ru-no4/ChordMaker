/**
 * ピアノロールのポインタ操作をまとめて捌くジェスチャコントローラ。
 *
 * ノートごとにハンドラを付けるのではなく、グリッド1枚でイベント委譲する
 * （`data-note-id` / `data-note-handle` で当たりを判定）。
 * こうするとツールごとの分岐が1箇所に集まり、Note は表示だけを担える。
 *
 * 設計上の要点:
 *  - すべての操作がツール選択だけで到達できる（タッチで機能が欠けない）
 *  - 修飾キー・ダブルクリック・右クリックはデスクトップの近道
 *  - 複数ノートのドラッグは差分累積ではなくスナップショットからの再計算
 *  - 選択・削除・配置はブロックを跨いで働く
 */
import { useCallback, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import {
  useProjectStore,
  type ChordBlockItem,
  type NoteDragSnapshot,
} from '../store/useProjectStore';
import { quantizeSteps, snapLength, snapStep } from '../lib/grid';
import { capturePointer, isTap, releasePointer } from '../lib/pointer';
import { midiFromY, rowHeight } from '../lib/pianoRoll';
import { useEdgeAutoScroll } from './useEdgeAutoScroll';

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragOrigin {
  originX: number;
  originY: number;
  /** ドラッグ開始時のスクロール位置。自動スクロール分を差分に加算するため */
  originScrollLeft: number;
  originScrollTop: number;
  pointerType: string;
  moved: boolean;
}

type Gesture =
  | (DragOrigin & {
      kind: 'move';
      snapshots: NoteDragSnapshot[];
      anchor: NoteDragSnapshot;
      /** アンカーノートの絶対 step。スナップは絶対位置で行う */
      anchorAbsStart: number;
      lastMidi: number;
      /** タップで終わったときに適用する選択処理 */
      tapToggleId: string | null;
    })
  | (DragOrigin & {
      kind: 'resize';
      snapshots: NoteDragSnapshot[];
      anchor: NoteDragSnapshot;
      /** どちら側の端をつまんでいるか。左端は start と length を逆方向に、右端は length だけを変える */
      handle: 'left' | 'right';
    })
  | {
      kind: 'marquee';
      originX: number;
      originY: number;
      base: string[];
      additive: boolean;
    }
  | { kind: 'erase'; hot: Set<string>; lastX: number; lastY: number }
  | {
      kind: 'pan';
      originX: number;
      originY: number;
      scrollLeft: number;
      scrollTop: number;
    };

interface Params {
  /** `.pr-grid` 要素 */
  gridRef: RefObject<HTMLDivElement | null>;
  /** スクロールコンテナ（`.pr-body`）。パンと自動スクロールで動かす */
  scrollRef: RefObject<HTMLDivElement | null>;
  stepW: number;
  zoomY: number;
  /** グリッド先頭に確保している余白（px）。絶対 step へ変換する際に差し引く */
  marginPx: number;
  onPreview: (midi: number) => void;
}

const findNote = (blocks: ChordBlockItem[], noteId: string) => {
  for (const block of blocks) {
    const note = block.notes.find((n) => n.id === noteId);
    if (note) return { block, note };
  }
  return null;
};

/** その絶対 step を含むブロック */
const blockAt = (blocks: ChordBlockItem[], step: number) =>
  blocks.find((b) => step >= b.start && step < b.start + b.length) ?? null;

/**
 * 座標（絶対 step と MIDI 番号）にあるノートを探す。
 *
 * DOM の `event.target` を使わないのは、ドラッグ中にグリッドが
 * ポインタキャプチャを取ると click / dblclick の target が
 * キャプチャ先へ付け替えられ、ノートを取り出せなくなるため。
 */
const noteAtPoint = (blocks: ChordBlockItem[], step: number, midi: number) => {
  for (const b of blocks) {
    const hit = b.notes.find(
      (n) =>
        n.midi === midi &&
        b.start + n.start <= step &&
        b.start + n.start + n.length > step,
    );
    if (hit) return hit;
  }
  return null;
};

/** ダブルクリック / 右クリックでノートを消せるツール（マウス操作の近道） */
const DELETE_SHORTCUT_TOOLS = new Set(['draw', 'range']);

export function usePianoRollGesture({
  gridRef,
  scrollRef,
  stepW,
  zoomY,
  marginPx,
  onPreview,
}: Params) {
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPointRef = useRef({ x: 0, y: 0 });
  /** ドラッグ全体を1回の Undo にまとめるためのトランザクション状態 */
  const txOpenRef = useRef(false);

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [eraseHot, setEraseHot] = useState<string[]>([]);

  /* --------------------------------------------------------------- */
  /* 座標変換                                                         */
  /* --------------------------------------------------------------- */

  const localPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [gridRef],
  );

  const openTransaction = useCallback(() => {
    if (txOpenRef.current) return;
    txOpenRef.current = true;
    useProjectStore.getState().beginTransaction();
  }, []);

  const closeTransaction = useCallback(() => {
    if (!txOpenRef.current) return;
    txOpenRef.current = false;
    useProjectStore.getState().endTransaction();
  }, []);

  /* --------------------------------------------------------------- */
  /* ドラッグ内容の適用                                                */
  /* --------------------------------------------------------------- */

  /**
   * 現在のポインタ位置でジェスチャを適用し直す。
   * pointermove からも、自動スクロールのフレームからも呼ばれる。
   */
  const applyGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.kind === 'pan') return;

    const store = useProjectStore.getState();
    const { quantize, snap } = store;
    const { x: clientX, y: clientY } = lastPointRef.current;

    /* --- 矩形選択（ブロックを跨いで選べる） --- */
    if (g.kind === 'marquee') {
      const { x, y } = localPoint(clientX, clientY);
      const rect = {
        left: Math.min(g.originX, x),
        top: Math.min(g.originY, y),
        width: Math.abs(x - g.originX),
        height: Math.abs(y - g.originY),
      };
      setMarquee(rect);

      const hitStart = (rect.left - marginPx) / stepW;
      const hitEnd = (rect.left + rect.width - marginPx) / stepW;
      const midiA = midiFromY(rect.top, zoomY);
      const midiB = midiFromY(rect.top + rect.height, zoomY);
      const loMidi = Math.min(midiA, midiB);
      const hiMidi = Math.max(midiA, midiB);

      const ids: string[] = [];
      for (const b of store.blocks) {
        for (const n of b.notes) {
          const s = b.start + n.start;
          if (s < hitEnd && s + n.length > hitStart && n.midi >= loMidi && n.midi <= hiMidi) {
            ids.push(n.id);
          }
        }
      }
      store.selectNotes(g.additive ? [...g.base, ...ids] : ids);
      return;
    }

    /* --- なぞり削除（ブロックを跨いで消せる） --- */
    if (g.kind === 'erase') {
      const { x, y } = localPoint(clientX, clientY);

      // ポインタは飛び飛びに届く。前回位置との線分を補間しないと、
      // 素早くなぞったときに間のノートを取りこぼす。
      const dx = x - g.lastX;
      const dy = y - g.lastY;
      const samples = Math.max(
        1,
        Math.ceil(
          Math.max(Math.abs(dx) / (stepW / 2), Math.abs(dy) / (rowHeight(zoomY) / 2)),
        ),
      );

      let added = false;
      for (let i = 1; i <= samples; i++) {
        const px = g.lastX + (dx * i) / samples;
        const py = g.lastY + (dy * i) / samples;
        const hit = noteAtPoint(store.blocks, (px - marginPx) / stepW, midiFromY(py, zoomY));
        if (hit && !g.hot.has(hit.id)) {
          g.hot.add(hit.id);
          added = true;
        }
      }
      g.lastX = x;
      g.lastY = y;
      if (added) setEraseHot([...g.hot]);
      return;
    }

    /* --- 移動 / リサイズ --- */
    const scroller = scrollRef.current;
    // 自動スクロールで content が動いた分も差分に含める
    const scrollDx = (scroller?.scrollLeft ?? 0) - g.originScrollLeft;
    const scrollDy = (scroller?.scrollTop ?? 0) - g.originScrollTop;
    const dx = clientX - g.originX + scrollDx;
    const dy = clientY - g.originY + scrollDy;

    if (!g.moved && !isTap(g.pointerType, dx, dy)) g.moved = true;
    if (!g.moved) return;

    if (g.kind === 'resize') {
      if (g.handle === 'left') {
        // 左端は「末尾を固定して start を動かす」。長さの吸着は動いた分そのままに掛ける。
        const wantedStart = g.anchor.start + dx / stepW;
        const snappedStart = snapStep(wantedStart, quantize, snap);
        store.applyNoteResizeLeft(g.snapshots, snappedStart - g.anchor.start);
        return;
      }
      const wanted = g.anchor.length + dx / stepW;
      const snapped = snapLength(wanted, quantize, snap);
      store.applyNoteResize(g.snapshots, snapped - g.anchor.length);
      return;
    }

    // 掴んだノートの「絶対位置」をグリッドに吸着させ、他は同じ差分で追従させる
    const wantedAbs = g.anchorAbsStart + dx / stepW;
    const snappedAbs = snapStep(wantedAbs, quantize, snap);
    const dStep = snappedAbs - g.anchorAbsStart;
    const dMidi = -Math.round(dy / rowHeight(zoomY));
    store.applyNoteDrag(g.snapshots, dStep, dMidi);

    const midi = g.anchor.midi + dMidi;
    if (midi !== g.lastMidi) {
      g.lastMidi = midi;
      onPreview(midi);
    }
  }, [localPoint, marginPx, onPreview, scrollRef, stepW, zoomY]);

  const autoScroll = useEdgeAutoScroll(scrollRef, {
    vertical: true,
    onScrolled: applyGesture,
  });

  /* --------------------------------------------------------------- */
  /* ジェスチャの後始末                                                */
  /* --------------------------------------------------------------- */

  /** 進行中のジェスチャを取り消して元に戻す（2本指パンへ切り替える時など） */
  const abortGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    const store = useProjectStore.getState();
    switch (g.kind) {
      case 'move':
        store.applyNoteDrag(g.snapshots, 0, 0);
        break;
      case 'resize':
        if (g.handle === 'left') store.applyNoteResizeLeft(g.snapshots, 0);
        else store.applyNoteResize(g.snapshots, 0);
        break;
      case 'marquee':
        store.selectNotes(g.base);
        setMarquee(null);
        break;
      case 'erase':
        setEraseHot([]);
        break;
      default:
        break;
    }
    gestureRef.current = null;
    autoScroll.stop();
    closeTransaction();
  }, [autoScroll, closeTransaction]);

  /* --------------------------------------------------------------- */
  /* パン                                                             */
  /* --------------------------------------------------------------- */

  const beginPan = useCallback(
    (clientX: number, clientY: number) => {
      const scroller = scrollRef.current;
      gestureRef.current = {
        kind: 'pan',
        originX: clientX,
        originY: clientY,
        scrollLeft: scroller?.scrollLeft ?? 0,
        scrollTop: scroller?.scrollTop ?? 0,
      };
    },
    [scrollRef],
  );

  const centroid = () => {
    const points = [...pointersRef.current.values()];
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  };

  /* --------------------------------------------------------------- */
  /* 選択・スナップショット                                            */
  /* --------------------------------------------------------------- */

  const snapshotSelection = useCallback((): NoteDragSnapshot[] => {
    const { blocks, selectedNoteIds } = useProjectStore.getState();
    const wanted = new Set(selectedNoteIds);
    return blocks.flatMap((b) =>
      b.notes
        .filter((n) => wanted.has(n.id))
        .map((n) => ({
          blockId: b.id,
          noteId: n.id,
          start: n.start,
          length: n.length,
          midi: n.midi,
        })),
    );
  }, []);

  /* --------------------------------------------------------------- */
  /* pointerdown                                                      */
  /* --------------------------------------------------------------- */

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const grid = gridRef.current;
      if (!grid) return;
      if (e.button !== 0 && e.button !== 1) return;

      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastPointRef.current = { x: e.clientX, y: e.clientY };

      // 指が2本になったら、どのツールでも一時的にパンへ切り替える
      if (pointersRef.current.size === 2) {
        abortGesture();
        const c = centroid();
        beginPan(c.x, c.y);
        return;
      }
      if (pointersRef.current.size > 2) return;

      capturePointer(grid, e.pointerId);

      const store = useProjectStore.getState();
      const { editorTool, blocks, quantize, snap } = store;
      const scroller = scrollRef.current;

      const { x, y } = localPoint(e.clientX, e.clientY);
      const target = e.target as HTMLElement;
      const noteEl = target.closest<HTMLElement>('[data-note-id]');
      const noteId = noteEl?.dataset.noteId ?? null;
      const handleEl = target.closest<HTMLElement>('[data-note-handle]');
      const handleSide = handleEl?.dataset.noteHandle as 'left' | 'right' | undefined;

      /* --- パン（手ツール / 中ボタン） --- */
      if (editorTool === 'pan' || e.button === 1) {
        beginPan(e.clientX, e.clientY);
        return;
      }

      /* --- 消しゴム --- */
      if (editorTool === 'erase') {
        openTransaction();
        const hot = new Set<string>();
        if (noteId) hot.add(noteId);
        gestureRef.current = { kind: 'erase', hot, lastX: x, lastY: y };
        setEraseHot([...hot]);
        return;
      }

      /* --- Shift+クリック: 選択のトグル（デスクトップの近道） --- */
      if (noteId && e.shiftKey) {
        store.toggleNoteSelection(noteId);
        gestureRef.current = null;
        return;
      }

      const origin: DragOrigin = {
        originX: e.clientX,
        originY: e.clientY,
        originScrollLeft: scroller?.scrollLeft ?? 0,
        originScrollTop: scroller?.scrollTop ?? 0,
        pointerType: e.pointerType,
        moved: false,
      };

      /* --- ノート上 --- */
      if (noteId) {
        const found = findNote(blocks, noteId);
        if (!found) return;

        // 掴んでから離すまでを1回の Undo にまとめる。
        // Ctrl ドラッグの複製もこの中に入れる。
        openTransaction();

        const alreadySelected = store.selectedNoteIds.includes(noteId);
        let tapToggleId: string | null = null;

        if (editorTool === 'range') {
          // 範囲選択モードはタップでトグル。修飾キーの無いタッチでも
          // 選択の追加・解除ができるようにするため。
          if (!alreadySelected) store.selectNotes([noteId], true);
          else tapToggleId = noteId;
        } else if (!alreadySelected) {
          store.selectNotes([noteId]);
        }

        let snapshots = snapshotSelection();

        // Ctrl(Cmd)+ドラッグ: 複製した方を掴んで動かす
        if (e.ctrlKey || e.metaKey) {
          const clones = store.duplicateSelectedNotes();
          if (clones.length > 0) snapshots = clones;
        }

        const anchor = snapshots.find((s) => s.noteId === noteId) ?? snapshots[0];
        if (!anchor) {
          closeTransaction();
          return;
        }

        gestureRef.current = handleSide
          ? { ...origin, kind: 'resize', snapshots, anchor, handle: handleSide }
          : {
              ...origin,
              kind: 'move',
              snapshots,
              anchor,
              anchorAbsStart: found.block.start + anchor.start,
              lastMidi: anchor.midi,
              tapToggleId,
            };
        return;
      }

      /* --- 背景 --- */
      const wantsMarquee = editorTool === 'range' || e.shiftKey;
      if (wantsMarquee) {
        gestureRef.current = {
          kind: 'marquee',
          originX: x,
          originY: y,
          base: e.shiftKey ? store.selectedNoteIds : [],
          additive: e.shiftKey,
        };
        setMarquee({ left: x, top: y, width: 0, height: 0 });
        return;
      }

      if (editorTool === 'draw') {
        // どのブロックの上でも置ける。置いた先のブロックを選択状態にする。
        const absStep = (x - marginPx) / stepW;
        const targetBlock = blockAt(blocks, absStep);
        if (!targetBlock) {
          store.clearNoteSelection();
          return;
        }
        if (targetBlock.id !== store.selectedBlockId) store.selectBlock(targetBlock.id);

        // 配置とそれに続く長さ調整をまとめて1回の Undo にする
        openTransaction();
        const midi = midiFromY(y, zoomY);
        const length = snap ? quantizeSteps(quantize) : 4;
        const newId = store.addNote(targetBlock.id, midi, absStep - targetBlock.start, length);
        if (!newId) {
          closeTransaction();
          return;
        }
        onPreview(midi);

        // そのままドラッグすると長さを決められる（DAW の鉛筆と同じ）
        const created = findNote(useProjectStore.getState().blocks, newId);
        if (!created) {
          closeTransaction();
          return;
        }
        const anchor: NoteDragSnapshot = {
          blockId: targetBlock.id,
          noteId: newId,
          start: created.note.start,
          length: created.note.length,
          midi: created.note.midi,
        };
        gestureRef.current = { ...origin, kind: 'resize', snapshots: [anchor], anchor, handle: 'right' };
        return;
      }

      store.clearNoteSelection();
    },
    [
      abortGesture,
      beginPan,
      gridRef,
      localPoint,
      marginPx,
      onPreview,
      scrollRef,
      snapshotSelection,
      stepW,
      zoomY,
    ],
  );

  /* --------------------------------------------------------------- */
  /* pointermove                                                      */
  /* --------------------------------------------------------------- */

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const g = gestureRef.current;
      if (!g) return;

      lastPointRef.current = { x: e.clientX, y: e.clientY };

      /* --- パン --- */
      if (g.kind === 'pan') {
        const point = pointersRef.current.size >= 2 ? centroid() : { x: e.clientX, y: e.clientY };
        const scroller = scrollRef.current;
        if (scroller) {
          scroller.scrollLeft = g.scrollLeft - (point.x - g.originX);
          scroller.scrollTop = g.scrollTop - (point.y - g.originY);
        }
        return;
      }

      applyGesture();
      // 端に寄ったら自動でスクロールを送る
      autoScroll.update(e.clientX, e.clientY);
    },
    [applyGesture, autoScroll, scrollRef],
  );

  /* --------------------------------------------------------------- */
  /* pointerup / cancel                                               */
  /* --------------------------------------------------------------- */

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      pointersRef.current.delete(e.pointerId);
      if (gridRef.current) releasePointer(gridRef.current, e.pointerId);

      // まだ指が残っているなら、ジェスチャは継続中
      if (pointersRef.current.size > 0) return;

      const g = gestureRef.current;
      if (!g) {
        closeTransaction();
        return;
      }

      autoScroll.stop();
      const store = useProjectStore.getState();

      if (g.kind === 'marquee') {
        setMarquee(null);
      } else if (g.kind === 'erase') {
        if (!cancelled && g.hot.size > 0) store.removeNotes([...g.hot]);
        setEraseHot([]);
      } else if (g.kind === 'move' && !g.moved && g.tapToggleId) {
        // 範囲選択モードで「選択済みノートをタップ」＝選択から外す
        store.toggleNoteSelection(g.tapToggleId);
      }

      gestureRef.current = null;
      closeTransaction();
    },
    [autoScroll, closeTransaction, gridRef],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, false),
    [finish],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => finish(e, true),
    [finish],
  );

  /* --------------------------------------------------------------- */
  /* マウスの近道: ダブルクリック / 右クリックで削除                     */
  /* --------------------------------------------------------------- */

  /** 座標にあるノートを消す。target ではなく座標で引くのは noteAtPoint のコメント参照。 */
  const deleteNoteAt = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): boolean => {
      const { x, y } = localPoint(e.clientX, e.clientY);
      const store = useProjectStore.getState();
      const hit = noteAtPoint(store.blocks, (x - marginPx) / stepW, midiFromY(y, zoomY));
      if (!hit) return false;
      store.removeNotes([hit.id]);
      return true;
    },
    [localPoint, marginPx, stepW, zoomY],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!DELETE_SHORTCUT_TOOLS.has(useProjectStore.getState().editorTool)) return;
      if (deleteNoteAt(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [deleteNoteAt],
  );

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // 手ツールは「内容に触れない安全モード」なので何もしない
      if (useProjectStore.getState().editorTool === 'pan') return;
      e.preventDefault();
      e.stopPropagation();
      deleteNoteAt(e);
    },
    [deleteNoteAt],
  );

  return {
    marquee,
    eraseHot,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // キャプチャを失っても掴みっぱなしにならないよう後始末する
      onLostPointerCapture: onPointerCancel,
      onDoubleClick,
      onContextMenu,
    },
  };
}
