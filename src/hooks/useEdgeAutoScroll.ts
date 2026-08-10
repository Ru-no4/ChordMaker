import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { edgeScrollDelta } from '../lib/edgeScroll';

/**
 * ドラッグ中にポインタが表示端へ寄ったら、スクロールコンテナを自動で送る。
 *
 * 端に着くたびに指を離してスクロールし直す、という往復を無くすためのもの。
 * 速度計算は lib/edgeScroll.ts の純粋関数に切り出してある。
 */

interface Options {
  /** 縦方向もスクロールするか（ルーラーのスクラブでは横だけ） */
  vertical?: boolean;
  /** スクロールが起きたフレームごとに呼ばれる。ドラッグ計算をやり直すのに使う。 */
  onScrolled?: () => void;
}

export function useEdgeAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
  { vertical = false, onScrolled }: Options = {},
) {
  const rafRef = useRef<number | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const scrolledRef = useRef(onScrolled);
  scrolledRef.current = onScrolled;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pointRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const tick = useCallback(() => {
    rafRef.current = null;
    const el = scrollRef.current;
    const point = pointRef.current;
    if (!el || !point) return;

    const { dx, dy } = edgeScrollDelta(el.getBoundingClientRect(), point, vertical);
    if (dx !== 0) el.scrollLeft += dx;
    if (dy !== 0) el.scrollTop += dy;
    if (dx !== 0 || dy !== 0) scrolledRef.current?.();

    // ドラッグが続く限りループを回し続ける（端から離れれば速度0で空回り）
    rafRef.current = requestAnimationFrame(tick);
  }, [scrollRef, vertical]);

  /** pointermove のたびに現在位置を渡す */
  const update = useCallback(
    (clientX: number, clientY: number) => {
      pointRef.current = { x: clientX, y: clientY };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  return { update, stop };
}
