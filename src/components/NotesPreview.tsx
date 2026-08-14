import type { CSSProperties } from 'react';
import type { NoteItem } from '../store/useProjectStore';

interface NotesPreviewProps {
  notes: NoteItem[];
  stepW: number;
  /** ブロックの表示高さ(px) */
  height: number;
  /** トラック固有の色。コードのようなカテゴリ色分けは行わない */
  color: string;
}

/** ピッチ方向に最低限これだけの幅（半音数）は確保する（単音の伸ばしノートが全高を覆わないように） */
const MIN_PITCH_SPAN = 12;
/** 鳴っている音の上下にこれだけ余白を足す（半音数） */
const PITCH_PADDING = 2;

/**
 * 通常トラックのブロック内プレビュー。コード判定は行わず、
 * 鳴っているノートをピッチ×時間の小さい矩形として並べるだけ
 * （従来のDAWのアレンジビューにあるクリッププレビューに近い）。
 * ノート単位の編集はブロックを選択してピアノロールで行うため、
 * ここではポインタ操作を持たない。
 */
export function NotesPreview({ notes, stepW, height, color }: NotesPreviewProps) {
  if (notes.length === 0) return null;

  const midis = notes.map((n) => n.midi);
  const rawMin = Math.min(...midis);
  const rawMax = Math.max(...midis);
  const mid = (rawMin + rawMax) / 2;
  const span = Math.max(MIN_PITCH_SPAN, rawMax - rawMin + PITCH_PADDING * 2);
  const top = mid + span / 2;
  const rowH = height / span;

  return (
    <div className="notes-preview" style={{ '--notes-preview-color': color } as CSSProperties}>
      {notes.map((n) => (
        <div
          key={n.id}
          className="notes-preview__note"
          style={{
            left: n.start * stepW,
            width: Math.max(3, n.length * stepW - 1),
            top: (top - n.midi) * rowH,
            height: Math.max(2, rowH - 1),
          }}
        />
      ))}
    </div>
  );
}
