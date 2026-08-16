/**
 * OS/ブラウザのネイティブスクロールバーの太さ(px)を実測する。
 *
 * 決め打ちの定数だと環境（OS・ブラウザ・DPI・オーバーレイスクロールバーの
 * 有無等）によってズレる（Windows の classic スクロールバーだけでも
 * 実機で 11〜17px 程度の幅があり、macOS/モバイルの既定であるオーバーレイ
 * スクロールバーは 0px）。決め打ちを重ねるより、実測して使い回す方が確実。
 *
 * 一度計算したら使い回す（DOM 操作を毎回走らせない）。document が無い
 * 環境（vitest の node 環境等）では 0 を返す。
 */
let cached: number | null = null;

export function nativeScrollbarThickness(): number {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') return 0;

  const outer = document.createElement('div');
  outer.style.position = 'absolute';
  outer.style.top = '-9999px';
  outer.style.left = '-9999px';
  outer.style.width = '100px';
  outer.style.height = '100px';
  outer.style.overflow = 'scroll';
  document.body.appendChild(outer);

  const inner = document.createElement('div');
  inner.style.width = '100%';
  inner.style.height = '100%';
  outer.appendChild(inner);

  cached = Math.max(0, outer.offsetWidth - inner.clientWidth);
  outer.remove();
  return cached;
}
