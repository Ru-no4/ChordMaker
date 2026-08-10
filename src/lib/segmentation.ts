/**
 * コードブロック内の「セグメント」検出。
 *
 * 1つのブロックに複数のコードを弾き分けても、全ノートを混ぜて判定すると
 * 意味のない和音名（Am7 + A → A7(#9)）になってしまう。
 * そこで拍グリッドの窓ごとに判定し、同じコードが続く窓を結合することで
 * 小節内の複数コードを取り出す。
 *
 * ノートデータには一切手を入れない（非破壊）。ノートを動かせば区切りも動く。
 */
import { detectChord, type DetectionResult } from './theory';
import type { ChordBlockItem, NoteItem } from '../store/useProjectStore';

export interface ChordSegment {
  /** ブロック先頭からの相対位置（32分音符単位） */
  start: number;
  length: number;
  detection: DetectionResult;
  /** 判定に使ったノートの MIDI（試聴・候補確定に使う） */
  midis: number[];
}

/**
 * 窓長のこの割合以上鳴っているノートを「主要な構成音」とみなす。
 * 伸ばした和音の上を走る経過音を判定から外すための閾値。
 */
const STRONG_RATIO = 0.5;

/** 主要な構成音だけで判定するのに必要な最低数（三和音） */
const MIN_STRONG_NOTES = 3;

interface Window {
  start: number;
  end: number;
  midis: number[];
  detection: DetectionResult;
}

const noteEnd = (n: NoteItem): number => n.start + n.length;

/** 小数の窓長を扱うので、境界比較には許容誤差を持たせる */
const EPS = 1e-6;

/**
 * 窓の境界をプロジェクト絶対位置のグリッドに揃える。
 * ブロックが小節の途中から始まっていても、区切りが musical な位置に来る。
 *
 * 窓長は「小節 ÷ 分割数」なので 1/3・1/6 では小数になる
 * （4/4 の 1/3 は 32/3 step）。丸めると誤差が累積するため、
 * 加算ではなく `index * res` で毎回求め直す。
 */
function windowBounds(
  blockStart: number,
  blockLength: number,
  resolutionSteps: number,
): Array<[number, number]> {
  const res = resolutionSteps > EPS ? resolutionSteps : 1;
  const absStart = blockStart;
  const absEnd = blockStart + blockLength;

  const bounds: Array<[number, number]> = [];
  let index = Math.floor(absStart / res + EPS);
  while (index * res < absEnd - EPS) {
    const s = Math.max(absStart, index * res);
    const e = Math.min(absEnd, (index + 1) * res);
    // 相対位置へ戻す
    if (e - s > EPS) bounds.push([s - absStart, e - absStart]);
    index++;
  }
  return bounds;
}

/** 窓に鳴っているノートから、判定に使う音を選ぶ */
function poolForWindow(notes: NoteItem[], start: number, end: number): NoteItem[] {
  const span = end - start;
  const sounding = notes.filter((n) => n.start < end && noteEnd(n) > start);
  if (sounding.length === 0) return [];

  const strong = sounding.filter((n) => {
    const overlap = Math.min(end, noteEnd(n)) - Math.max(start, n.start);
    return overlap >= span * STRONG_RATIO;
  });

  // 長く鳴っている音だけで和音が成立するなら、短い音は経過音とみなして捨てる
  return strong.length >= MIN_STRONG_NOTES ? strong : sounding;
}

const isConfident = (d: DetectionResult): boolean => d.kind === 'chord';
const symbolOf = (d: DetectionResult): string => d.chord?.symbol ?? '';

/**
 * ブロックを解析し、コードが変わる位置で区切ったセグメント列を返す。
 * 返り値は必ずブロック全体を隙間なく覆う。
 */
export function segmentBlock(
  block: Pick<ChordBlockItem, 'start' | 'length' | 'notes'>,
  resolutionSteps: number,
): ChordSegment[] {
  const whole = (midis: number[]): ChordSegment[] => [
    { start: 0, length: block.length, detection: detectChord(midis), midis },
  ];

  if (block.notes.length === 0) return whole([]);

  /* --- 窓ごとに判定 --------------------------------------------------- */
  const windows: Window[] = windowBounds(block.start, block.length, resolutionSteps).map(
    ([start, end]) => {
      const midis = poolForWindow(block.notes, start, end).map((n) => n.midi);
      return { start, end, midis, detection: detectChord(midis) };
    },
  );

  if (windows.length <= 1) return whole(block.notes.map((n) => n.midi));

  /* --- 結合 ----------------------------------------------------------- */
  const segments: ChordSegment[] = [];
  // 確信の持てない窓は、確定コードが現れるまで溜めておく
  let pending: { start: number; end: number; midis: number[] } | null = null;

  const flushPending = () => {
    if (!pending) return;
    // 溜めた窓をまとめて判定し直す。疎に置いた C→E→G が1つの C として拾える。
    const midis = [...new Set(pending.midis)];
    segments.push({
      start: pending.start,
      length: pending.end - pending.start,
      detection: detectChord(midis),
      midis,
    });
    pending = null;
  };

  const extendLast = (end: number, midis: number[]) => {
    const last = segments[segments.length - 1];
    last.length = end - last.start;
    last.midis = [...new Set([...last.midis, ...midis])];
  };

  for (const w of windows) {
    // 1) 音が無い窓は直前を伸ばすだけ
    if (w.midis.length === 0) {
      if (pending) pending.end = w.end;
      else if (segments.length > 0) extendLast(w.end, []);
      else pending = { start: w.start, end: w.end, midis: [] };
      continue;
    }

    // 2) コードとして確定しない窓
    if (!isConfident(w.detection)) {
      if (segments.length > 0 && !pending) {
        // 直前の確定コードの余韻・装飾とみなして吸収する
        extendLast(w.end, w.midis);
      } else if (pending) {
        pending.end = w.end;
        pending.midis.push(...w.midis);
      } else {
        pending = { start: w.start, end: w.end, midis: [...w.midis] };
      }
      continue;
    }

    // 3) 確定した窓
    flushPending();
    const last = segments[segments.length - 1];
    if (last && isConfident(last.detection) && symbolOf(last.detection) === symbolOf(w.detection)) {
      // 同じコードが続いている。再判定はせずラベルを保ったまま伸ばす。
      extendLast(w.end, w.midis);
    } else {
      segments.push({
        start: w.start,
        length: w.end - w.start,
        detection: w.detection,
        midis: [...w.midis],
      });
    }
  }
  flushPending();

  if (segments.length === 0) return whole(block.notes.map((n) => n.midi));

  // ブロック全体を隙間なく覆う
  segments[0].length += segments[0].start;
  segments[0].start = 0;
  const last = segments[segments.length - 1];
  last.length = block.length - last.start;

  return segments;
}

/* ------------------------------------------------------------------ */
/* メモ化                                                              */
/* ------------------------------------------------------------------ */

/**
 * ブロックは immutable に差し替えられるので、WeakMap のキーにすれば
 * 内容が変わった時点で自動的にキャッシュが外れる。
 */
const cache = new WeakMap<object, Map<number, ChordSegment[]>>();

/** ChordBlock / PianoRoll / ChordInspector から同じ結果を共有するための入口 */
export function segmentsFor(
  block: ChordBlockItem,
  resolutionSteps: number,
): ChordSegment[] {
  let byResolution = cache.get(block);
  if (!byResolution) {
    byResolution = new Map();
    cache.set(block, byResolution);
  }
  let segments = byResolution.get(resolutionSteps);
  if (!segments) {
    segments = segmentBlock(block, resolutionSteps);
    byResolution.set(resolutionSteps, segments);
  }
  return segments;
}

/** step（ブロック相対）を含むセグメントを返す */
export function segmentAt(segments: ChordSegment[], step: number): ChordSegment | null {
  return (
    segments.find((s) => step >= s.start && step < s.start + s.length) ??
    segments[segments.length - 1] ??
    null
  );
}

/**
 * 表示中のセグメントを決める。
 * ユーザーが選んだもの → 再生ヘッド位置 → 先頭 の順。
 */
export function resolveActiveSegment(
  segments: ChordSegment[],
  selectedStart: number | null,
  playheadRelStep: number | null,
): ChordSegment | null {
  if (segments.length === 0) return null;
  if (selectedStart !== null) return segmentAt(segments, selectedStart);
  if (playheadRelStep !== null && playheadRelStep >= 0) {
    return segmentAt(segments, playheadRelStep);
  }
  return segments[0];
}
