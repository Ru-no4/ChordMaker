import { create } from 'zustand';
import {
  CHORD_DIVISIONS,
  CHORD_TRACK_AREA_HEIGHT_MAX,
  DEFAULT_CHORD_ZOOM_Y,
  QUANTIZE_OPTIONS,
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  ZOOM_Y_MAX,
  ZOOM_Y_MIN,
  clamp,
  minChordTrackAreaHeight,
  snapLength,
  snapStep,
  stepsPerBar,
  type ChordResolution,
  type QuantizeValue,
  type TimeSignature,
} from '../lib/grid';
import { DEFAULT_INSTRUMENT_ID } from '../lib/instruments';
import { loadAutosave, saveAutosave } from '../lib/autosave';
import { nativeScrollbarThickness } from '../lib/scrollbar';
import type { ProjectFile, SerializedTrack } from '../lib/projectFile';

/* ------------------------------------------------------------------ */
/* モデル                                                              */
/* ------------------------------------------------------------------ */

export interface NoteItem {
  id: string;
  midi: number;
  /** 所属コードブロック先頭からの相対位置（32分音符単位） */
  start: number;
  /** 長さ（32分音符単位） */
  length: number;
  velocity: number;
}

export interface ChordBlockItem {
  id: string;
  /** トラック先頭からの位置（32分音符単位） */
  start: number;
  length: number;
  notes: NoteItem[];
}

/**
 * トラックの「中身」。ブロック配置・構成音そのものなので Undo 対象
 * （DocSnapshot に含まれる）。音源・音量・ミュート等の「設定」は
 * TrackSettings 側に分離してある — 音源を変えただけで Undo できてしまう、
 * という現行と異なる挙動が紛れ込まないようにするため。
 */
export interface Track {
  id: string;
  name: string;
  color: string;
  /**
   * 'chord' はコード判定・コード名表記を行う従来通りのトラック。
   * 'notes' はコード判定を行わず、ノートをミニプレビューで表示するだけの
   * 通常トラック（従来のDAWのピアノロールプレビューに近い）。
   */
  kind: 'chord' | 'notes';
  blocks: ChordBlockItem[];
}

/** トラックの「設定」。Undo 対象外（他の設定系フィールドと同じ扱い）。 */
export interface TrackSettings {
  instrumentId: string;
  volumeDb: number;
  muted: boolean;
  solo: boolean;
}

/** 編集ツール。すべての操作がツールだけで到達できるようにする。 */
export type EditorTool = 'draw' | 'range' | 'erase' | 'pan';

/**
 * ドラッグ開始時のノート状態。
 * 移動中は差分を累積せずここから毎回絶対値を計算し直す。
 * 差分を足し込むと、範囲端に当たったノートだけ取り残されて選択がバラける。
 */
export interface NoteDragSnapshot {
  blockId: string;
  noteId: string;
  start: number;
  length: number;
  midi: number;
}

/** クリップボード（コピー元は選択の種類に応じてどちらか片方だけ持つ） */
export interface ClipboardBlockPayload {
  kind: 'block';
  length: number;
  notes: Array<{ midi: number; start: number; length: number; velocity: number }>;
}
export interface ClipboardNotesPayload {
  kind: 'notes';
  /** コピー元の中で一番左のノートを基準にした相対位置 */
  entries: Array<{ offset: number; midi: number; length: number; velocity: number }>;
}
export type ClipboardPayload = ClipboardBlockPayload | ClipboardNotesPayload;

/** ピアノロールの表示範囲: C1〜C6（5オクターブ） */
export const PITCH_MIN = 24; // C1
export const PITCH_MAX = 84; // C6

let idSeq = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${idSeq++}`;

/* ------------------------------------------------------------------ */
/* 初期プロジェクト                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_SIG: TimeSignature = { numerator: 4, denominator: 4 };
const DEFAULT_BARS = 4;
const DEFAULT_BPM = 160;
const DEFAULT_QUANTIZE: QuantizeValue = 16;
const DEFAULT_CHORD_RESOLUTION: ChordResolution = 4;
const DEFAULT_VOLUME_DB = -30;
/**
 * トラック単位フェーダーの既定値。マスターフェーダー（DEFAULT_VOLUME_DB）とは
 * 別に、音声経路では synth/サンプル → トラックフェーダー → reverb → マスター →
 * limiter の順に直列に掛かる。ここを DEFAULT_VOLUME_DB と同じ値にすると
 * 「マスターとトラックの両方で-30dB」が重なって従来の約2倍（-60dB相当）
 * 静かになってしまうため、トラック側は 0dB（素通し）を既定にし、
 * 音量調整はマスターフェーダー1つに任せる。
 */
const DEFAULT_TRACK_VOLUME_DB = 0;
const DEFAULT_TRACK_NAME = 'CHORD TRACK';
const DEFAULT_TRACK_COLOR = '#4f8cff';
/**
 * トラック本数の上限。トラックが増えるほど、音源（特にサンプル音源）が
 * トラックごとに独立してメモリを消費するため、際限なく増やせないようにする。
 */
export const MAX_TRACKS = 8;
/** 「小節数」入力の安全な上限（意味のある業務的な上限ではなく、暴走防止のための値） */
const BARS_MAX = 512;
const BPM_MIN = 20;
const BPM_MAX = 300;
/**
 * 拍子（分子・分母）の安全な範囲。UI からは常に決まった候補（4/4 等）しか
 * 選べないが、.chrd ファイルは他人が作ったものを読み込む前提のフォーマットなので、
 * ファイル起因の値をここより外に出さない（暴走防止。business的な意味は無い）。
 */
const TIME_SIG_PART_MAX = 64;

function makeBlock(start: number, length: number, midis: number[]): ChordBlockItem {
  return {
    id: nextId('blk'),
    start,
    length,
    notes: midis.map((midi) => ({
      id: nextId('note'),
      midi,
      start: 0,
      length,
      velocity: 0.8,
    })),
  };
}

/** ルート音はそのまま、残りの構成音を1オクターブ上げる */
function rootLowVoicing(root: number, ...rest: number[]): number[] {
  return [root, ...rest.map((m) => m + 12)];
}

interface BlockSpec {
  start: number;
  length: number;
  midis: number[];
}

/** 既定のコード進行の中身（id を持たないので、既定状態かどうかの比較にも使える） */
function seedBlockSpecs(): BlockSpec[] {
  const bar = stepsPerBar(DEFAULT_SIG); // 32
  return [
    { start: bar * 0, length: bar, midis: rootLowVoicing(44, 48, 51, 55) }, // Abmaj7
    { start: bar * 1, length: bar, midis: rootLowVoicing(43, 47, 50, 53) }, // G7
    { start: bar * 2, length: bar, midis: rootLowVoicing(48, 51, 55, 58) }, // Cm7
    { start: bar * 3, length: bar, midis: rootLowVoicing(51, 49, 55, 58) }, // Eb7（下から Eb, C#, G, Bb）
  ];
}

/** ブロック配置・構成音が既定のコード進行と同じ内容かどうか（id は無視して値だけ見る） */
function isSeedBlocks(blocks: ChordBlockItem[]): boolean {
  const specs = seedBlockSpecs();
  if (blocks.length !== specs.length) return false;
  return blocks.every((b, i) => {
    const spec = specs[i];
    if (b.start !== spec.start || b.length !== spec.length) return false;
    if (b.notes.length !== spec.midis.length) return false;
    return b.notes.every(
      (n, j) => n.midi === spec.midis[j] && n.start === 0 && n.length === spec.length && n.velocity === 0.8,
    );
  });
}

function seedBlocks(): ChordBlockItem[] {
  return seedBlockSpecs().map(({ start, length, midis }) => makeBlock(start, length, midis));
}

function makeDefaultTrackSettings(): TrackSettings {
  return {
    instrumentId: DEFAULT_INSTRUMENT_ID,
    volumeDb: DEFAULT_TRACK_VOLUME_DB,
    muted: false,
    solo: false,
  };
}

/** 既定の単一トラック（起動時・初期化時に使う） */
function makeDefaultTrack(): Track {
  return {
    id: nextId('trk'),
    name: DEFAULT_TRACK_NAME,
    color: DEFAULT_TRACK_COLOR,
    kind: 'chord',
    blocks: seedBlocks(),
  };
}

/**
 * 起動時の既定状態（設定・コード進行とも）から何も変えていないかどうか。
 * 全削除・初期化の確認ダイアログを省略してよいかの判定に使う
 * （まだ何も自分の作業をしていないなら、確認なしで実行してよい）。
 */
export function isDefaultProjectState(s: {
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  rangeStart: number;
  chordResolution: ChordResolution;
  quantize: QuantizeValue;
  snap: boolean;
  tracks: Track[];
  trackSettings: Record<string, TrackSettings>;
}): boolean {
  if (s.tracks.length !== 1) return false;
  const track = s.tracks[0];
  const settings = s.trackSettings[track.id];
  return (
    s.bpm === DEFAULT_BPM &&
    s.timeSignature.numerator === DEFAULT_SIG.numerator &&
    s.timeSignature.denominator === DEFAULT_SIG.denominator &&
    s.bars === DEFAULT_BARS &&
    s.rangeStart === 0 &&
    s.chordResolution === DEFAULT_CHORD_RESOLUTION &&
    s.quantize === DEFAULT_QUANTIZE &&
    s.snap === true &&
    !!settings &&
    settings.instrumentId === DEFAULT_INSTRUMENT_ID &&
    settings.volumeDb === DEFAULT_TRACK_VOLUME_DB &&
    !settings.muted &&
    !settings.solo &&
    isSeedBlocks(track.blocks)
  );
}

/** ノートが1つも配置されていないか（トラックが無い、または全ブロックが空） */
export function hasNoNotes(tracks: Track[]): boolean {
  return tracks.every((t) => t.blocks.every((b) => b.notes.length === 0));
}

/* ------------------------------------------------------------------ */
/* 履歴（Undo / Redo）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 履歴に積むのは「作品の中身」だけ。
 * ツール選択・表示倍率・再生状態・選択状態・トラックの設定（音源/音量/
 * ミュート/表示高さ）は元に戻す対象にしない。
 */
interface DocSnapshot {
  tracks: Track[];
  bars: number;
  rangeStart: number;
  timeSignature: TimeSignature;
}

const HISTORY_LIMIT = 100;

const docOf = (s: {
  tracks: Track[];
  bars: number;
  rangeStart: number;
  timeSignature: TimeSignature;
}): DocSnapshot => ({
  tracks: s.tracks,
  bars: s.bars,
  rangeStart: s.rangeStart,
  timeSignature: s.timeSignature,
});

/** すべて immutable に差し替えているので参照比較で十分 */
const sameDoc = (a: DocSnapshot, b: DocSnapshot): boolean =>
  a.tracks === b.tracks &&
  a.bars === b.bars &&
  a.rangeStart === b.rangeStart &&
  a.timeSignature === b.timeSignature;

/** 復元後、消えたトラック / ブロック / ノートを選択・アクティブのままにしない */
function reconcileSelection(doc: DocSnapshot, prev: ProjectState) {
  const activeTrack = doc.tracks.find((t) => t.id === prev.activeTrackId) ?? doc.tracks[0] ?? null;
  const activeTrackId = activeTrack?.id ?? prev.activeTrackId;
  const blocks = activeTrack?.blocks ?? [];
  const noteIds = new Set(blocks.flatMap((b) => b.notes.map((n) => n.id)));
  const blockIds = new Set(blocks.map((b) => b.id));
  return {
    activeTrackId,
    selectedBlockId:
      prev.selectedBlockId && blockIds.has(prev.selectedBlockId) ? prev.selectedBlockId : null,
    selectedBlockIds: prev.selectedBlockIds.filter((id) => blockIds.has(id)),
    selectedNoteIds: prev.selectedNoteIds.filter((id) => noteIds.has(id)),
    selectedSegmentStart: null,
  };
}

/* ------------------------------------------------------------------ */
/* ストア                                                              */
/* ------------------------------------------------------------------ */

interface ProjectState {
  /* --- トランスポート設定 --- */
  bpm: number;
  timeSignature: TimeSignature;
  bars: number;
  /** 再生・ループ範囲の開始位置（小節単位）。bars（終了位置）以上になると無効扱い。 */
  rangeStart: number;
  loop: boolean;
  quantize: QuantizeValue;
  snap: boolean;
  /** マスターフェーダー（全トラック共通の最終ミックス音量） */
  volumeDb: number;

  /* --- 編集設定 --- */
  chordResolution: ChordResolution;
  editorTool: EditorTool;

  /* --- 表示倍率 --- */
  zoomX: number;
  /** ピアノロールの縦方向表示倍率 */
  zoomY: number;
  /** コードトラックの縦方向表示倍率（ピアノロールとは独立）。各レーンの高さはこの値から一律に決まる */
  chordZoomY: number;
  /**
   * コードトラック「エリア」（複数レーンをまとめて表示する領域）の表示高さ。
   * 境界のドラッグで手動調整する。個々のレーンの高さとは別物 — レーンは
   * chordZoomY から決まり、トラックが増えればこのエリアの中で縦に積み重なって
   * スクロールする。
   */
  chordTrackAreaHeight: number;
  /** 再生ヘッドを画面中央に追従させる */
  followPlayhead: boolean;

  /* --- 履歴 --- */
  past: DocSnapshot[];
  future: DocSnapshot[];
  /** トランザクションの入れ子深さ。ドラッグ全体を1操作にまとめるために使う。 */
  txDepth: number;
  txSnapshot: DocSnapshot | null;

  /* --- 再生状態（再生位置は usePlayheadStore 側） --- */
  isPlaying: boolean;

  /* --- 内容 --- */
  tracks: Track[];
  /** トラック単位の設定。Undo 対象外（tracks とは別に持つ理由は上記コメント参照） */
  trackSettings: Record<string, TrackSettings>;
  /** 今操作対象になっているトラック。ピアノロール・選択操作はこのトラックに対して働く */
  activeTrackId: string;
  /** トラック単位の音源読み込み状態。trackSettings と同様 Undo 対象外。 */
  trackInstrumentLoading: Record<string, boolean>;
  trackInstrumentError: Record<string, boolean>;
  selectedBlockId: string | null;
  /** コードトラック上の複数選択（一括ボイシングなど）。通常の単一選択とは独立して持つ。 */
  selectedBlockIds: string[];
  selectedNoteIds: string[];
  /** 選択中ブロック内の相対 step。null なら再生ヘッド/先頭で解決する。 */
  selectedSegmentStart: number | null;
  pianoRollOpen: boolean;
  /** コピー内容。ブロック / ノートのどちらかを持つ（同時には持たない）。 */
  clipboard: ClipboardPayload | null;

  /* --- アクション --- */
  setBpm: (bpm: number) => void;
  setTimeSignature: (sig: TimeSignature) => void;
  setBars: (bars: number) => void;
  setRangeStart: (bar: number) => void;
  /** 先頭に1小節挿入し、既存の内容をすべて後ろへずらす（全トラック共通） */
  addBarAtStart: () => void;
  toggleLoop: () => void;
  setQuantize: (q: QuantizeValue) => void;
  toggleSnap: () => void;
  /** マスターフェーダー */
  setVolumeDb: (db: number) => void;
  setChordResolution: (res: ChordResolution) => void;
  setEditorTool: (tool: EditorTool) => void;
  setZoomX: (zoom: number) => void;
  setZoomY: (zoom: number) => void;
  setChordZoomY: (zoom: number) => void;
  /** 現在値に対する相対倍率。連続クリックやホイールでも取りこぼさない。 */
  zoomXBy: (factor: number) => void;
  zoomYBy: (factor: number) => void;
  chordZoomYBy: (factor: number) => void;
  resetZoom: () => void;
  toggleFollowPlayhead: () => void;

  /* --- トラック --- */
  addTrack: (kind: 'chord' | 'notes') => string;
  removeTrack: (trackId: string) => void;
  setActiveTrack: (trackId: string) => void;
  setTrackInstrument: (trackId: string, instrumentId: string) => void;
  setTrackInstrumentStatus: (trackId: string, loading: boolean, error?: boolean) => void;
  setTrackVolumeDb: (trackId: string, db: number) => void;
  /** コードトラックエリア全体の高さ（トラック単位ではない） */
  setChordTrackAreaHeight: (px: number) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackSolo: (trackId: string) => void;
  renameTrack: (trackId: string, name: string) => void;
  setTrackColor: (trackId: string, color: string) => void;
  /** trackId を現在位置から delta ぶんだけ前後に動かす（範囲外は端で止まる） */
  moveTrackBy: (trackId: string, delta: number) => void;

  /** ドラッグの開始・終了で呼び、その間の変更を1つの履歴にまとめる */
  beginTransaction: () => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;

  setPlaying: (playing: boolean) => void;

  addBlockAt: (trackId: string, step: number) => string | null;
  removeBlock: (trackId: string, id: string) => void;
  moveBlock: (trackId: string, id: string, step: number) => void;
  resizeBlock: (trackId: string, id: string, length: number, fromStart?: boolean) => void;
  selectBlock: (trackId: string, id: string | null) => void;
  selectBlocks: (trackId: string, ids: string[], additive?: boolean) => void;
  toggleBlockSelection: (trackId: string, id: string) => void;
  clearBlockSelection: () => void;
  selectSegment: (relStep: number | null) => void;
  setPianoRollOpen: (open: boolean) => void;
  copyBlock: (trackId: string, id: string) => void;
  pasteBlockAt: (trackId: string, step: number) => string | null;
  /** 呼び出し側で計算済みのセグメント差し替えを、まとめて1回の Undo で反映する（アクティブトラック対象） */
  applyBulkSegmentNotes: (
    updates: Array<{ blockId: string; segStart: number; segLength: number; midis: number[] }>,
  ) => void;
  /**
   * 指定ノートを複製し、最も近い空き区間があればそこへ新しいブロックとして配置する
   * （無ければ元の位置に重ねて複製するだけ）。Ctrl+タップ（ドラッグ無し）での
   * コード複製に使う — 既存ブロックの隙間に縛られず、空いている場所へ自動で飛ぶ。
   */
  duplicateNotesToNearestGap: (trackId: string, noteIds: string[]) => void;

  /** 追加したノートの id を返す（描画直後にドラッグで長さを決めるため）。アクティブトラック対象。 */
  addNote: (blockId: string, midi: number, start: number, length: number) => string | null;
  updateNote: (blockId: string, noteId: string, patch: Partial<Omit<NoteItem, 'id'>>) => void;
  removeNotes: (ids: string[]) => void;
  removeSelectedNotes: () => void;
  clearNotes: (blockId: string) => void;
  setSegmentNotes: (
    blockId: string,
    segStart: number,
    segLength: number,
    midis: number[],
  ) => void;

  selectNotes: (ids: string[], additive?: boolean) => void;
  toggleNoteSelection: (id: string) => void;
  clearNoteSelection: () => void;
  selectAllNotesInBlock: (blockId: string) => void;
  copySelectedNotes: () => void;
  pasteNotesAt: (step: number) => void;
  duplicateSelectedNotes: () => NoteDragSnapshot[];
  applyNoteDrag: (snapshots: NoteDragSnapshot[], dStep: number, dMidi: number) => void;
  /** 右端をドラッグしての長さ変更。start は固定したまま length だけ変える。 */
  applyNoteResize: (snapshots: NoteDragSnapshot[], dLength: number) => void;
  /** 左端をドラッグしての長さ変更。末尾（start + length）は固定したまま start と length を逆方向に変える。 */
  applyNoteResizeLeft: (snapshots: NoteDragSnapshot[], dStart: number) => void;

  clearAll: () => void;
  loadProject: (file: ProjectFile) => void;
  /** 起動時の既定コード進行・設定へ戻す（内容の全削除とは異なり、初期状態そのものに戻す） */
  resetToDefault: () => void;
}

/* ------------------------------------------------------------------ */
/* ブロック配置のヘルパ                                                 */
/* ------------------------------------------------------------------ */

/** 指定ブロックを除いた「空き区間」の一覧を [開始, 終了) で返す */
function freeGaps(
  blocks: ChordBlockItem[],
  excludeId: string,
  limit: number,
): Array<[number, number]> {
  const others = blocks
    .filter((b) => b.id !== excludeId)
    .sort((a, b) => a.start - b.start);

  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const b of others) {
    if (b.start > cursor) gaps.push([cursor, b.start]);
    cursor = Math.max(cursor, b.start + b.length);
  }
  if (cursor < limit) gaps.push([cursor, limit]);
  return gaps;
}

/**
 * 長さを保ったまま、希望位置に最も近い空き区間へブロックを置く。
 * 収まる空きが無ければ移動しない（null を返す）。
 */
function placeBlock(
  blocks: ChordBlockItem[],
  id: string,
  desiredStart: number,
  length: number,
  limit: number,
): number | null {
  const candidates = freeGaps(blocks, id, limit).filter(([s, e]) => e - s >= length);
  if (candidates.length === 0) return null;

  // 希望位置をそのまま収められる空きを優先。無ければ最も近い空きへ寄せる。
  const distance = ([s, e]: [number, number]): number =>
    Math.abs(clamp(desiredStart, s, e - length) - desiredStart);
  const gap = candidates.reduce((best, g) => (distance(g) < distance(best) ? g : best));

  return clamp(desiredStart, gap[0], gap[1] - length);
}

/** 対象ブロックの右隣の開始位置（無ければプロジェクト終端） */
function nextBoundary(blocks: ChordBlockItem[], id: string, from: number, limit: number): number {
  return blocks.reduce(
    (acc, b) => (b.id !== id && b.start >= from ? Math.min(acc, b.start) : acc),
    limit,
  );
}

/** 対象ブロックの左隣の終端位置（無ければ 0） */
function prevBoundary(blocks: ChordBlockItem[], id: string, until: number): number {
  return blocks.reduce(
    (acc, b) => (b.id !== id && b.start + b.length <= until ? Math.max(acc, b.start + b.length) : acc),
    0,
  );
}

/**
 * 絶対 step を含むブロックを返す。無ければ最も近いブロック（ブロックが
 * 1つも無ければ null）。ノートは常にどこかのブロックに属する必要があるため、
 * 空白へ移動・貼り付けしようとした場合はここで最寄りのブロックへ寄せる。
 */
function resolveNoteTarget(blocks: ChordBlockItem[], absStart: number): ChordBlockItem | null {
  const covering = blocks.find((b) => absStart >= b.start && absStart < b.start + b.length);
  if (covering) return covering;

  let nearest: ChordBlockItem | null = null;
  let bestDist = Infinity;
  for (const b of blocks) {
    const dist =
      absStart < b.start ? b.start - absStart : absStart - (b.start + b.length) + 1;
    if (dist < bestDist) {
      bestDist = dist;
      nearest = b;
    }
  }
  return nearest;
}

/* ------------------------------------------------------------------ */
/* 複数ノート編集のヘルパ                                               */
/* ------------------------------------------------------------------ */

/**
 * 選択全体で共通のデルタを求める。
 * ノートごとに個別クランプすると、端に当たったものだけ動かなくなって
 * 選択の相対関係が崩れるため、許容範囲の積集合を取る。
 */
function commonDelta(
  snapshots: NoteDragSnapshot[],
  blockLengthOf: (blockId: string) => number,
  desired: number,
  rangeOf: (s: NoteDragSnapshot, blockLength: number) => [number, number],
): number {
  let lo = -Infinity;
  let hi = Infinity;
  for (const s of snapshots) {
    const [min, max] = rangeOf(s, blockLengthOf(s.blockId));
    lo = Math.max(lo, min);
    hi = Math.min(hi, max);
  }
  if (lo > hi) return 0;
  return clamp(desired, lo, hi);
}

const EMPTY_BLOCKS: ChordBlockItem[] = [];

/** アクティブトラックのブロック一覧（無ければ空配列）。UI コンポーネントの `blocks` セレクタとして使う。 */
export function selectActiveTrackBlocks(s: {
  tracks: Track[];
  activeTrackId: string;
}): ChordBlockItem[] {
  return s.tracks.find((t) => t.id === s.activeTrackId)?.blocks ?? EMPTY_BLOCKS;
}

/** アクティブトラックそのもの。kind/name/color も含めて見たい場合はこちらを使う。 */
export function selectActiveTrack(s: {
  tracks: Track[];
  activeTrackId: string;
}): Track | undefined {
  return s.tracks.find((t) => t.id === s.activeTrackId);
}

/** file.tracks（設定込みの保存形式）を tracks/trackSettings のランタイム形式へ分解する */
function splitSerializedTracks(
  serialized: SerializedTrack[],
): { tracks: Track[]; trackSettings: Record<string, TrackSettings> } {
  const tracks: Track[] = [];
  const trackSettings: Record<string, TrackSettings> = {};
  for (const t of serialized) {
    tracks.push({ id: t.id, name: t.name, color: t.color, kind: t.kind, blocks: t.blocks });
    trackSettings[t.id] = {
      instrumentId: t.instrumentId,
      volumeDb: t.volumeDb,
      muted: t.muted,
      solo: t.solo,
    };
  }
  return { tracks, trackSettings };
}

// タブを閉じるまでの間だけ、リロードしても直前のプロジェクトへ戻れるようにする。
// 壊れている・保存が無ければ null のままで、以下の各項目が既定値にフォールバックする。
const autosaved = loadAutosave();
const autosavedSplit = autosaved ? splitSerializedTracks(autosaved.tracks) : null;
const initialTracks = autosavedSplit?.tracks ?? [makeDefaultTrack()];
const initialTrackSettings =
  autosavedSplit?.trackSettings ?? { [initialTracks[0].id]: makeDefaultTrackSettings() };

// コードトラックエリアの下限計算に使うスクロールバーの太さ。OS/ブラウザで
// 異なる（Windows classic は十数px、macOS/モバイルのオーバーレイは 0px）ため
// 決め打ちにせず実測する（lib/scrollbar.ts 参照）。
const scrollbarAllowance = nativeScrollbarThickness();
const minChordTrackAreaHeightFor = (zoomY: number): number =>
  minChordTrackAreaHeight(zoomY, scrollbarAllowance);

export const useProjectStore = create<ProjectState>((set, get) => {
  /** 単発の操作を1つの履歴としてまとめる */
  const transact = (mutate: () => void) => {
    get().beginTransaction();
    mutate();
    get().endTransaction();
  };

  /** アクティブトラックのブロック配列を更新する（見つからなければ何もしない） */
  const updateActiveTrackBlocks = (
    updater: (blocks: ChordBlockItem[], track: Track) => ChordBlockItem[] | null,
  ) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === state.activeTrackId);
    if (!track) return;
    const nextBlocks = updater(track.blocks, track);
    if (nextBlocks === null) return;
    set({
      tracks: state.tracks.map((t) => (t.id === track.id ? { ...t, blocks: nextBlocks } : t)),
    });
  };

  return {
  bpm: autosaved?.bpm ?? DEFAULT_BPM,
  timeSignature: autosaved?.timeSignature ?? DEFAULT_SIG,
  bars: autosaved?.bars ?? DEFAULT_BARS,
  rangeStart: autosaved?.rangeStart ?? 0,
  loop: true,
  quantize: autosaved?.quantize ?? DEFAULT_QUANTIZE,
  snap: autosaved?.snap ?? true,
  volumeDb: DEFAULT_VOLUME_DB,

  chordResolution: autosaved?.chordResolution ?? DEFAULT_CHORD_RESOLUTION,
  editorTool: 'draw',
  zoomX: 0.5,
  zoomY: 0.8, // ZOOM_FACTOR 1段階分ズームアウトした状態を初期表示にする
  chordZoomY: DEFAULT_CHORD_ZOOM_Y,
  chordTrackAreaHeight: minChordTrackAreaHeightFor(DEFAULT_CHORD_ZOOM_Y),
  followPlayhead: true,

  past: [],
  future: [],
  txDepth: 0,
  txSnapshot: null,

  isPlaying: false,

  tracks: initialTracks,
  trackSettings: initialTrackSettings,
  activeTrackId: initialTracks[0].id,
  trackInstrumentLoading: Object.fromEntries(initialTracks.map((t) => [t.id, false])),
  trackInstrumentError: Object.fromEntries(initialTracks.map((t) => [t.id, false])),
  selectedBlockId: null,
  selectedBlockIds: [],
  selectedNoteIds: [],
  selectedSegmentStart: null,
  pianoRollOpen: true,
  clipboard: null,

  /* --- 設定 --- */
  setBpm: (bpm) => set({ bpm: clamp(Math.round(bpm), BPM_MIN, BPM_MAX) }),

  // 拍子・小節数は「再生できる範囲（ループ・自動停止の基準）」を決めるだけで、
  // 既存のブロック・ノートを切り詰めたりはしない。範囲より後ろにはみ出した内容は
  // そのまま残り、タイムライン表示側が必要に応じて表示幅を伸ばす（lib/grid.ts の
  // contentExtentSteps 参照）。DAW の「プロジェクト終端マーカー」と同じ考え方。
  setTimeSignature: (sig) => transact(() => set({ timeSignature: sig })),

  // 小節数そのものは整数だが、再生範囲スライダーは小節内を四分音符単位で
  // 動かせるようにしたいので、ここでは「1 step（32分音符）」単位への丸めに留める
  // （四分音符ぶんの丸めはドラッグ側が担当する。数値入力側は NumberField が
  // Math.round 済みの整数を渡してくるので、結果的にこれまで通り整数になる）。
  setBars: (bars) => {
    const perStep = 1 / stepsPerBar(get().timeSignature);
    const snapped = Math.round(bars / perStep) * perStep;
    transact(() => set({ bars: clamp(snapped, perStep, BARS_MAX) }));
  },

  // 終了位置（bars）と同様、開始位置も小節数には縛られず自由に動かせる。
  // 終了位置を追い越しても止めない — その場合は「入れ替わっている」として
  // 無効な範囲になり、ループの基準は先頭（0）へフォールバックする（useTransport 側）。
  setRangeStart: (bar) => {
    const perStep = 1 / stepsPerBar(get().timeSignature);
    const snapped = Math.round(bar / perStep) * perStep;
    transact(() => set({ rangeStart: clamp(snapped, 0, BARS_MAX) }));
  },

  // 先頭に1小節ぶんの空きを作る。全トラックの既存ブロック（＝中のノートも一緒に）を
  // すべて後ろへずらし、小節数と再生範囲の開始位置も1小節分あわせて増やす。
  // 座標がマイナスになることは無いので、小節番号は常に1始まりのまま保てる。
  addBarAtStart: () =>
    transact(() => {
      const state = get();
      const shift = stepsPerBar(state.timeSignature);
      set({
        tracks: state.tracks.map((t) => ({
          ...t,
          blocks: t.blocks.map((b) => ({ ...b, start: b.start + shift })),
        })),
        bars: clamp(state.bars + 1, 1, BARS_MAX),
        rangeStart: clamp(state.rangeStart + 1, 0, BARS_MAX),
      });
    }),

  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setQuantize: (quantize) => set({ quantize }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setVolumeDb: (volumeDb) => set({ volumeDb: clamp(volumeDb, -40, 0) }),
  setChordResolution: (chordResolution) => set({ chordResolution }),
  setEditorTool: (editorTool) => set({ editorTool }),
  setZoomX: (zoom) => set({ zoomX: clamp(zoom, ZOOM_X_MIN, ZOOM_X_MAX) }),
  setZoomY: (zoom) => set({ zoomY: clamp(zoom, ZOOM_Y_MIN, ZOOM_Y_MAX) }),
  setChordZoomY: (zoom) =>
    set((s) => {
      const chordZoomY = clamp(zoom, ZOOM_Y_MIN, ZOOM_Y_MAX);
      return {
        chordZoomY,
        chordTrackAreaHeight: Math.max(s.chordTrackAreaHeight, minChordTrackAreaHeightFor(chordZoomY)),
      };
    }),
  zoomXBy: (factor) =>
    set((s) => ({ zoomX: clamp(s.zoomX * factor, ZOOM_X_MIN, ZOOM_X_MAX) })),
  zoomYBy: (factor) =>
    set((s) => ({ zoomY: clamp(s.zoomY * factor, ZOOM_Y_MIN, ZOOM_Y_MAX) })),
  chordZoomYBy: (factor) =>
    set((s) => {
      const chordZoomY = clamp(s.chordZoomY * factor, ZOOM_Y_MIN, ZOOM_Y_MAX);
      return {
        chordZoomY,
        chordTrackAreaHeight: Math.max(s.chordTrackAreaHeight, minChordTrackAreaHeightFor(chordZoomY)),
      };
    }),
  resetZoom: () => set({ zoomX: 0.5, zoomY: 0.8, chordZoomY: DEFAULT_CHORD_ZOOM_Y }),
  toggleFollowPlayhead: () => set((s) => ({ followPlayhead: !s.followPlayhead })),

  /* --- トラック --- */
  addTrack: (kind) => {
    const s0 = get();
    // 再生中は追加不可（UI側もボタンを無効化するが、こちらは念のための防御）。
    // 上限に達していれば何もしない（呼び出し側は戻り値を使っていないので、
    // 何を返しても実害は無いが、意味の通る値として activeTrackId を返す）。
    if (s0.isPlaying || s0.tracks.length >= MAX_TRACKS) return s0.activeTrackId;

    let name: string;
    if (kind === 'chord') {
      // コードトラックの追加は「トラック一覧にコードトラックが1本も無い」
      // ときにしか選べない導線なので、名前の重複を気にする必要はない。
      name = DEFAULT_TRACK_NAME;
    } else {
      // 「TRACK N」で最初に空いている番号を使う（詰めて番号を振る）。
      // 例: TRACK 1 と TRACK 5 だけがある場合、次に作られるのは TRACK 2。
      const existingNames = new Set(get().tracks.map((t) => t.name));
      let n = 1;
      while (existingNames.has(`TRACK ${n}`)) n++;
      name = `TRACK ${n}`;
    }
    const track: Track = {
      id: nextId('trk'),
      name,
      color: DEFAULT_TRACK_COLOR,
      kind,
      blocks: [],
    };
    transact(() =>
      set((s) => ({
        tracks: [...s.tracks, track],
        trackSettings: { ...s.trackSettings, [track.id]: makeDefaultTrackSettings() },
        trackInstrumentLoading: { ...s.trackInstrumentLoading, [track.id]: false },
        trackInstrumentError: { ...s.trackInstrumentError, [track.id]: false },
        activeTrackId: track.id,
      })),
    );
    return track.id;
  },

  removeTrack: (trackId) =>
    transact(() =>
      set((s) => {
        if (s.isPlaying) return {}; // 再生中は削除不可（UI側もボタンを無効化）
        if (s.tracks.length <= 1) return {}; // 最後の1本は消せない
        const remaining = s.tracks.filter((t) => t.id !== trackId);
        const { [trackId]: _removed, ...restSettings } = s.trackSettings;
        const { [trackId]: _removedLoading, ...restLoading } = s.trackInstrumentLoading;
        const { [trackId]: _removedError, ...restError } = s.trackInstrumentError;
        const wasActive = s.activeTrackId === trackId;
        return {
          tracks: remaining,
          trackSettings: restSettings,
          trackInstrumentLoading: restLoading,
          trackInstrumentError: restError,
          activeTrackId: wasActive ? remaining[0].id : s.activeTrackId,
          selectedBlockId: wasActive ? null : s.selectedBlockId,
          selectedBlockIds: wasActive ? [] : s.selectedBlockIds,
          selectedNoteIds: wasActive ? [] : s.selectedNoteIds,
        };
      }),
    ),

  setActiveTrack: (trackId) =>
    set((s) => {
      if (!s.tracks.some((t) => t.id === trackId) || s.activeTrackId === trackId) return {};
      // 別トラックへ切り替えたら選択状態も破棄する。残したままだと
      // 非アクティブなトラック側にだけ選択ハイライトが残り、ピアノロールは
      // 何も選択されていない、という食い違いが起きるため。
      return {
        activeTrackId: trackId,
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
      };
    }),

  setTrackInstrument: (trackId, instrumentId) =>
    set((s) => {
      if (s.isPlaying) return {}; // 再生中は音源変更不可（UI側もセレクトを無効化）
      const settings = s.trackSettings[trackId];
      if (!settings) return {};
      return {
        trackSettings: {
          ...s.trackSettings,
          [trackId]: { ...settings, instrumentId, /* 切替直後は未読込 */ },
        },
      };
    }),

  setTrackInstrumentStatus: (trackId, loading, error = false) =>
    set((s) => ({
      trackInstrumentLoading: { ...s.trackInstrumentLoading, [trackId]: loading },
      trackInstrumentError: { ...s.trackInstrumentError, [trackId]: error },
    })),

  setTrackVolumeDb: (trackId, db) =>
    set((s) => {
      const settings = s.trackSettings[trackId];
      if (!settings) return {};
      return {
        trackSettings: { ...s.trackSettings, [trackId]: { ...settings, volumeDb: clamp(db, -40, 0) } },
      };
    }),

  setChordTrackAreaHeight: (px) =>
    set((s) => ({
      chordTrackAreaHeight: clamp(
        px,
        minChordTrackAreaHeightFor(s.chordZoomY),
        CHORD_TRACK_AREA_HEIGHT_MAX,
      ),
    })),

  toggleTrackMute: (trackId) =>
    set((s) => {
      const settings = s.trackSettings[trackId];
      if (!settings) return {};
      return { trackSettings: { ...s.trackSettings, [trackId]: { ...settings, muted: !settings.muted } } };
    }),

  toggleTrackSolo: (trackId) =>
    set((s) => {
      const settings = s.trackSettings[trackId];
      if (!settings) return {};
      return { trackSettings: { ...s.trackSettings, [trackId]: { ...settings, solo: !settings.solo } } };
    }),

  renameTrack: (trackId, name) =>
    transact(() =>
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)) })),
    ),

  setTrackColor: (trackId, color) =>
    transact(() =>
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, color } : t)) })),
    ),

  moveTrackBy: (trackId, delta) =>
    transact(() =>
      set((s) => {
        const idx = s.tracks.findIndex((t) => t.id === trackId);
        if (idx === -1) return {};
        const target = clamp(idx + delta, 0, s.tracks.length - 1);
        if (target === idx) return {};
        const next = [...s.tracks];
        const [moved] = next.splice(idx, 1);
        next.splice(target, 0, moved);
        return { tracks: next };
      }),
    ),

  /* --- 再生 --- */
  setPlaying: (isPlaying) => set({ isPlaying }),

  /* --- ブロック --- */
  addBlockAt: (trackId, step) => {
    get().beginTransaction();
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
      get().endTransaction();
      return null;
    }
    const bar = stepsPerBar(state.timeSignature);
    // 配置そのものは小節数に縛られない（再生範囲を超えて置ける。再生範囲は
    // bars がそのまま基準として使われ続ける）
    const start = Math.max(0, snapStep(step, state.quantize, state.snap));

    // 既存ブロックと重なる位置には作らない
    const gap = freeGaps(track.blocks, '', Infinity).find(([s, e]) => start >= s && start < e);
    if (!gap) {
      get().endTransaction();
      return null;
    }

    // 既定は1小節。次のブロックにぶつかるなら手前まで。
    const length = clamp(bar, 1, gap[1] - start);
    const block: ChordBlockItem = { id: nextId('blk'), start, length, notes: [] };
    set({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, blocks: [...t.blocks, block].sort((a, b) => a.start - b.start) } : t,
      ),
      activeTrackId: trackId,
      selectedBlockId: block.id,
      selectedNoteIds: [],
      selectedSegmentStart: null,
      pianoRollOpen: true,
    });
    get().endTransaction();
    return block.id;
  },

  removeBlock: (trackId, id) =>
    transact(() =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId);
        if (!track) return {};
        const target = track.blocks.find((b) => b.id === id);
        const removedNoteIds = new Set(target?.notes.map((n) => n.id) ?? []);
        return {
          tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, blocks: t.blocks.filter((b) => b.id !== id) } : t,
          ),
          selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
          selectedBlockIds: state.selectedBlockIds.filter((bid) => bid !== id),
          selectedNoteIds: state.selectedNoteIds.filter((nid) => !removedNoteIds.has(nid)),
          selectedSegmentStart:
            state.selectedBlockId === id ? null : state.selectedSegmentStart,
        };
      }),
    ),

  moveBlock: (trackId, id, step) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return {};
      const target = track.blocks.find((b) => b.id === id);
      if (!target) return {};
      const wanted = Math.max(0, snapStep(step, state.quantize, state.snap));
      const start = placeBlock(track.blocks, id, wanted, target.length, Infinity);
      if (start === null || start === target.start) return {};
      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                blocks: t.blocks
                  .map((b) => (b.id === id ? { ...b, start } : b))
                  .sort((a, b) => a.start - b.start),
              }
            : t,
        ),
      };
    }),

  resizeBlock: (trackId, id, length, fromStart = false) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return {};
      const target = track.blocks.find((b) => b.id === id);
      if (!target) return {};
      const snapped = snapLength(length, state.quantize, state.snap);

      if (fromStart) {
        // 末尾を固定して頭を動かす
        const end = target.start + target.length;
        const floor = prevBoundary(track.blocks, id, target.start);
        const start = clamp(end - snapped, floor, end - 1);
        if (start === target.start) return {};
        const delta = start - target.start;
        return {
          tracks: state.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  blocks: t.blocks.map((b) =>
                    b.id === id
                      ? {
                          ...b,
                          start,
                          length: end - start,
                          // ブロック頭が動いた分、ノートの相対位置を補正
                          notes: b.notes.map((n) => ({ ...n, start: Math.max(0, n.start - delta) })),
                        }
                      : b,
                  ),
                }
              : t,
          ),
        };
      }

      // 頭を固定して末尾を動かす（小節数には縛られない）
      const ceiling = nextBoundary(track.blocks, id, target.start + target.length, Infinity);
      const nextLength = clamp(snapped, 1, ceiling - target.start);
      if (nextLength === target.length) return {};
      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                blocks: t.blocks.map((b) =>
                  b.id === id
                    ? {
                        ...b,
                        length: nextLength,
                        // 短くしたときはノートがはみ出さないように詰める
                        notes: b.notes
                          .filter((n) => n.start < nextLength)
                          .map((n) => ({ ...n, length: Math.min(n.length, nextLength - n.start) })),
                      }
                    : b,
                ),
              }
            : t,
        ),
      };
    }),

  selectBlock: (trackId, selectedBlockId) =>
    set({
      activeTrackId: trackId,
      selectedBlockId,
      selectedBlockIds: [],
      selectedNoteIds: [],
      selectedSegmentStart: null,
    }),

  selectBlocks: (trackId, ids, additive = false) =>
    set((state) => {
      // 別トラックへの切り替えでは、前トラックの選択を引きずらない
      // （selectedBlockIds はトラックをまたいだ複数選択を想定していない）。
      const sameTrack = state.activeTrackId === trackId;
      return {
        activeTrackId: trackId,
        selectedBlockIds:
          additive && sameTrack
            ? [...new Set([...state.selectedBlockIds, ...ids])]
            : [...new Set(ids)],
        selectedNoteIds: [],
        selectedSegmentStart: null,
      };
    }),

  toggleBlockSelection: (trackId, id) =>
    set((state) => {
      const sameTrack = state.activeTrackId === trackId;
      const base = sameTrack ? state.selectedBlockIds : [];
      return {
        activeTrackId: trackId,
        selectedBlockIds: base.includes(id) ? base.filter((x) => x !== id) : [...base, id],
        selectedNoteIds: [],
        selectedSegmentStart: null,
      };
    }),

  clearBlockSelection: () => set({ selectedBlockIds: [] }),

  selectSegment: (selectedSegmentStart) => set({ selectedSegmentStart }),

  setPianoRollOpen: (pianoRollOpen) => set({ pianoRollOpen }),

  copyBlock: (trackId, id) => {
    const track = get().tracks.find((t) => t.id === trackId);
    const block = track?.blocks.find((b) => b.id === id);
    if (!block) return;
    set({
      clipboard: {
        kind: 'block',
        length: block.length,
        notes: block.notes.map(({ midi, start, length, velocity }) => ({
          midi,
          start,
          length,
          velocity,
        })),
      },
    });
  },

  pasteBlockAt: (trackId, step) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    const clip = state.clipboard;
    if (!track || !clip || clip.kind !== 'block') return null;

    get().beginTransaction();
    const desired = Math.max(0, snapStep(step, state.quantize, state.snap));
    const start = placeBlock(track.blocks, '', desired, clip.length, Infinity);
    if (start === null) {
      get().endTransaction();
      return null;
    }
    const block: ChordBlockItem = {
      id: nextId('blk'),
      start,
      length: clip.length,
      notes: clip.notes.map((n) => ({ ...n, id: nextId('note') })),
    };
    set({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, blocks: [...t.blocks, block].sort((a, b) => a.start - b.start) } : t,
      ),
      activeTrackId: trackId,
      selectedBlockId: block.id,
      selectedNoteIds: [],
      selectedSegmentStart: null,
      pianoRollOpen: true,
    });
    get().endTransaction();
    return block.id;
  },

  duplicateNotesToNearestGap: (trackId, noteIds) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const wanted = new Set(noteIds);
    const originals = track.blocks.flatMap((b) =>
      b.notes.filter((n) => wanted.has(n.id)).map((n) => ({ block: b, note: n })),
    );
    if (originals.length === 0) return;

    const minStart = Math.min(...originals.map((o) => o.block.start + o.note.start));
    const maxEnd = Math.max(...originals.map((o) => o.block.start + o.note.start + o.note.length));
    const spanLength = Math.max(1, maxEnd - minStart);

    // 空き区間の検索も小節数には縛られない（これがそもそもの要望）
    const gapStart = placeBlock(track.blocks, '', minStart, spanLength, Infinity);

    if (gapStart === null) {
      // 空きが見つからなければ、元の位置に重ねて複製するだけ（フォールバック）
      const additions = new Map<string, NoteItem[]>();
      const newIds: string[] = [];
      for (const { block, note } of originals) {
        const copy: NoteItem = { ...note, id: nextId('note') };
        newIds.push(copy.id);
        additions.set(block.id, [...(additions.get(block.id) ?? []), copy]);
      }
      transact(() =>
        set({
          tracks: state.tracks.map((t) =>
            t.id !== trackId
              ? t
              : {
                  ...t,
                  blocks: t.blocks.map((b) => {
                    const add = additions.get(b.id);
                    return add ? { ...b, notes: [...b.notes, ...add] } : b;
                  }),
                },
          ),
          selectedNoteIds: newIds,
        }),
      );
      return;
    }

    const newBlock: ChordBlockItem = {
      id: nextId('blk'),
      start: gapStart,
      length: spanLength,
      notes: originals.map(({ block, note }) => ({
        ...note,
        id: nextId('note'),
        start: block.start + note.start - minStart,
      })),
    };

    transact(() =>
      set({
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? { ...t, blocks: [...t.blocks, newBlock].sort((a, b) => a.start - b.start) }
            : t,
        ),
        activeTrackId: trackId,
        selectedBlockId: newBlock.id,
        selectedNoteIds: newBlock.notes.map((n) => n.id),
        selectedSegmentStart: null,
      }),
    );
  },

  /* --- ノート（すべてアクティブトラックに対して働く） --- */
  addNote: (blockId, midi, start, length) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === state.activeTrackId);
    const block = track?.blocks.find((b) => b.id === blockId);
    if (!track || !block) return null;

    const pitch = clamp(Math.round(midi), PITCH_MIN, PITCH_MAX);
    const s = clamp(snapStep(start, state.quantize, state.snap), 0, block.length - 1);
    const len = clamp(snapLength(length, state.quantize, state.snap), 1, block.length - s);
    const note: NoteItem = { id: nextId('note'), midi: pitch, start: s, length: len, velocity: 0.8 };

    set({
      tracks: state.tracks.map((t) =>
        t.id !== track.id
          ? t
          : { ...t, blocks: t.blocks.map((b) => (b.id === blockId ? { ...b, notes: [...b.notes, note] } : b)) },
      ),
      selectedNoteIds: [note.id],
    });
    return note.id;
  },

  updateNote: (blockId, noteId, patch) =>
    updateActiveTrackBlocks((blocks) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return null;
      return blocks.map((b) => {
        if (b.id !== blockId) return b;
        return {
          ...b,
          notes: b.notes.map((n) => {
            if (n.id !== noteId) return n;
            const merged = { ...n, ...patch };
            const midi = clamp(Math.round(merged.midi), PITCH_MIN, PITCH_MAX);
            const start = clamp(Math.round(merged.start), 0, b.length - 1);
            const length = clamp(Math.round(merged.length), 1, b.length - start);
            return { ...merged, midi, start, length };
          }),
        };
      });
    }),

  removeNotes: (ids) =>
    transact(() => {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      updateActiveTrackBlocks((blocks) =>
        blocks.map((b) =>
          b.notes.some((n) => doomed.has(n.id))
            ? { ...b, notes: b.notes.filter((n) => !doomed.has(n.id)) }
            : b,
        ),
      );
      set((state) => ({ selectedNoteIds: state.selectedNoteIds.filter((id) => !doomed.has(id)) }));
    }),

  removeSelectedNotes: () => get().removeNotes(get().selectedNoteIds),

  clearNotes: (blockId) =>
    transact(() => {
      const track = get().tracks.find((t) => t.id === get().activeTrackId);
      const block = track?.blocks.find((b) => b.id === blockId);
      const cleared = new Set(block?.notes.map((n) => n.id) ?? []);
      updateActiveTrackBlocks((blocks) =>
        blocks.map((b) => (b.id === blockId ? { ...b, notes: [] } : b)),
      );
      set((state) => ({ selectedNoteIds: state.selectedNoteIds.filter((id) => !cleared.has(id)) }));
    }),

  setSegmentNotes: (blockId, segStart, segLength, midis) =>
    transact(() => {
      updateActiveTrackBlocks((blocks) =>
        blocks.map((b) => {
          if (b.id !== blockId) return b;
          const segEnd = segStart + segLength;
          // セグメント範囲に鳴っているノートだけ差し替える
          const kept = b.notes.filter((n) => n.start >= segEnd || n.start + n.length <= segStart);
          const added = midis
            .filter((mi) => mi >= PITCH_MIN && mi <= PITCH_MAX)
            .map((midi) => ({
              id: nextId('note'),
              midi,
              start: segStart,
              length: segLength,
              velocity: 0.8,
            }));
          return { ...b, notes: [...kept, ...added] };
        }),
      );
      set({ selectedNoteIds: [] });
    }),

  /**
   * setSegmentNotes と同じ差し替えを、複数セグメントぶんまとめて1回の Undo で行う。
   * ボイシングの一括変更（チェーン適用）などで、呼び出し側が内容を計算済みの場合に使う。
   */
  applyBulkSegmentNotes: (updates) =>
    transact(() => {
      updateActiveTrackBlocks((blocks) => {
        let next = blocks;
        for (const u of updates) {
          next = next.map((b) => {
            if (b.id !== u.blockId) return b;
            const segEnd = u.segStart + u.segLength;
            const kept = b.notes.filter((n) => n.start >= segEnd || n.start + n.length <= u.segStart);
            const added = u.midis
              .filter((mi) => mi >= PITCH_MIN && mi <= PITCH_MAX)
              .map((midi) => ({
                id: nextId('note'),
                midi,
                start: u.segStart,
                length: u.segLength,
                velocity: 0.8,
              }));
            return { ...b, notes: [...kept, ...added] };
          });
        }
        return next;
      });
      set({ selectedNoteIds: [] });
    }),

  /* --- 選択 --- */
  selectNotes: (ids, additive = false) =>
    set((state) => ({
      selectedNoteIds: additive
        ? [...new Set([...state.selectedNoteIds, ...ids])]
        : [...new Set(ids)],
    })),

  toggleNoteSelection: (id) =>
    set((state) => ({
      selectedNoteIds: state.selectedNoteIds.includes(id)
        ? state.selectedNoteIds.filter((n) => n !== id)
        : [...state.selectedNoteIds, id],
    })),

  clearNoteSelection: () => set({ selectedNoteIds: [] }),

  selectAllNotesInBlock: (blockId) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === state.activeTrackId);
      return { selectedNoteIds: track?.blocks.find((b) => b.id === blockId)?.notes.map((n) => n.id) ?? [] };
    }),

  copySelectedNotes: () => {
    const state = get();
    const track = state.tracks.find((t) => t.id === state.activeTrackId);
    const selected = new Set(state.selectedNoteIds);
    if (!track || selected.size === 0) return;

    const entries: Array<{ absStart: number; midi: number; length: number; velocity: number }> = [];
    for (const b of track.blocks) {
      for (const n of b.notes) {
        if (selected.has(n.id)) {
          entries.push({ absStart: b.start + n.start, midi: n.midi, length: n.length, velocity: n.velocity });
        }
      }
    }
    if (entries.length === 0) return;

    const anchor = Math.min(...entries.map((e) => e.absStart));
    set({
      clipboard: {
        kind: 'notes',
        entries: entries.map((e) => ({
          offset: e.absStart - anchor,
          midi: e.midi,
          length: e.length,
          velocity: e.velocity,
        })),
      },
    });
  },

  /**
   * コピーしたノートを、一番左のものが指定 step に来るように貼り付ける。
   * 貼り付け先はブロックを問わない — 各ノートは自分の絶対位置を覆う
   * ブロックへ、無ければ最寄りのブロックへ属する（resolveNoteTarget 参照）。
   */
  pasteNotesAt: (step) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === state.activeTrackId);
    const clip = state.clipboard;
    if (!track || !clip || clip.kind !== 'notes') return;

    get().beginTransaction();
    const anchorStep = Math.round(step);
    const additions = new Map<string, NoteItem[]>();
    const newIds: string[] = [];

    for (const entry of clip.entries) {
      const absStart = anchorStep + entry.offset;
      const target = resolveNoteTarget(track.blocks, absStart);
      if (!target) continue;
      const relStart = clamp(absStart - target.start, 0, Math.max(0, target.length - 1));
      const relLength = clamp(entry.length, 1, target.length - relStart);
      const note: NoteItem = {
        id: nextId('note'),
        midi: clamp(entry.midi, PITCH_MIN, PITCH_MAX),
        start: relStart,
        length: relLength,
        velocity: entry.velocity,
      };
      newIds.push(note.id);
      additions.set(target.id, [...(additions.get(target.id) ?? []), note]);
    }

    if (newIds.length === 0) {
      get().endTransaction();
      return;
    }

    set({
      tracks: state.tracks.map((t) =>
        t.id !== track.id
          ? t
          : {
              ...t,
              blocks: t.blocks.map((b) => {
                const add = additions.get(b.id);
                return add ? { ...b, notes: [...b.notes, ...add] } : b;
              }),
            },
      ),
      selectedNoteIds: newIds,
    });
    get().endTransaction();
  },

  duplicateSelectedNotes: () => {
    const state = get();
    const track = state.tracks.find((t) => t.id === state.activeTrackId);
    const selected = new Set(state.selectedNoteIds);
    if (!track || selected.size === 0) return [];

    const clones: NoteDragSnapshot[] = [];
    const blocks = track.blocks.map((b) => {
      const targets = b.notes.filter((n) => selected.has(n.id));
      if (targets.length === 0) return b;
      const copies = targets.map((n) => {
        const copy: NoteItem = { ...n, id: nextId('note') };
        clones.push({
          blockId: b.id,
          noteId: copy.id,
          start: copy.start,
          length: copy.length,
          midi: copy.midi,
        });
        return copy;
      });
      return { ...b, notes: [...b.notes, ...copies] };
    });

    // 複製した側を掴んで動かす。元のノートはその場に残る。
    set({
      tracks: state.tracks.map((t) => (t.id === track.id ? { ...t, blocks } : t)),
      selectedNoteIds: clones.map((c) => c.noteId),
    });
    return clones;
  },

  /**
   * ノートは元のブロックの中に留まらず、移動先の絶対位置を覆う
   * どのブロックへでも跨いで移動できる（同じ小節縛りをここで外している）。
   * 移動量そのものはプロジェクト全体の範囲でのみクランプし、
   * 実際にどのブロックへ属するかは着地点ごとに resolveNoteTarget で解決する。
   * トラックを跨いだ移動はしない（アクティブトラックの中で完結する）。
   */
  applyNoteDrag: (snapshots, dStep, dMidi) =>
    updateActiveTrackBlocks((blocks) => {
      if (snapshots.length === 0) return null;
      const blocksById = new Map(blocks.map((b) => [b.id, b]));
      const absStartOf = (s: NoteDragSnapshot) => (blocksById.get(s.blockId)?.start ?? 0) + s.start;

      // ノートの移動範囲も小節数には縛られない
      const step = commonDelta(snapshots, () => 0, dStep, (s) => {
        const abs = absStartOf(s);
        return [-abs, Infinity];
      });
      const midi = commonDelta(snapshots, () => 0, dMidi, (s) => [
        PITCH_MIN - s.midi,
        PITCH_MAX - s.midi,
      ]);

      // 元のノート実体（velocity 等）を集めておく
      const originals = new Map<string, NoteItem>();
      const movingIds = new Set(snapshots.map((s) => s.noteId));
      for (const b of blocks) {
        for (const n of b.notes) {
          if (movingIds.has(n.id)) originals.set(n.id, n);
        }
      }

      const relocated = new Set<string>();
      const additions = new Map<string, NoteItem[]>();

      for (const s of snapshots) {
        const original = originals.get(s.noteId);
        if (!original) continue;
        const absStart = absStartOf(s) + step;
        const target = resolveNoteTarget(blocks, absStart);
        if (!target) continue; // 属せるブロックが無ければその場に残す

        relocated.add(s.noteId);
        const relStart = clamp(Math.round(absStart) - target.start, 0, Math.max(0, target.length - 1));
        const relLength = clamp(s.length, 1, target.length - relStart);
        const note: NoteItem = {
          ...original,
          midi: clamp(s.midi + midi, PITCH_MIN, PITCH_MAX),
          start: relStart,
          length: relLength,
        };
        additions.set(target.id, [...(additions.get(target.id) ?? []), note]);
      }

      return blocks.map((b) => {
        const kept = b.notes.filter((n) => !relocated.has(n.id));
        const add = additions.get(b.id);
        if (!add && kept.length === b.notes.length) return b;
        return { ...b, notes: add ? [...kept, ...add] : kept };
      });
    }),

  applyNoteResize: (snapshots, dLength) =>
    updateActiveTrackBlocks((blocks) => {
      if (snapshots.length === 0) return null;
      const lengthOf = (blockId: string) => blocks.find((b) => b.id === blockId)?.length ?? 0;

      const delta = commonDelta(snapshots, lengthOf, dLength, (s, blockLength) => [
        1 - s.length,
        Math.max(1 - s.length, blockLength - s.start - s.length),
      ]);

      const byId = new Map(snapshots.map((s) => [s.noteId, s]));
      return blocks.map((b) => {
        if (!b.notes.some((n) => byId.has(n.id))) return b;
        return {
          ...b,
          notes: b.notes.map((n) => {
            const snap = byId.get(n.id);
            if (!snap) return n;
            return { ...n, length: snap.length + delta };
          }),
        };
      });
    }),

  applyNoteResizeLeft: (snapshots, dStart) =>
    updateActiveTrackBlocks((blocks) => {
      if (snapshots.length === 0) return null;
      // 末尾（start + length）を固定し、start を動かした分だけ length を逆方向に変える。
      // ブロック左端(0)より前へは出さず、長さは最低1 step を保つ。
      const delta = commonDelta(snapshots, () => 0, dStart, (s) => [-s.start, s.length - 1]);

      const byId = new Map(snapshots.map((s) => [s.noteId, s]));
      return blocks.map((b) => {
        if (!b.notes.some((n) => byId.has(n.id))) return b;
        return {
          ...b,
          notes: b.notes.map((n) => {
            const snap = byId.get(n.id);
            if (!snap) return n;
            return { ...n, start: snap.start + delta, length: snap.length - delta };
          }),
        };
      });
    }),

  clearAll: () =>
    transact(() => {
      updateActiveTrackBlocks(() => []);
      set({
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
        selectedSegmentStart: null,
      });
    }),

  /**
   * ファイルから読み込んだ内容を丸ごと反映する。
   * トラックの中身（ブロック） / 小節数 / 拍子は Undo 対象（誤って読み込んでも Ctrl+Z で戻せる）。
   * トラックの設定（音源・音量など）や他の設定は、他のセッターと同様に Undo 対象外。
   *
   * .chrd は他人が作ったファイルを読み込む前提のフォーマット。
   * parseProjectFile は「形（型）」の検証はするが値の範囲までは見ていないため、
   * ここで通常の UI 操作と同じ範囲に丸める（例えば bars に巨大な値を仕込んだ
   * ファイルを開かせて、タイムラインに大量のグリッドを描画させフリーズさせる
   * ような壊れ方/悪用を防ぐ）。
   */
  loadProject: (file) =>
    transact(() => {
      const { tracks, trackSettings } = splitSerializedTracks(file.tracks);
      const timeSignature: TimeSignature = {
        numerator: clamp(Math.round(file.timeSignature.numerator), 1, TIME_SIG_PART_MAX),
        denominator: clamp(Math.round(file.timeSignature.denominator), 1, TIME_SIG_PART_MAX),
      };
      const minBars = 1 / stepsPerBar(timeSignature);
      set({
        tracks,
        trackSettings,
        activeTrackId: tracks[0]?.id ?? get().activeTrackId,
        bars: clamp(file.bars, minBars, BARS_MAX),
        rangeStart: clamp(file.rangeStart ?? 0, 0, BARS_MAX),
        timeSignature,
        bpm: clamp(Math.round(file.bpm), BPM_MIN, BPM_MAX),
        chordResolution: (CHORD_DIVISIONS as readonly number[]).includes(file.chordResolution)
          ? (file.chordResolution as ChordResolution)
          : DEFAULT_CHORD_RESOLUTION,
        quantize: (QUANTIZE_OPTIONS as readonly number[]).includes(file.quantize)
          ? (file.quantize as QuantizeValue)
          : DEFAULT_QUANTIZE,
        snap: file.snap,
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
        selectedSegmentStart: null,
        clipboard: null,
      });
    }),

  /** 起動時の既定コード進行・設定へ戻す（clearAll と違い、内容だけでなく設定も既定値に戻る） */
  resetToDefault: () =>
    transact(() => {
      const track = makeDefaultTrack();
      set({
        tracks: [track],
        trackSettings: { [track.id]: makeDefaultTrackSettings() },
        activeTrackId: track.id,
        bars: DEFAULT_BARS,
        rangeStart: 0,
        timeSignature: DEFAULT_SIG,
        bpm: DEFAULT_BPM,
        chordResolution: DEFAULT_CHORD_RESOLUTION,
        quantize: DEFAULT_QUANTIZE,
        snap: true,
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
        selectedSegmentStart: null,
        clipboard: null,
      });
    }),

  /* --- 履歴 --- */
  beginTransaction: () =>
    set((s) =>
      s.txDepth === 0
        ? { txDepth: 1, txSnapshot: docOf(s) }
        : { txDepth: s.txDepth + 1 },
    ),

  endTransaction: () =>
    set((s) => {
      if (s.txDepth === 0) return {};
      if (s.txDepth > 1) return { txDepth: s.txDepth - 1 };

      const snapshot = s.txSnapshot;
      // 何も変わっていなければ履歴に残さない（ただのクリック等）
      if (!snapshot || sameDoc(snapshot, docOf(s))) {
        return { txDepth: 0, txSnapshot: null };
      }
      return {
        txDepth: 0,
        txSnapshot: null,
        past: [...s.past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
      };
    }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        ...previous,
        past: s.past.slice(0, -1),
        future: [...s.future, docOf(s)],
        ...reconcileSelection(previous, s),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[s.future.length - 1];
      return {
        ...next,
        past: [...s.past, docOf(s)].slice(-HISTORY_LIMIT),
        future: s.future.slice(0, -1),
        ...reconcileSelection(next, s),
      };
    }),
  };
});

/**
 * タブを開いている間、内容が変わるたびに自動保存する（デバウンスして頻度を抑える）。
 * 書き込むのは「作品」に相当する項目だけで、選択状態や表示倍率などは含めない
 * （そこまで戻す必要は無く、むしろ再読込のたびに選択が残っていると不自然なため）。
 */
export function mergeTracksForSave(state: {
  tracks: Track[];
  trackSettings: Record<string, TrackSettings>;
}): SerializedTrack[] {
  return state.tracks.map((t) => {
    const settings = state.trackSettings[t.id] ?? makeDefaultTrackSettings();
    return { ...t, ...settings };
  });
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
useProjectStore.subscribe((state) => {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveAutosave({
      bpm: state.bpm,
      timeSignature: state.timeSignature,
      bars: state.bars,
      rangeStart: state.rangeStart,
      chordResolution: state.chordResolution,
      quantize: state.quantize,
      snap: state.snap,
      tracks: mergeTracksForSave(state),
    });
  }, 400);
});

/** 再生用に全ブロックのノートを絶対位置へ展開する */
export function flattenNotes(blocks: ChordBlockItem[]) {
  return blocks.flatMap((b) =>
    b.notes.map((n) => ({
      midi: n.midi,
      startStep: b.start + n.start,
      lengthSteps: n.length,
      velocity: n.velocity,
    })),
  );
}
