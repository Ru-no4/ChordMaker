import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { followScrollLeft } from '../lib/edgeScroll';
import { useProjectStore } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';

/**
 * 再生ヘッドを画面中央に保つ自動スクロール（DAW でいうオートスクロール）。
 *
 * 目標スクロール位置は「再生ヘッドが表示領域の中央に来る値」。
 * これを 0 でクランプするだけで、要求どおりの3つの挙動が自然に出る:
 *  - 中央より左にいる間は目標が負になるのでスクロールしない（ヘッドだけが中央へ向かう）
 *  - 中央に達したらヘッドは中央に貼り付き、画面が動く
 *  - 最初から中央より右にいた場合は、初回フレームで中央へ飛んでから追従する
 *
 * 再描画を挟まないよう、ストアの購読で直接 scrollLeft を書き換える。
 */
export function usePlayheadFollow(
  scrollRef: RefObject<HTMLElement | null>,
  stepW: number,
  gutterWidth: number,
  /** 先頭に確保している余白ぶん、実際の描画位置は step * stepW より右にずれている */
  marginPx = 0,
) {
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const follow = useProjectStore((s) => s.followPlayhead);

  const apply = useCallback(
    (step: number) => {
      const el = scrollRef.current;
      if (!el) return;
      // 左ガターは sticky で常に見えているので、その分を差し引いた幅が実際のレーン表示幅
      const laneViewport = el.clientWidth - gutterWidth;
      if (laneViewport <= 0) return;

      const maxScroll = el.scrollWidth - el.clientWidth;
      const desired = followScrollLeft(step * stepW + marginPx, laneViewport, maxScroll);
      if (Math.abs(el.scrollLeft - desired) >= 1) el.scrollLeft = desired;
    },
    [gutterWidth, marginPx, scrollRef, stepW],
  );

  useEffect(() => {
    if (!follow) return;

    // 停止・一時停止の直後も、いまの再生位置が見える位置へ一度寄せる
    apply(usePlayheadStore.getState().step);
    if (!isPlaying) return;

    return usePlayheadStore.subscribe((s) => apply(s.step));
  }, [apply, follow, isPlaying]);
}
