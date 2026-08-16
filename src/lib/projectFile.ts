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
const CURRENT_VERSION = 2;

/**
 * ファイル上のトラック表現。ランタイム（Track/TrackSettings）とは異なり、
 * 「中身」と「設定」を分けずに1つにまとめて保存する（保存形式まで分ける必要は無い）。
 */
export interface SerializedTrack {
  id: string;
  name: string;
  color: string;
  /** 'chord'|'notes' 導入前のファイルには存在しない。読み込み時に 'chord' で補う。 */
  kind: 'chord' | 'notes';
  instrumentId: string;
  volumeDb: number;
  muted: boolean;
  solo: boolean;
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

function isSerializedTrack(
  v: unknown,
): v is Omit<SerializedTrack, 'kind'> & { kind?: unknown } {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.color === 'string' &&
    // kind は 'chord'|'notes' 導入前のファイルに存在しないため必須にしない
    // （必須にすると旧ファイルが軒並み読み込みエラーになる）。無い/不正な値は
    // parseProjectFile 側で 'chord' に正規化する。
    (t.kind === undefined || t.kind === 'chord' || t.kind === 'notes') &&
    typeof t.instrumentId === 'string' &&
    typeof t.volumeDb === 'number' &&
    typeof t.muted === 'boolean' &&
    typeof t.solo === 'boolean' &&
    Array.isArray(t.blocks) &&
    t.blocks.every(isBlock)
    // laneHeightPx は廃止済み。旧ファイルに残っていても余分なキーとして無視する。
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
    // kind は 'chord'|'notes' 導入前のファイルに存在しないため、無い/不正な
    // 値は 'chord' に正規化する（以前はすべてのトラックがコード判定・
    // コード編集の対象として扱われていたので、それを再現するのが唯一
    // 「以前と見分けがつかない」デフォルトになる）。
    tracks = f.tracks.map((t) => {
      // laneHeightPx はトラック別高さ調整機能の廃止に伴い廃止済み。
      // 旧ファイルに残っていたら読み込み時に捨てる（再保存で消える）。
      const { laneHeightPx: _laneHeightPx, ...rest } = t as typeof t & { laneHeightPx?: unknown };
      return {
        ...rest,
        kind: t.kind === 'chord' || t.kind === 'notes' ? t.kind : 'chord',
      };
    });
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
        kind: 'chord',
        instrumentId: f.instrumentId,
        volumeDb: f.volumeDb,
        muted: false,
        solo: false,
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
