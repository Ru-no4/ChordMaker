/**
 * コードの構成音を、既存のピッチクラス判定結果から並べ直す「ボイシング」機能。
 *
 * ノートの発音タイミングには触れず、MIDI 番号（オクターブ位置）だけを組み替える。
 * 呼び出し側（ChordInspector）が `setSegmentNotes` でセグメントの音を丸ごと
 * 差し替える前提の、純粋な計算関数。
 */
import { PITCH_MAX, PITCH_MIN } from '../store/useProjectStore';
import { pitchClass } from './theory';

export type VoicingPreset = 'root-low' | 'close' | 'open' | 'drop2' | 'drop3';

export const VOICING_PRESETS: Array<{ id: VoicingPreset; label: string; title: string }> = [
  {
    id: 'root-low',
    label: 'ルート低め',
    title: 'ルート音を低いオクターブに残し、残りの構成音を1オクターブ上げる（既定のコード進行と同じパターン）',
  },
  { id: 'close', label: 'Close', title: '構成音を1オクターブ以内に密集させる' },
  { id: 'open', label: 'Open', title: '1音おきに1オクターブ上げて間隔を広げる' },
  { id: 'drop2', label: 'Drop2', title: '上から2番目の音を1オクターブ下げる' },
  { id: 'drop3', label: 'Drop3', title: '上から3番目の音を1オクターブ下げる' },
];

/** 現在の最低音の近くに、指定ピッチクラスの音を1つ選ぶ（その音以下で最も近い位置） */
function anchorNear(pc: number, referenceMidi: number): number {
  const rounded = Math.round(referenceMidi);
  return rounded - ((pitchClass(rounded) - pc + 12) % 12);
}

/** 音域からはみ出す場合、形を保ったまま丸ごとオクターブ移動して収める */
function fitRange(midis: number[]): number[] {
  let out = [...midis];
  while (out.length > 0 && Math.max(...out) > PITCH_MAX && Math.min(...out) - 12 >= PITCH_MIN) {
    out = out.map((m) => m - 12);
  }
  while (out.length > 0 && Math.min(...out) < PITCH_MIN && Math.max(...out) + 12 <= PITCH_MAX) {
    out = out.map((m) => m + 12);
  }
  // それでも収まらない極端なケースは、音を保つため個別にクランプする
  return out.map((m) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, m)));
}

function closeVoicing(rootPc: number, intervals: number[], referenceMidi: number): number[] {
  const rootMidi = anchorNear(rootPc, referenceMidi);
  return intervals.map((iv) => rootMidi + iv).sort((a, b) => a - b);
}

/** 1音おき（下から数えて奇数番目）を1オクターブ上げて間隔を広げる */
function openVoicing(close: number[]): number[] {
  return close.map((m, i) => (i % 2 === 1 ? m + 12 : m)).sort((a, b) => a - b);
}

/** 上から fromTop 番目の声部を1オクターブ下げる */
function dropVoice(close: number[], fromTop: number): number[] {
  const idx = close.length - fromTop;
  if (idx < 0 || idx >= close.length) return close;
  const out = [...close];
  out[idx] -= 12;
  return out.sort((a, b) => a - b);
}

/** ルート音（close position の最低音）はそのまま、残りの構成音だけ1オクターブ上げる */
function rootLowVoicing(close: number[]): number[] {
  if (close.length === 0) return close;
  const [root, ...rest] = close;
  return [root, ...rest.map((m) => m + 12)].sort((a, b) => a - b);
}

/**
 * コードのルートとピッチクラス集合から、指定プリセットのボイシングを組み立てる。
 * ルートは現在の最低音の近くに置くので、極端なオクターブジャンプは起きない。
 */
export function buildVoicing(
  rootPc: number,
  pcs: number[],
  referenceMidi: number,
  preset: VoicingPreset,
): number[] {
  const intervals = [...new Set(pcs.map((pc) => (pc - rootPc + 12) % 12))].sort((a, b) => a - b);
  const close = closeVoicing(rootPc, intervals, referenceMidi);
  const shaped =
    preset === 'root-low'
      ? rootLowVoicing(close)
      : preset === 'open'
        ? openVoicing(close)
        : preset === 'drop2'
          ? dropVoice(close, 2)
          : preset === 'drop3'
            ? dropVoice(close, 3)
            : close;
  return fitRange(shaped);
}

/**
 * 直前のコードの実音に対し、各ピッチクラスを最も近いオクターブへ配置する簡易ボイスリーディング。
 * 厳密な声部ごとの最小移動割当までは行わず、直前和音の重心に近い候補オクターブを選ぶ。
 */
export function voiceLeadMidis(pcs: number[], prevMidis: number[]): number[] {
  if (prevMidis.length === 0) return [];
  const center = prevMidis.reduce((a, b) => a + b, 0) / prevMidis.length;

  const placed = [...new Set(pcs)].map((pc) => {
    const rounded = Math.round(center);
    const below = rounded - ((pitchClass(rounded) - pc + 12) % 12);
    return Math.abs(center - below) <= Math.abs(center - (below + 12)) ? below : below + 12;
  });

  return fitRange(placed.sort((a, b) => a - b));
}
