/**
 * ピアノロールの縦方向ジオメトリ。
 * 鍵盤・ノート・ジェスチャ処理で共有する。
 */
import { PITCH_MAX, PITCH_MIN } from '../store/useProjectStore';

/** 倍率100%のときの1行（1半音）の高さ */
export const BASE_ROW_HEIGHT = 14;

/** 高い音が上。C1〜C6 の 61 鍵 */
export const PITCHES: number[] = Array.from(
  { length: PITCH_MAX - PITCH_MIN + 1 },
  (_, i) => PITCH_MAX - i,
);

export const rowHeight = (zoomY: number): number => BASE_ROW_HEIGHT * zoomY;

export const gridHeight = (zoomY: number): number => PITCHES.length * rowHeight(zoomY);

export const rowTop = (midi: number, zoomY: number): number =>
  (PITCH_MAX - midi) * rowHeight(zoomY);

export const midiFromY = (y: number, zoomY: number): number =>
  PITCH_MAX - Math.floor(y / rowHeight(zoomY));
