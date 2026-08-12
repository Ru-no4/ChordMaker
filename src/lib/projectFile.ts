/**
 * プロジェクトの保存 / 読み込み。
 *
 * サーバーや DB は使わず、内容を JSON にしてブラウザのダウンロードとして書き出し、
 * 読み込みは `<input type="file">` でユーザーが選んだファイルを読むだけ。
 * データは常にローカルで完結し、外部へは一切送信しない。
 */
import type { ChordBlockItem } from '../store/useProjectStore';
import type { ChordResolution, QuantizeValue, TimeSignature } from './grid';

/** ファイルの拡張子（中身は JSON） */
export const PROJECT_FILE_EXTENSION = '.chrd';
const CURRENT_VERSION = 1;

export interface ProjectFile {
  app: 'ChrodMaker';
  formatVersion: number;
  savedAt: string;
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  /** 再生・ループ範囲の開始位置（小節単位）。旧ファイルには存在しないので読み込み時は 0 扱い。 */
  rangeStart: number;
  chordResolution: ChordResolution;
  quantize: QuantizeValue;
  snap: boolean;
  instrumentId: string;
  volumeDb: number;
  blocks: ChordBlockItem[];
}

export interface ProjectFileSource {
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  rangeStart: number;
  chordResolution: ChordResolution;
  quantize: QuantizeValue;
  snap: boolean;
  instrumentId: string;
  volumeDb: number;
  blocks: ChordBlockItem[];
}

export function serializeProject(state: ProjectFileSource): ProjectFile {
  return {
    app: 'ChrodMaker',
    formatVersion: CURRENT_VERSION,
    savedAt: new Date().toISOString(),
    bpm: state.bpm,
    timeSignature: state.timeSignature,
    bars: state.bars,
    rangeStart: state.rangeStart,
    chordResolution: state.chordResolution,
    quantize: state.quantize,
    snap: state.snap,
    instrumentId: state.instrumentId,
    volumeDb: state.volumeDb,
    blocks: state.blocks,
  };
}

/** 読み込み時の最低限の形チェック。壊れたファイルでアプリごと落ちないようにする。 */
export class ProjectFileError extends Error {}

function isNoteItem(v: unknown): v is ChordBlockItem['notes'][number] {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.midi === 'number' &&
    typeof n.start === 'number' &&
    typeof n.length === 'number' &&
    typeof n.velocity === 'number'
  );
}

function isBlock(v: unknown): v is ChordBlockItem {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.start === 'number' &&
    typeof b.length === 'number' &&
    Array.isArray(b.notes) &&
    b.notes.every(isNoteItem)
  );
}

export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('JSON として読み込めませんでした');
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProjectFileError('ファイルの形式が不正です');
  }
  const f = raw as Record<string, unknown>;
  if (f.app !== 'ChrodMaker') {
    throw new ProjectFileError('ChrodMaker のプロジェクトファイルではありません');
  }
  if (typeof f.formatVersion !== 'number' || f.formatVersion > CURRENT_VERSION) {
    throw new ProjectFileError('対応していないバージョンのファイルです');
  }
  if (!Array.isArray(f.blocks) || !f.blocks.every(isBlock)) {
    throw new ProjectFileError('コードトラックのデータが壊れています');
  }
  const sig = f.timeSignature as Partial<TimeSignature> | undefined;
  if (!sig || typeof sig.numerator !== 'number' || typeof sig.denominator !== 'number') {
    throw new ProjectFileError('拍子のデータが壊れています');
  }
  if (
    typeof f.bpm !== 'number' ||
    typeof f.bars !== 'number' ||
    typeof f.chordResolution !== 'number' ||
    typeof f.quantize !== 'number' ||
    typeof f.snap !== 'boolean' ||
    typeof f.instrumentId !== 'string' ||
    typeof f.volumeDb !== 'number'
  ) {
    throw new ProjectFileError('設定のデータが壊れています');
  }

  return {
    app: 'ChrodMaker',
    formatVersion: f.formatVersion,
    savedAt: typeof f.savedAt === 'string' ? f.savedAt : new Date().toISOString(),
    bpm: f.bpm,
    timeSignature: { numerator: sig.numerator, denominator: sig.denominator },
    bars: f.bars,
    rangeStart: typeof f.rangeStart === 'number' ? f.rangeStart : 0,
    chordResolution: f.chordResolution as ChordResolution,
    quantize: f.quantize as QuantizeValue,
    snap: f.snap,
    instrumentId: f.instrumentId,
    volumeDb: f.volumeDb,
    blocks: f.blocks as ChordBlockItem[],
  };
}

/** JSON を .chrd としてブラウザのダウンロードに流す */
export function downloadProjectFile(file: ProjectFile, filename: string): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith(PROJECT_FILE_EXTENSION)
    ? filename
    : `${filename}${PROJECT_FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
