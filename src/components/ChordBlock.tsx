import { useCallback, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore, type ChordBlockItem, type NoteDragSnapshot } from '../store/useProjectStore';
import { blockHeight, chordResolutionSteps, snapStep } from '../lib/grid';
import { capturePointer, isTap, releasePointer } from '../lib/pointer';
import { segmentsFor, type ChordSegment as ChordSegmentData } from '../lib/segmentation';
import { EMPTY_RESULT } from '../lib/theory';
import { ChordSegment } from './ChordSegment';
import { NotesPreview } from './NotesPreview';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';

type DragMode = 'move' | 'resize-left' | 'resize-right';

interface ChordBlockProps {
  /** このブロックが属するトラック。複数トラックが並ぶため、アクティブトラックとは限らない */
  trackId: string;
  block: ChordBlockItem;
  stepW: number;
  zoomY: number;
  /** レーンの実表示高さ(px)。ズームとは独立に手動調整できるため、ブロックの中央寄せに使う */
  laneH: number;
  selected: boolean;
  /** 'chord' はコード判定表示、'notes' はノートのミニプレビュー表示 */
  trackKind: 'chord' | 'notes';
  /** 'notes' トラックのプレビューに使うトラック固有の色 */
  trackColor: string;
}

/**
 * ドラッグの内部状態。
 *  - 'block': ブロック全体の移動・端リサイズ（Ctrl を伴わない、単一コードのブロック）。
 *  - 'segment': 掴んだセグメントのノートだけを動かす。小節内に複数コードがある場合の
 *    通常ドラッグと、Ctrl(Cmd)+ドラッグでの複製（単一コードのブロックも含めて常にこちら）
 *    の両方をここで扱う。applyNoteDrag に乗せるので、ピアノロールのノートドラッグと
 *    同じ経路でブロックを跨いだ移動・複製ができ、既存ブロックの隙間の有無に縛られない。
 */
type Drag =
  | {
      kind: 'block';
      mode: DragMode;
      targetId: string;
      originX: number;
      originY: number;
      pointerType: string;
      origStart: number;
      origLength: number;
      moved: boolean;
      /** 掴んだ時点で選択済みだったか（pointerup 時には選択済みになっている） */
      wasSelected: boolean;
    }
  | {
      kind: 'segment';
      snapshots: NoteDragSnapshot[];
      /** 複製元のノートID（ドラッグせずに離したときの自動配置に使う） */
      originalNoteIds: string[];
      /** Ctrl(Cmd) を押しての複製操作か */
      isDuplicate: boolean;
      /** 複製操作で、実際に複製処理を実行済みか（動き始めた最初の1回だけ行う） */
      duplicated: boolean;
      /** スナップの基準にするセグメント左端の絶対 step */
      anchorAbsStart: number;
      originX: number;
      originY: number;
      pointerType: string;
      moved: boolean;
      /** 掴んだ時点で「このブロックのこのセグメント」が既にアクティブだったか */
      wasSameSegment: boolean;
    };

/** セグメントの時間範囲に鳴っているノート（重なりで判定） */
function notesInSegment(notes: ChordBlockItem['notes'], seg: ChordSegmentData) {
  const end = seg.start + seg.length;
  return notes.filter((n) => n.start < end && n.start + n.length > seg.start);
}

/**
 * コードタイムライン上の1ブロック。
 * ブロック自体は「ノートの入れ物」で、コード名と色は中のセグメントが持つ。
 */
export function ChordBlock({
  trackId,
  block,
  stepW,
  zoomY,
  laneH,
  selected,
  trackKind,
  trackColor,
}: ChordBlockProps) {
  const selectBlock = useProjectStore((s) => s.selectBlock);
  const toggleBlockSelection = useProjectStore((s) => s.toggleBlockSelection);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectedSegmentStart = useProjectStore((s) => s.selectedSegmentStart);
  const setPianoRollOpen = useProjectStore((s) => s.setPianoRollOpen);
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const resizeBlock = useProjectStore((s) => s.resizeBlock);
  const removeBlock = useProjectStore((s) => s.removeBlock);
  const editorTool = useProjectStore((s) => s.editorTool);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const chordResolution = useProjectStore((s) => s.chordResolution);
  const quantize = useProjectStore((s) => s.quantize);
  const snap = useProjectStore((s) => s.snap);
  const selectNotes = useProjectStore((s) => s.selectNotes);
  const duplicateSelectedNotes = useProjectStore((s) => s.duplicateSelectedNotes);
  const applyNoteDrag = useProjectStore((s) => s.applyNoteDrag);
  const duplicateNotesToNearestGap = useProjectStore((s) => s.duplicateNotesToNearestGap);

  const dragRef = useRef<Drag | null>(null);
  const { t } = useT();
  const cbk = strings.chordBlock;

  const segments = useMemo(() => {
    if (trackKind === 'notes') {
      // 通常トラックはコード区切りという概念が無いので、ブロック全体を
      // 覆う疑似セグメント1個として扱う。こうすると「単一コードのブロック」
      // と同じ経路（block単位のドラッグ・リサイズ・Ctrl複製）がそのまま
      // 安全に動く一方、コード区切りでのセグメント単位ドラッグだけが
      // 自然に発生しなくなる（segments.length は常に1のため）。
      return [{ start: 0, length: block.length, detection: EMPTY_RESULT, midis: [] }];
    }
    return segmentsFor(block, chordResolutionSteps(timeSignature, chordResolution));
  }, [block, chordResolution, timeSignature, trackKind]);

  const activeStart = useMemo(() => {
    if (!selected) return null;
    if (selectedSegmentStart === null) return segments[0]?.start ?? null;
    return (
      segments.find(
        (s) => selectedSegmentStart >= s.start && selectedSegmentStart < s.start + s.length,
      )?.start ?? null
    );
  }, [segments, selected, selectedSegmentStart]);

  const single = segments.length <= 1;

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;

      // 手ツールはレーン側のパンに任せる（ブロックには触らない）
      if (editorTool === 'pan') return;

      e.stopPropagation();

      // 消しゴムはタップで削除
      if (editorTool === 'erase') {
        removeBlock(trackId, block.id);
        return;
      }

      // Shift+クリック: 複数選択のトグル（ドラッグは始めない。デスクトップの近道）
      if (mode === 'move' && e.shiftKey) {
        toggleBlockSelection(trackId, block.id);
        return;
      }

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relStep = (e.clientX - rect.left) / stepW;
      const clickedSeg =
        segments.find((s) => relStep >= s.start && relStep < s.start + s.length) ?? segments[0] ?? null;
      const isDuplicate = mode === 'move' && (e.ctrlKey || e.metaKey);

      capturePointer(e.currentTarget as HTMLElement, e.pointerId);
      // 掴んでから離すまでを1回の Undo にまとめる（複製もこの中に入れる）
      useProjectStore.getState().beginTransaction();

      // ---- セグメント単位で動く場合: Ctrl での複製は常にこちら、
      //      Ctrl 無しでも小節内に複数コードがあるときはこちら ----
      if (mode === 'move' && (isDuplicate || !single) && clickedSeg) {
        const wasSameSegment =
          selected &&
          selectedSegmentStart !== null &&
          selectedSegmentStart >= clickedSeg.start &&
          selectedSegmentStart < clickedSeg.start + clickedSeg.length;

        selectBlock(trackId, block.id);
        selectSegment(clickedSeg.start);

        const segNotes = notesInSegment(block.notes, clickedSeg);
        const noteIds = segNotes.map((n) => n.id);
        selectNotes(noteIds);

        const snapshots: NoteDragSnapshot[] = segNotes.map((n) => ({
          blockId: block.id,
          noteId: n.id,
          start: n.start,
          length: n.length,
          midi: n.midi,
        }));

        dragRef.current = {
          kind: 'segment',
          snapshots,
          originalNoteIds: noteIds,
          isDuplicate,
          duplicated: false,
          anchorAbsStart: block.start + clickedSeg.start,
          originX: e.clientX,
          originY: e.clientY,
          pointerType: e.pointerType,
          moved: false,
          wasSameSegment: !!wasSameSegment,
        };
        return;
      }

      // ---- 通常（単一コードのブロック本体、または端のリサイズ）はブロック単位で動く ----
      selectBlock(trackId, block.id);

      dragRef.current = {
        kind: 'block',
        mode,
        targetId: block.id,
        originX: e.clientX,
        originY: e.clientY,
        pointerType: e.pointerType,
        origStart: block.start,
        origLength: block.length,
        moved: false,
        wasSelected: selected,
      };

      // 掴んだ位置のセグメントをアクティブにする
      if (mode === 'move') {
        selectSegment(relStep);
      }
    },
    [
      block.id,
      block.start,
      block.length,
      block.notes,
      editorTool,
      removeBlock,
      segments,
      selectBlock,
      selectedSegmentStart,
      selected,
      selectNotes,
      selectSegment,
      single,
      stepW,
      toggleBlockSelection,
      trackId,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.moved && !isTap(drag.pointerType, e.clientX - drag.originX, e.clientY - drag.originY)) {
        drag.moved = true;
      }
      if (!drag.moved) return;

      if (drag.kind === 'segment') {
        // 複製操作は、実際に動き始めた最初の瞬間だけノートを複製する
        // （タップのみで終わった場合は複製しない or 別経路で自動配置する）
        if (drag.isDuplicate && !drag.duplicated) {
          const clones = duplicateSelectedNotes();
          if (clones.length > 0) drag.snapshots = clones;
          drag.duplicated = true;
        }
        const wantedAbs = drag.anchorAbsStart + (e.clientX - drag.originX) / stepW;
        const snappedAbs = snapStep(wantedAbs, quantize, snap);
        applyNoteDrag(drag.snapshots, snappedAbs - drag.anchorAbsStart, 0);
        return;
      }

      const deltaSteps = (e.clientX - drag.originX) / stepW;
      switch (drag.mode) {
        case 'move':
          moveBlock(trackId, drag.targetId, drag.origStart + deltaSteps);
          break;
        case 'resize-right':
          resizeBlock(trackId, drag.targetId, drag.origLength + deltaSteps);
          break;
        case 'resize-left':
          resizeBlock(trackId, drag.targetId, drag.origLength - deltaSteps, true);
          break;
      }
    },
    [applyNoteDrag, duplicateSelectedNotes, moveBlock, quantize, resizeBlock, snap, stepW, trackId],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      releasePointer(e.currentTarget as HTMLElement, e.pointerId);
      if (!drag) return;

      if (drag.kind === 'segment' && !drag.moved && drag.isDuplicate) {
        // ドラッグせずに Ctrl+タップだけで終えた場合、最寄りの空き区間へ自動配置する
        // （既存ブロックの隙間に縛られず、無ければ元の位置に重ねて複製する）。
        // endTransaction より前に行い、掴んでから離すまでを1回の Undo にまとめる。
        duplicateNotesToNearestGap(trackId, drag.originalNoteIds);
      }
      useProjectStore.getState().endTransaction();

      if (drag.kind === 'segment') {
        if (!drag.moved && !drag.isDuplicate) {
          if (drag.wasSameSegment) {
            // タップ（＝動かしていない）で、既にアクティブだった同じセグメントを
            // 再度タップしたら選択解除。違うセグメント・違うブロックへの
            // 切り替えは選択したままにする（ピアノロールも閉じない）。
            selectBlock(trackId, null);
          } else {
            setPianoRollOpen(true);
          }
        }
        return;
      }

      // タップ（＝動かしていない）で、既に選択済みのブロックを再度タップしたら選択解除。
      // ピアノロールの開閉には触れない（閉じる必要は無い）。
      // 未選択のブロックを選んだときはピアノロールを必ず開く。
      if (drag.mode === 'move' && !drag.moved) {
        if (drag.wasSelected) selectBlock(trackId, null);
        else setPianoRollOpen(true);
      }
    },
    [duplicateNotesToNearestGap, selectBlock, setPianoRollOpen, trackId],
  );

  const height = blockHeight(zoomY);

  return (
    <div
      className={`chord-block ${selected ? 'is-selected' : ''} tool-${editorTool}`}
      style={{
        left: block.start * stepW,
        width: block.length * stepW,
        top: (laneH - height) / 2,
        height,
      }}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        removeBlock(trackId, block.id);
      }}
    >
      {trackKind === 'notes' ? (
        <NotesPreview notes={block.notes} stepW={stepW} height={height} color={trackColor} />
      ) : (
        segments.map((seg, i) => (
          <ChordSegment
            key={`${seg.start}-${i}`}
            segment={seg}
            index={i}
            stepW={stepW}
            height={height}
            single={single}
            first={i === 0}
            active={seg.start === activeStart}
          />
        ))
      )}

      <div
        className="chord-block__handle chord-block__handle--left"
        onPointerDown={onPointerDown('resize-left')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        aria-label={t(cbk.resizeLeftAria)}
      />
      <div
        className="chord-block__handle chord-block__handle--right"
        onPointerDown={onPointerDown('resize-right')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        aria-label={t(cbk.resizeRightAria)}
      />
    </div>
  );
}
