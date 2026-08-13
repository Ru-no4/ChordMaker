import { memo } from 'react';
import type { NoteItem } from '../store/useProjectStore';
import { midiToName } from '../lib/theory';
import type { CategoryStyle } from '../lib/colors';
import { rowHeight, rowTop } from '../lib/pianoRoll';

interface NoteProps {
  note: NoteItem;
  /** ブロック先頭の絶対 step 位置 */
  blockStart: number;
  stepW: number;
  zoomY: number;
  /** 所属セグメントのコードタイプ色 */
  style: CategoryStyle;
  selected: boolean;
  /** 消しゴムでなぞられ、離せば消える状態 */
  erasing: boolean;
  /** 選択中ブロック以外のノート。操作はできるが控えめに描く */
  dimmed: boolean;
}

/**
 * ピアノロール上の1ノート。表示専用。
 * ポインタ操作はグリッド側の usePianoRollGesture が
 * `data-note-id` / `data-note-handle` を見て一括で捌く。
 */
export const Note = memo(function Note({
  note,
  blockStart,
  stepW,
  zoomY,
  style,
  selected,
  erasing,
  dimmed,
}: NoteProps) {
  const h = rowHeight(zoomY);
  return (
    <div
      className={[
        'pr-note',
        selected ? 'is-selected' : '',
        erasing ? 'is-erasing' : '',
        dimmed ? 'pr-note--dim' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-note-id={note.id}
      style={
        {
          left: (blockStart + note.start) * stepW,
          top: rowTop(note.midi, zoomY),
          width: Math.max(3, note.length * stepW - 1),
          height: h - 1,
          fontSize: Math.min(11, Math.max(7, h * 0.58)),
          '--note-base': style.base,
          '--note-accent': style.accent,
        } as React.CSSProperties
      }
      title={midiToName(note.midi)}
    >
      {h >= 11 && <span className="pr-note__label">{midiToName(note.midi)}</span>}
      <div className="pr-note__handle pr-note__handle--left" data-note-handle="left" />
      <div className="pr-note__handle pr-note__handle--right" data-note-handle="right" />
    </div>
  );
});
