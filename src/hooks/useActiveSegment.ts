import { useProjectStore, type ChordBlockItem } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';
import { segmentAt, type ChordSegment } from '../lib/segmentation';

/**
 * 表示対象のセグメントを決める。
 *   ユーザーが選んだもの → 再生中なら再生ヘッド位置 → 先頭
 *
 * 再生ヘッドはセレクタの中でセグメント開始位置に丸めているので、
 * 毎フレーム更新されてもセグメントを跨いだ時しか再レンダリングされない。
 */
export function useActiveSegmentStart(
  block: ChordBlockItem | null,
  segments: ChordSegment[],
  enabled = true,
): number | null {
  const selectedSegmentStart = useProjectStore((s) => s.selectedSegmentStart);
  const isPlaying = useProjectStore((s) => s.isPlaying);

  const playheadStart = usePlayheadStore((s) => {
    if (!enabled || !block || !isPlaying) return null;
    const rel = s.step - block.start;
    if (rel < 0 || rel >= block.length) return null;
    return segmentAt(segments, rel)?.start ?? null;
  });

  if (!enabled || segments.length === 0) return null;
  if (selectedSegmentStart !== null) {
    return segmentAt(segments, selectedSegmentStart)?.start ?? segments[0].start;
  }
  if (playheadStart !== null) return playheadStart;
  return segments[0].start;
}
