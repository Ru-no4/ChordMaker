import { styleFor } from '../lib/colors';
import type { ChordSegment as Segment } from '../lib/segmentation';

interface ChordSegmentProps {
  segment: Segment;
  index: number;
  stepW: number;
  /** ブロックの高さ。表示倍率で変わるので文字量を調整する */
  height: number;
  /** ブロック内で唯一のセグメントか */
  single: boolean;
  first: boolean;
  active: boolean;
}

/**
 * コードブロック内の1コード分のセル。
 * ブロックは入れ物で、色と和音名はセグメント側が持つ。
 */
export function ChordSegment({
  segment,
  index,
  stepW,
  height,
  single,
  first,
  active,
}: ChordSegmentProps) {
  const { detection } = segment;
  const style = styleFor(detection.chord?.category ?? null);
  const width = segment.length * stepW;

  const label =
    detection.kind === 'chord'
      ? detection.chord!.symbol
      : detection.kind === 'candidates'
        ? `${detection.candidates[0]?.symbol ?? '?'} ?`
        : '—';

  const sub =
    detection.kind === 'chord'
      ? detection.chord!.degrees.join(' ')
      : detection.kind === 'candidates'
        ? `候補 ${detection.candidates.length} 件`
        : 'ノート未入力';

  // 幅と高さに応じて表示要素を落とす
  const showSub = width >= 110 && height >= 44;
  const showTag = width >= 76 && height >= 52;
  const symbolSize = Math.max(11, Math.min(20, height * 0.29));

  return (
    <div
      className={[
        'chord-seg',
        active && !single ? 'is-active' : '',
        first ? 'is-first' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-segment-start={segment.start}
      style={
        {
          left: segment.start * stepW,
          width,
          '--seg-base': style.base,
          '--seg-accent': style.accent,
        } as React.CSSProperties
      }
      title={`${index + 1}. ${label}`}
    >
      <span className="chord-seg__symbol" style={{ fontSize: symbolSize }}>
        {label}
      </span>
      {showSub && <span className="chord-seg__sub">{sub}</span>}
      {showTag && <span className="chord-seg__tag">{style.label}</span>}
    </div>
  );
}
