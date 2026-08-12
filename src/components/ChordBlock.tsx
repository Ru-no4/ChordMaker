import { useCallback, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore, type ChordBlockItem } from '../store/useProjectStore';
import { blockHeight, chordResolutionSteps, laneHeight as laneHeightOf } from '../lib/grid';
import { capturePointer, isTap, releasePointer } from '../lib/pointer';
import { segmentsFor } from '../lib/segmentation';
import { ChordSegment } from './ChordSegment';

type DragMode = 'move' | 'resize-left' | 'resize-right';

interface ChordBlockProps {
  block: ChordBlockItem;
  stepW: number;
  zoomY: number;
  selected: boolean;
}

/**
 * コードタイムライン上の1ブロック。
 * ブロック自体は「ノートの入れ物」で、コード名と色は中のセグメントが持つ。
 */
export function ChordBlock({ block, stepW, zoomY, selected }: ChordBlockProps) {
  const selectBlock = useProjectStore((s) => s.selectBlock);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectedSegmentStart = useProjectStore((s) => s.selectedSegmentStart);
  const setPianoRollOpen = useProjectStore((s) => s.setPianoRollOpen);
  const pianoRollOpen = useProjectStore((s) => s.pianoRollOpen);
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const resizeBlock = useProjectStore((s) => s.resizeBlock);
  const removeBlock = useProjectStore((s) => s.removeBlock);
  const duplicateBlock = useProjectStore((s) => s.duplicateBlock);
  const editorTool = useProjectStore((s) => s.editorTool);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const chordResolution = useProjectStore((s) => s.chordResolution);

  const dragRef = useRef<{
    mode: DragMode;
    /** Ctrl ドラッグで複製した場合、動かす対象は複製の方になる */
    targetId: string;
    originX: number;
    originY: number;
    pointerType: string;
    origStart: number;
    origLength: number;
    moved: boolean;
    /** 掴んだ時点で選択済みだったか（pointerup 時には選択済みになっている） */
    wasSelected: boolean;
  } | null>(null);

  const segments = useMemo(
    () => segmentsFor(block, chordResolutionSteps(timeSignature, chordResolution)),
    [block, chordResolution, timeSignature],
  );

  const activeStart = useMemo(() => {
    if (!selected) return null;
    if (selectedSegmentStart === null) return segments[0]?.start ?? null;
    return (
      segments.find(
        (s) => selectedSegmentStart >= s.start && selectedSegmentStart < s.start + s.length,
      )?.start ?? null
    );
  }, [segments, selected, selectedSegmentStart]);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;

      // 手ツールはレーン側のパンに任せる（ブロックには触らない）
      if (editorTool === 'pan') return;

      e.stopPropagation();

      // 消しゴムはタップで削除
      if (editorTool === 'erase') {
        removeBlock(block.id);
        return;
      }

      capturePointer(e.currentTarget as HTMLElement, e.pointerId);
      // 掴んでから離すまでを1回の Undo にまとめる（複製もこの中に入れる）
      useProjectStore.getState().beginTransaction();

      let targetId = block.id;
      let origStart = block.start;
      let origLength = block.length;

      // Ctrl(Cmd)+ドラッグ: 複製した方を掴んで動かす
      if (mode === 'move' && (e.ctrlKey || e.metaKey)) {
        const dupId = duplicateBlock(block.id);
        const dup = dupId ? useProjectStore.getState().blocks.find((b) => b.id === dupId) : null;
        if (dup) {
          targetId = dup.id;
          origStart = dup.start;
          origLength = dup.length;
        } else {
          selectBlock(block.id);
        }
      } else {
        selectBlock(block.id);
      }

      dragRef.current = {
        mode,
        targetId,
        originX: e.clientX,
        originY: e.clientY,
        pointerType: e.pointerType,
        origStart,
        origLength,
        moved: false,
        wasSelected: selected,
      };

      // 掴んだ位置のセグメントをアクティブにする
      if (mode === 'move') {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        selectSegment((e.clientX - rect.left) / stepW);
      }
    },
    [
      block.id,
      block.start,
      block.length,
      duplicateBlock,
      editorTool,
      removeBlock,
      selectBlock,
      selectSegment,
      selected,
      stepW,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaSteps = (e.clientX - drag.originX) / stepW;
      if (!drag.moved && !isTap(drag.pointerType, e.clientX - drag.originX, e.clientY - drag.originY)) {
        drag.moved = true;
      }
      if (!drag.moved) return;

      switch (drag.mode) {
        case 'move':
          moveBlock(drag.targetId, drag.origStart + deltaSteps);
          break;
        case 'resize-right':
          resizeBlock(drag.targetId, drag.origLength + deltaSteps);
          break;
        case 'resize-left':
          resizeBlock(drag.targetId, drag.origLength - deltaSteps, true);
          break;
      }
    },
    [moveBlock, resizeBlock, stepW],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      releasePointer(e.currentTarget as HTMLElement, e.pointerId);
      if (!drag) return;
      useProjectStore.getState().endTransaction();
      // タップ（＝動かしていない）ならピアノロールを開閉。
      // 未選択のブロックを選んだときは必ず開く。
      if (drag.mode === 'move' && !drag.moved) {
        setPianoRollOpen(drag.wasSelected ? !pianoRollOpen : true);
      }
    },
    [pianoRollOpen, setPianoRollOpen],
  );

  const single = segments.length <= 1;
  const height = blockHeight(zoomY);

  return (
    <div
      className={`chord-block ${selected ? 'is-selected' : ''} tool-${editorTool}`}
      style={{
        left: block.start * stepW,
        width: block.length * stepW,
        top: (laneHeightOf(zoomY) - height) / 2,
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
        removeBlock(block.id);
      }}
    >
      {segments.map((seg, i) => (
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
      ))}

      <div
        className="chord-block__handle chord-block__handle--left"
        onPointerDown={onPointerDown('resize-left')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        aria-label="長さ変更（左）"
      />
      <div
        className="chord-block__handle chord-block__handle--right"
        onPointerDown={onPointerDown('resize-right')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        aria-label="長さ変更（右）"
      />
    </div>
  );
}
