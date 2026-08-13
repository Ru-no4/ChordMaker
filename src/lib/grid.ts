/**
 * タイムライン / ピアノロールの時間軸と表示ジオメトリ。
 *
 * 内部の最小単位（step）は 32分音符。
 * 拍子の分母が拍の単位を決めるため、1拍あたりの step 数は
 *   32分音符 = 全音符 / 32  →  1拍 = 32 / denominator step
 * となる（4/4 なら 8 step、6/8 なら 4 step）。
 */

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** 全音符 = 32 step（= 32分音符が最小単位） */
export const STEPS_PER_WHOLE = 32;

/** 1拍（拍子の分母単位）あたりの step 数 */
export const stepsPerBeat = (sig: TimeSignature): number =>
  STEPS_PER_WHOLE / sig.denominator;

/** 1小節あたりの step 数 */
export const stepsPerBar = (sig: TimeSignature): number =>
  sig.numerator * stepsPerBeat(sig);

/* ------------------------------------------------------------------ */
/* 表示倍率                                                            */
/* ------------------------------------------------------------------ */

/**
 * 倍率100%のときの1拍の幅(px)。
 * 従来値(96px)は狭いというフィードバックを受け、それが新しい基準で
 * 70%表示に相当するよう引き上げた（96 / 0.7 ≈ 137px）。
 */
export const BASE_BEAT_WIDTH = 96 / 0.7;
/** 倍率100%のときのコードブロックの高さ(px) */
export const BASE_BLOCK_HEIGHT = 60;
/** 倍率100%のときのコードレーンの高さ(px) */
export const BASE_LANE_HEIGHT = 78;

export const ZOOM_X_MIN = 0.25;
export const ZOOM_X_MAX = 4;
export const ZOOM_Y_MIN = 0.6;
export const ZOOM_Y_MAX = 2.5;
/** ボタン1回あたりの倍率 */
export const ZOOM_FACTOR = 1.25;

export const beatWidth = (zoomX: number): number => BASE_BEAT_WIDTH * zoomX;

/** 1 step の表示幅(px) */
export const stepWidth = (sig: TimeSignature, zoomX: number): number =>
  beatWidth(zoomX) / stepsPerBeat(sig);

export const blockHeight = (zoomY: number): number => BASE_BLOCK_HEIGHT * zoomY;
export const laneHeight = (zoomY: number): number => BASE_LANE_HEIGHT * zoomY;

/** プロジェクト全体の step 数（＝再生・ループの基準となる範囲） */
export const totalSteps = (sig: TimeSignature, bars: number): number =>
  stepsPerBar(sig) * bars;

/** 配置されているブロックが実際に占めている末尾の step（無ければ 0） */
export function contentExtentSteps(blocks: Array<{ start: number; length: number }>): number {
  return blocks.reduce((max, b) => Math.max(max, b.start + b.length), 0);
}

/**
 * タイムラインの表示に使う小節数（＝ルーラー・レーンに描く小節セルの数）。
 * bars（再生範囲の終了位置）を基準にしつつ、それを超えて置かれた内容があれば
 * 収まるところまで表示幅を伸ばす。DAW の「プロジェクト終端マーカーの
 * 後ろにも中身を置ける」挙動と同じで、再生範囲そのものは bars のまま変わらない。
 *
 * bars 自体は四分音符単位の小数を取りうるが、セルの数は常に整数
 * （端数の小節も1セル分の幅で描き、その中を実座標でハンドル等が指す）。
 */
export function displayBars(
  sig: TimeSignature,
  bars: number,
  blocks: Array<{ start: number; length: number }>,
): number {
  const perBar = stepsPerBar(sig);
  const content = contentExtentSteps(blocks);
  return Math.max(1, Math.ceil(Math.max(bars, content / perBar)));
}

/* ------------------------------------------------------------------ */
/* クオンタイズ                                                        */
/* ------------------------------------------------------------------ */

/** 選択可能なクオンタイズ値（音価の分母） */
export const QUANTIZE_OPTIONS = [4, 8, 16, 32] as const;
export type QuantizeValue = (typeof QUANTIZE_OPTIONS)[number];

/** クオンタイズ値 → step 数（1/4→8, 1/8→4, 1/16→2, 1/32→1） */
export const quantizeSteps = (q: QuantizeValue): number => STEPS_PER_WHOLE / q;

/* ------------------------------------------------------------------ */
/* コード判定の窓                                                      */
/* ------------------------------------------------------------------ */

/**
 * コード判定の窓は「小節を何分割するか」で表す。
 *
 * 全音符基準にすると 6/8 のような複合拍子で小節と噛み合わない
 * （6/8 の1小節は 24 step なので、全音符の 1/2 = 16 step では割り切れない）。
 * 小節基準なら 6/8 の 1/2 がちょうど付点4分＝3/8 になり、
 * 3分割・6分割で三連系や複合拍子も扱える。
 */
export const CHORD_DIVISIONS = [1, 2, 3, 4, 6, 8] as const;
export type ChordResolution = (typeof CHORD_DIVISIONS)[number];

export const CHORD_RESOLUTION_LABELS: Record<number, { ja: string; en: string }> = {
  1: { ja: '小節', en: 'Bar' },
  2: { ja: '1/2', en: '1/2' },
  3: { ja: '1/3', en: '1/3' },
  4: { ja: '1/4', en: '1/4' },
  6: { ja: '1/6', en: '1/6' },
  8: { ja: '1/8', en: '1/8' },
};

/** コード解像度 → 窓の長さ(step)。割り切れない場合は小数のまま扱う。 */
export const chordResolutionSteps = (
  sig: TimeSignature,
  divisions: ChordResolution,
): number => stepsPerBar(sig) / divisions;

/* ------------------------------------------------------------------ */
/* スナップ                                                            */
/* ------------------------------------------------------------------ */

/** snap が有効なときだけグリッドに吸着させる */
export function snapStep(
  step: number,
  quantize: QuantizeValue,
  snapEnabled: boolean,
): number {
  if (!snapEnabled) return Math.round(step);
  const grid = quantizeSteps(quantize);
  return Math.round(step / grid) * grid;
}

/** 長さは 0 にならないよう最低 1 グリッド（snap off でも 32分音符 1つ）を確保 */
export function snapLength(
  length: number,
  quantize: QuantizeValue,
  snapEnabled: boolean,
): number {
  const grid = snapEnabled ? quantizeSteps(quantize) : 1;
  return Math.max(grid, Math.round(length / grid) * grid);
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** step 位置を「小節.拍.step」形式に整形（表示用） */
export function formatPosition(step: number, sig: TimeSignature): string {
  const perBar = stepsPerBar(sig);
  const perBeat = stepsPerBeat(sig);
  const bar = Math.floor(step / perBar);
  const within = step - bar * perBar;
  const beat = Math.floor(within / perBeat);
  const tick = Math.round(within - beat * perBeat);
  return `${bar + 1}.${beat + 1}.${tick + 1}`;
}
