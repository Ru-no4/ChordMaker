/**
 * プロジェクトの保存 / 読み込み。
 *
 * サーバーや DB は使わず、内容を JSON にしてブラウザのダウンロードとして書き出し、
 * 読み込みは `<input type="file">` でユーザーが選んだファイルを読むだけ。
 * データは常にローカルで完結し、外部へは一切送信しない。
 */
import type { ChordBlockItem } from '../store/useProjectStore';
import { DEFAULT_CHORD_TRACK_HEIGHT, type ChordResolution, type QuantizeValue, type TimeSignature } from './grid';

/** ファイルの拡張子（中身は JSON） */
export const PROJECT_FILE_EXTENSION = '.chrd';
const CURRENT_VERSION = 2;

/**
 * ファイル上のトラック表現。ランタイム（Track/TrackSettings）とは異なり、
 * 「中身」と「設定」を分けずに1つにまとめて保存する（保存形式まで分ける必要は無い）。
 */
export interface SerializedTrack {
  id: string;
  name: string;
  color: string;
  instrumentId: string;
  volumeDb: number;
  muted: boolean;
  solo: boolean;
  height: number;
  blocks: ChordBlockItem[];
}

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
  tracks: SerializedTrack[];
}

export interface ProjectFileSource {
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  rangeStart: number;
  chordResolution: ChordResolution;
  quantize: QuantizeValue;
  snap: boolean;
  tracks: SerializedTrack[];
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
    tracks: state.tracks,
  };
}

export type ProjectFileErrorCode =
  | 'invalid-json'
  | 'invalid-format'
  | 'wrong-app'
  | 'unsupported-version'
  | 'corrupt-blocks'
  | 'corrupt-time-signature'
  | 'corrupt-settings';

/**
 * 読み込み時の最低限の形チェック。壊れたファイルでアプリごと落ちないようにする。
 * メッセージは持たず code だけを持つ（表示側で locale に応じたメッセージへ変換する）。
 */
export class ProjectFileError extends Error {
  code: ProjectFileErrorCode;
  constructor(code: ProjectFileErrorCode) {
    super(code);
    this.code = code;
  }
}

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

function isSerializedTrack(v: unknown): v is SerializedTrack {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.color === 'string' &&
    typeof t.instrumentId === 'string' &&
    typeof t.volumeDb === 'number' &&
    typeof t.muted === 'boolean' &&
    typeof t.solo === 'boolean' &&
    typeof t.height === 'number' &&
    Array.isArray(t.blocks) &&
    t.blocks.every(isBlock)
  );
}

export function parseProjectFile(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('invalid-json');
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProjectFileError('invalid-format');
  }
  const f = raw as Record<string, unknown>;
  if (f.app !== 'ChrodMaker') {
    throw new ProjectFileError('wrong-app');
  }
  if (typeof f.formatVersion !== 'number' || f.formatVersion > CURRENT_VERSION) {
    throw new ProjectFileError('unsupported-version');
  }
  const sig = f.timeSignature as Partial<TimeSignature> | undefined;
  if (!sig || typeof sig.numerator !== 'number' || typeof sig.denominator !== 'number') {
    throw new ProjectFileError('corrupt-time-signature');
  }
  if (
    typeof f.bpm !== 'number' ||
    typeof f.bars !== 'number' ||
    typeof f.chordResolution !== 'number' ||
    typeof f.quantize !== 'number' ||
    typeof f.snap !== 'boolean'
  ) {
    throw new ProjectFileError('corrupt-settings');
  }

  // v1（formatVersion: 1）はトラックという概念が無く、blocks/instrumentId/volumeDb が
  // 直下に置かれていた。読めたら単一トラックへ包んで新形式へ移行する。
  let tracks: SerializedTrack[];
  if (Array.isArray(f.tracks)) {
    if (!f.tracks.every(isSerializedTrack)) {
      throw new ProjectFileError('corrupt-blocks');
    }
    tracks = f.tracks as SerializedTrack[];
  } else {
    if (!Array.isArray(f.blocks) || !f.blocks.every(isBlock)) {
      throw new ProjectFileError('corrupt-blocks');
    }
    if (typeof f.instrumentId !== 'string' || typeof f.volumeDb !== 'number') {
      throw new ProjectFileError('corrupt-settings');
    }
    tracks = [
      {
        id: `trk-migrated-${Date.now().toString(36)}`,
        name: 'CHORD TRACK',
        color: '#4f8cff',
        instrumentId: f.instrumentId,
        volumeDb: f.volumeDb,
        muted: false,
        solo: false,
        height: DEFAULT_CHORD_TRACK_HEIGHT,
        blocks: f.blocks as ChordBlockItem[],
      },
    ];
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
    tracks,
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
