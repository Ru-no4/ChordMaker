/**
 * ポインタ操作の共通判定。
 *
 * マウスと指では要求される許容量が違う。指はタップしただけでも数 px 動くので、
 * マウスと同じ閾値で「ドラッグ」と判定するとタップが成立しなくなる。
 */

/** マウス / ペンでの「動いた」とみなす移動量(px) */
export const TAP_SLOP_MOUSE = 4;
/** 指での「動いた」とみなす移動量(px) */
export const TAP_SLOP_TOUCH = 10;

export const tapSlop = (pointerType: string): number =>
  pointerType === 'touch' ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;

/** 移動量が閾値以下ならタップ（＝ドラッグではない） */
export const isTap = (pointerType: string, dx: number, dy: number): boolean =>
  Math.abs(dx) <= tapSlop(pointerType) && Math.abs(dy) <= tapSlop(pointerType);

/** ホバーが使えない環境（タッチ主体）かどうか */
export const isTouchPrimary = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

/**
 * ポインタキャプチャの取得／解放。
 *
 * 環境によっては pointerup が届かないことがあり、掴んだままになると
 * 以降のタップが全部その要素へ吸い込まれて操作不能になる。
 * 例外を握り潰し、lostpointercapture でも後始末できるようにしておく。
 */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* まだ有効でないポインタ。キャプチャ無しでも処理は続行できる */
  }
}

export function releasePointer(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    /* 既に解放済み */
  }
}
