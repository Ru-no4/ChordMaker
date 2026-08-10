/**
 * スクロール量の計算。
 *  - ドラッグ中に端へ寄ったときの自動スクロール速度
 *  - 再生ヘッドを中央に保つためのスクロール位置
 *
 * 副作用を持たない純粋関数にしてあるのは、
 * requestAnimationFrame が動かない環境でも挙動を検証できるようにするため。
 */

/** この距離(px)まで端に近づいたらスクロールを始める */
export const EDGE_ZONE = 44;
/** 1フレームあたりの最大スクロール量(px) */
export const MAX_SPEED = 22;

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 端からの距離に応じた速度。
 * 端を越えて外側にいる場合（距離が負）は最大速度で送り続ける。
 */
const speedFor = (distance: number): number =>
  distance >= EDGE_ZONE ? 0 : MAX_SPEED * (1 - Math.max(0, distance) / EDGE_ZONE);

/** 1フレーム分のスクロール量。ゾーン外なら 0。 */
export function edgeScrollDelta(
  bounds: Bounds,
  point: Point,
  vertical: boolean,
): { dx: number; dy: number } {
  const dx = speedFor(bounds.right - point.x) - speedFor(point.x - bounds.left);
  const dy = vertical
    ? speedFor(bounds.bottom - point.y) - speedFor(point.y - bounds.top)
    : 0;
  return { dx, dy };
}

/**
 * 再生ヘッドを表示領域の中央に置くための scrollLeft。
 *
 * 「中央に来る値」を 0 でクランプするだけで、要求される3つの挙動が出る:
 *  - 中央より左にいる間は負になるので 0 のまま＝スクロールせずヘッドが中央へ向かう
 *  - 中央に達したらヘッドが中央に貼り付き、画面のほうが動く
 *  - 最初から中央より右なら、いきなり中央へ寄る
 *
 * @param playheadX  レーン座標での再生ヘッド位置(px)
 * @param laneViewport  左ガターを除いた表示幅(px)
 */
export function followScrollLeft(
  playheadX: number,
  laneViewport: number,
  maxScroll: number,
): number {
  const centered = playheadX - laneViewport / 2;
  return Math.min(Math.max(centered, 0), Math.max(0, maxScroll));
}
