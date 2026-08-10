import { useCallback, useEffect, useRef } from 'react';

/**
 * コードタイムラインとピアノロールの横スクロールを同期させる。
 * React の state を介さず DOM を直接書き換えることで、
 * スクロール中の再レンダリングを避ける。
 */
const registry = new Set<HTMLElement>();

export function useSyncedScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registry.add(el);
    // 後から現れたパネル（ピアノロール展開時など）を既存位置に合わせる
    const other = [...registry].find((o) => o !== el);
    if (other) el.scrollLeft = other.scrollLeft;
    return () => {
      registry.delete(el);
    };
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    for (const other of registry) {
      if (other !== el && other.scrollLeft !== el.scrollLeft) {
        other.scrollLeft = el.scrollLeft;
      }
    }
  }, []);

  return { ref, onScroll };
}
