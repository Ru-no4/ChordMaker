import { create } from 'zustand';
import {
  ZOOM_X_MAX,
  ZOOM_X_MIN,
  ZOOM_Y_MAX,
  ZOOM_Y_MIN,
  clamp,
  snapLength,
  snapStep,
  stepsPerBar,
  type ChordResolution,
  type QuantizeValue,
  type TimeSignature,
} from '../lib/grid';
import { DEFAULT_INSTRUMENT_ID } from '../lib/instruments';
import type { ProjectFile } from '../lib/projectFile';

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
  /** プロジェクト先頭からの位置（32分音符単位） */
  start: number;
  length: number;
  notes: NoteItem[];
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
/** 「小節数」入力の安全な上限（意味のある業務的な上限ではなく、暴走防止のための値） */
const BARS_MAX = 512;

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

function seedBlocks(): ChordBlockItem[] {
  const bar = stepsPerBar(DEFAULT_SIG); // 32
  return [
    makeBlock(bar * 0, bar, rootLowVoicing(44, 48, 51, 55)), // Abmaj7
    makeBlock(bar * 1, bar, rootLowVoicing(43, 47, 50, 53)), // G7
    makeBlock(bar * 2, bar, rootLowVoicing(48, 51, 55, 58)), // Cm7
    makeBlock(bar * 3, bar, rootLowVoicing(51, 55, 58)), // Eb
  ];
}

/* ------------------------------------------------------------------ */
/* 履歴（Undo / Redo）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 履歴に積むのは「作品の中身」だけ。
 * ツール選択・表示倍率・再生状態・選択状態は元に戻す対象にしない。
 */
interface DocSnapshot {
  blocks: ChordBlockItem[];
  bars: number;
  rangeStart: number;
  timeSignature: TimeSignature;
}

const HISTORY_LIMIT = 100;

const docOf = (s: {
  blocks: ChordBlockItem[];
  bars: number;
  rangeStart: number;
  timeSignature: TimeSignature;
}): DocSnapshot => ({
  blocks: s.blocks,
  bars: s.bars,
  rangeStart: s.rangeStart,
  timeSignature: s.timeSignature,
});

/** すべて immutable に差し替えているので参照比較で十分 */
const sameDoc = (a: DocSnapshot, b: DocSnapshot): boolean =>
  a.blocks === b.blocks &&
  a.bars === b.bars &&
  a.rangeStart === b.rangeStart &&
  a.timeSignature === b.timeSignature;

/** 復元後、消えたブロック / ノートを選択したままにしない */
function reconcileSelection(doc: DocSnapshot, prev: ProjectState) {
  const noteIds = new Set(doc.blocks.flatMap((b) => b.notes.map((n) => n.id)));
  const blockIds = new Set(doc.blocks.map((b) => b.id));
  return {
    selectedBlockId: doc.blocks.some((b) => b.id === prev.selectedBlockId)
      ? prev.selectedBlockId
      : null,
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
  volumeDb: number;

  /* --- 編集設定 --- */
  chordResolution: ChordResolution;
  editorTool: EditorTool;

  /* --- 表示倍率 --- */
  zoomX: number;
  zoomY: number;
  /** 再生ヘッドを画面中央に追従させる */
  followPlayhead: boolean;

  /* --- 音源 --- */
  instrumentId: string;
  /** サンプルの読み込み中。この間は内蔵シンセで鳴る。 */
  instrumentLoading: boolean;
  instrumentError: string | null;

  /* --- 履歴 --- */
  past: DocSnapshot[];
  future: DocSnapshot[];
  /** トランザクションの入れ子深さ。ドラッグ全体を1操作にまとめるために使う。 */
  txDepth: number;
  txSnapshot: DocSnapshot | null;

  /* --- 再生状態（再生位置は usePlayheadStore 側） --- */
  isPlaying: boolean;

  /* --- 内容 --- */
  blocks: ChordBlockItem[];
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
  toggleLoop: () => void;
  setQuantize: (q: QuantizeValue) => void;
  toggleSnap: () => void;
  setVolumeDb: (db: number) => void;
  setChordResolution: (res: ChordResolution) => void;
  setEditorTool: (tool: EditorTool) => void;
  setZoomX: (zoom: number) => void;
  setZoomY: (zoom: number) => void;
  /** 現在値に対する相対倍率。連続クリックやホイールでも取りこぼさない。 */
  zoomXBy: (factor: number) => void;
  zoomYBy: (factor: number) => void;
  resetZoom: () => void;
  toggleFollowPlayhead: () => void;
  setInstrument: (id: string) => void;
  setInstrumentStatus: (loading: boolean, error?: string | null) => void;

  /** ドラッグの開始・終了で呼び、その間の変更を1つの履歴にまとめる */
  beginTransaction: () => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;

  setPlaying: (playing: boolean) => void;

  addBlockAt: (step: number) => string | null;
  removeBlock: (id: string) => void;
  moveBlock: (id: string, step: number) => void;
  resizeBlock: (id: string, length: number, fromStart?: boolean) => void;
  selectBlock: (id: string | null) => void;
  selectBlocks: (ids: string[], additive?: boolean) => void;
  toggleBlockSelection: (id: string) => void;
  clearBlockSelection: () => void;
  selectSegment: (relStep: number | null) => void;
  setPianoRollOpen: (open: boolean) => void;
  copyBlock: (id: string) => void;
  pasteBlockAt: (step: number) => string | null;
  /** 呼び出し側で計算済みのセグメント差し替えを、まとめて1回の Undo で反映する */
  applyBulkSegmentNotes: (
    updates: Array<{ blockId: string; segStart: number; segLength: number; midis: number[] }>,
  ) => void;
  /**
   * 指定ノートを複製し、最も近い空き区間があればそこへ新しいブロックとして配置する
   * （無ければ元の位置に重ねて複製するだけ）。Ctrl+タップ（ドラッグ無し）での
   * コード複製に使う — 既存ブロックの隙間に縛られず、空いている場所へ自動で飛ぶ。
   */
  duplicateNotesToNearestGap: (noteIds: string[]) => void;

  /** 追加したノートの id を返す（描画直後にドラッグで長さを決めるため） */
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
  applyNoteResize: (snapshots: NoteDragSnapshot[], dLength: number) => void;

  clearAll: () => void;
  loadProject: (file: ProjectFile) => void;
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

export const useProjectStore = create<ProjectState>((set, get) => {
  /** 単発の操作を1つの履歴としてまとめる */
  const transact = (mutate: () => void) => {
    get().beginTransaction();
    mutate();
    get().endTransaction();
  };

  return {
  bpm: 160,
  timeSignature: DEFAULT_SIG,
  bars: DEFAULT_BARS,
  rangeStart: 0,
  loop: true,
  quantize: 16,
  snap: true,
  volumeDb: -12,

  chordResolution: 4,
  editorTool: 'draw',
  zoomX: 0.5,
  zoomY: 0.8, // ZOOM_FACTOR 1段階分ズームアウトした状態を初期表示にする
  followPlayhead: true,

  instrumentId: DEFAULT_INSTRUMENT_ID,
  instrumentLoading: false,
  instrumentError: null,

  past: [],
  future: [],
  txDepth: 0,
  txSnapshot: null,

  isPlaying: false,

  blocks: seedBlocks(),
  selectedBlockId: null,
  selectedBlockIds: [],
  selectedNoteIds: [],
  selectedSegmentStart: null,
  pianoRollOpen: true,
  clipboard: null,

  /* --- 設定 --- */
  setBpm: (bpm) => set({ bpm: clamp(Math.round(bpm), 20, 300) }),

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

  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  setQuantize: (quantize) => set({ quantize }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setVolumeDb: (volumeDb) => set({ volumeDb: clamp(volumeDb, -40, 0) }),
  setChordResolution: (chordResolution) => set({ chordResolution }),
  setEditorTool: (editorTool) => set({ editorTool }),
  setZoomX: (zoom) => set({ zoomX: clamp(zoom, ZOOM_X_MIN, ZOOM_X_MAX) }),
  setZoomY: (zoom) => set({ zoomY: clamp(zoom, ZOOM_Y_MIN, ZOOM_Y_MAX) }),
  zoomXBy: (factor) =>
    set((s) => ({ zoomX: clamp(s.zoomX * factor, ZOOM_X_MIN, ZOOM_X_MAX) })),
  zoomYBy: (factor) =>
    set((s) => ({ zoomY: clamp(s.zoomY * factor, ZOOM_Y_MIN, ZOOM_Y_MAX) })),
  resetZoom: () => set({ zoomX: 0.5, zoomY: 0.8 }),
  toggleFollowPlayhead: () => set((s) => ({ followPlayhead: !s.followPlayhead })),
  setInstrument: (instrumentId) => set({ instrumentId, instrumentError: null }),
  setInstrumentStatus: (instrumentLoading, instrumentError = null) =>
    set({ instrumentLoading, instrumentError }),

  /* --- 再生 --- */
  setPlaying: (isPlaying) => set({ isPlaying }),

  /* --- ブロック --- */
  addBlockAt: (step) => {
    get().beginTransaction();
    const state = get();
    const bar = stepsPerBar(state.timeSignature);
    // 配置そのものは小節数に縛られない（再生範囲を超えて置ける。再生範囲は
    // bars がそのまま基準として使われ続ける）
    const start = Math.max(0, snapStep(step, state.quantize, state.snap));

    // 既存ブロックと重なる位置には作らない
    const gap = freeGaps(state.blocks, '', Infinity).find(([s, e]) => start >= s && start < e);
    if (!gap) {
      get().endTransaction();
      return null;
    }

    // 既定は1小節。次のブロックにぶつかるなら手前まで。
    const length = clamp(bar, 1, gap[1] - start);
    const block: ChordBlockItem = { id: nextId('blk'), start, length, notes: [] };
    set({
      blocks: [...state.blocks, block].sort((a, b) => a.start - b.start),
      selectedBlockId: block.id,
      selectedNoteIds: [],
      selectedSegmentStart: null,
      pianoRollOpen: true,
    });
    get().endTransaction();
    return block.id;
  },

  removeBlock: (id) =>
    transact(() =>
    set((state) => {
      const target = state.blocks.find((b) => b.id === id);
      const removedNoteIds = new Set(target?.notes.map((n) => n.id) ?? []);
      return {
        blocks: state.blocks.filter((b) => b.id !== id),
        selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
        selectedBlockIds: state.selectedBlockIds.filter((bid) => bid !== id),
        selectedNoteIds: state.selectedNoteIds.filter((nid) => !removedNoteIds.has(nid)),
        selectedSegmentStart:
          state.selectedBlockId === id ? null : state.selectedSegmentStart,
      };
    }),
    ),

  moveBlock: (id, step) =>
    set((state) => {
      const target = state.blocks.find((b) => b.id === id);
      if (!target) return {};
      const wanted = Math.max(0, snapStep(step, state.quantize, state.snap));
      const start = placeBlock(state.blocks, id, wanted, target.length, Infinity);
      if (start === null || start === target.start) return {};
      return {
        blocks: state.blocks
          .map((b) => (b.id === id ? { ...b, start } : b))
          .sort((a, b) => a.start - b.start),
      };
    }),

  resizeBlock: (id, length, fromStart = false) =>
    set((state) => {
      const target = state.blocks.find((b) => b.id === id);
      if (!target) return {};
      const snapped = snapLength(length, state.quantize, state.snap);

      if (fromStart) {
        // 末尾を固定して頭を動かす
        const end = target.start + target.length;
        const floor = prevBoundary(state.blocks, id, target.start);
        const start = clamp(end - snapped, floor, end - 1);
        if (start === target.start) return {};
        const delta = start - target.start;
        return {
          blocks: state.blocks.map((b) =>
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
        };
      }

      // 頭を固定して末尾を動かす（小節数には縛られない）
      const ceiling = nextBoundary(state.blocks, id, target.start + target.length, Infinity);
      const nextLength = clamp(snapped, 1, ceiling - target.start);
      if (nextLength === target.length) return {};
      return {
        blocks: state.blocks.map((b) =>
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
      };
    }),

  selectBlock: (selectedBlockId) =>
    set({
      selectedBlockId,
      selectedBlockIds: [],
      selectedNoteIds: [],
      selectedSegmentStart: null,
    }),

  selectBlocks: (ids, additive = false) =>
    set((state) => ({
      selectedBlockIds: additive
        ? [...new Set([...state.selectedBlockIds, ...ids])]
        : [...new Set(ids)],
      selectedNoteIds: [],
      selectedSegmentStart: null,
    })),

  toggleBlockSelection: (id) =>
    set((state) => ({
      selectedBlockIds: state.selectedBlockIds.includes(id)
        ? state.selectedBlockIds.filter((x) => x !== id)
        : [...state.selectedBlockIds, id],
      selectedNoteIds: [],
      selectedSegmentStart: null,
    })),

  clearBlockSelection: () => set({ selectedBlockIds: [] }),

  selectSegment: (selectedSegmentStart) => set({ selectedSegmentStart }),

  setPianoRollOpen: (pianoRollOpen) => set({ pianoRollOpen }),

  copyBlock: (id) => {
    const block = get().blocks.find((b) => b.id === id);
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

  pasteBlockAt: (step) => {
    const state = get();
    const clip = state.clipboard;
    if (!clip || clip.kind !== 'block') return null;

    get().beginTransaction();
    const desired = Math.max(0, snapStep(step, state.quantize, state.snap));
    const start = placeBlock(state.blocks, '', desired, clip.length, Infinity);
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
      blocks: [...state.blocks, block].sort((a, b) => a.start - b.start),
      selectedBlockId: block.id,
      selectedNoteIds: [],
      selectedSegmentStart: null,
      pianoRollOpen: true,
    });
    get().endTransaction();
    return block.id;
  },

  duplicateNotesToNearestGap: (noteIds) => {
    const state = get();
    const wanted = new Set(noteIds);
    const originals = state.blocks.flatMap((b) =>
      b.notes.filter((n) => wanted.has(n.id)).map((n) => ({ block: b, note: n })),
    );
    if (originals.length === 0) return;

    const minStart = Math.min(...originals.map((o) => o.block.start + o.note.start));
    const maxEnd = Math.max(...originals.map((o) => o.block.start + o.note.start + o.note.length));
    const spanLength = Math.max(1, maxEnd - minStart);

    // 空き区間の検索も小節数には縛られない（これがそもそもの要望）
    const gapStart = placeBlock(state.blocks, '', minStart, spanLength, Infinity);

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
          blocks: state.blocks.map((b) => {
            const add = additions.get(b.id);
            return add ? { ...b, notes: [...b.notes, ...add] } : b;
          }),
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
        blocks: [...state.blocks, newBlock].sort((a, b) => a.start - b.start),
        selectedBlockId: newBlock.id,
        selectedNoteIds: newBlock.notes.map((n) => n.id),
        selectedSegmentStart: null,
      }),
    );
  },

  /* --- ノート --- */
  addNote: (blockId, midi, start, length) => {
    const state = get();
    const block = state.blocks.find((b) => b.id === blockId);
    if (!block) return null;

    const pitch = clamp(Math.round(midi), PITCH_MIN, PITCH_MAX);
    const s = clamp(snapStep(start, state.quantize, state.snap), 0, block.length - 1);
    const len = clamp(snapLength(length, state.quantize, state.snap), 1, block.length - s);
    const note: NoteItem = { id: nextId('note'), midi: pitch, start: s, length: len, velocity: 0.8 };

    set({
      blocks: state.blocks.map((b) =>
        b.id === blockId ? { ...b, notes: [...b.notes, note] } : b,
      ),
      selectedNoteIds: [note.id],
    });
    return note.id;
  },

  updateNote: (blockId, noteId, patch) =>
    set((state) => {
      const block = state.blocks.find((b) => b.id === blockId);
      if (!block) return {};
      return {
        blocks: state.blocks.map((b) => {
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
        }),
      };
    }),

  removeNotes: (ids) =>
    transact(() =>
    set((state) => {
      if (ids.length === 0) return {};
      const doomed = new Set(ids);
      return {
        blocks: state.blocks.map((b) =>
          b.notes.some((n) => doomed.has(n.id))
            ? { ...b, notes: b.notes.filter((n) => !doomed.has(n.id)) }
            : b,
        ),
        selectedNoteIds: state.selectedNoteIds.filter((id) => !doomed.has(id)),
      };
    }),
    ),

  removeSelectedNotes: () => get().removeNotes(get().selectedNoteIds),

  clearNotes: (blockId) =>
    transact(() =>
    set((state) => {
      const block = state.blocks.find((b) => b.id === blockId);
      const cleared = new Set(block?.notes.map((n) => n.id) ?? []);
      return {
        blocks: state.blocks.map((b) => (b.id === blockId ? { ...b, notes: [] } : b)),
        selectedNoteIds: state.selectedNoteIds.filter((id) => !cleared.has(id)),
      };
    }),
    ),

  setSegmentNotes: (blockId, segStart, segLength, midis) =>
    transact(() =>
    set((state) => ({
      blocks: state.blocks.map((b) => {
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
      selectedNoteIds: [],
    })),
    ),

  /**
   * setSegmentNotes と同じ差し替えを、複数セグメントぶんまとめて1回の Undo で行う。
   * ボイシングの一括変更（チェーン適用）などで、呼び出し側が内容を計算済みの場合に使う。
   */
  applyBulkSegmentNotes: (updates) =>
    transact(() =>
      set((state) => {
        let blocks = state.blocks;
        for (const u of updates) {
          blocks = blocks.map((b) => {
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
        return { blocks, selectedNoteIds: [] };
      }),
    ),

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
    set((state) => ({
      selectedNoteIds: state.blocks.find((b) => b.id === blockId)?.notes.map((n) => n.id) ?? [],
    })),

  copySelectedNotes: () => {
    const state = get();
    const selected = new Set(state.selectedNoteIds);
    if (selected.size === 0) return;

    const entries: Array<{ absStart: number; midi: number; length: number; velocity: number }> = [];
    for (const b of state.blocks) {
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
    const clip = state.clipboard;
    if (!clip || clip.kind !== 'notes') return;

    get().beginTransaction();
    const anchorStep = Math.round(step);
    const additions = new Map<string, NoteItem[]>();
    const newIds: string[] = [];

    for (const entry of clip.entries) {
      const absStart = anchorStep + entry.offset;
      const target = resolveNoteTarget(state.blocks, absStart);
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
      blocks: state.blocks.map((b) => {
        const add = additions.get(b.id);
        return add ? { ...b, notes: [...b.notes, ...add] } : b;
      }),
      selectedNoteIds: newIds,
    });
    get().endTransaction();
  },

  duplicateSelectedNotes: () => {
    const state = get();
    const selected = new Set(state.selectedNoteIds);
    if (selected.size === 0) return [];

    const clones: NoteDragSnapshot[] = [];
    const blocks = state.blocks.map((b) => {
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
    set({ blocks, selectedNoteIds: clones.map((c) => c.noteId) });
    return clones;
  },

  /**
   * ノートは元のブロックの中に留まらず、移動先の絶対位置を覆う
   * どのブロックへでも跨いで移動できる（同じ小節縛りをここで外している）。
   * 移動量そのものはプロジェクト全体の範囲でのみクランプし、
   * 実際にどのブロックへ属するかは着地点ごとに resolveNoteTarget で解決する。
   */
  applyNoteDrag: (snapshots, dStep, dMidi) =>
    set((state) => {
      if (snapshots.length === 0) return {};
      const blocksById = new Map(state.blocks.map((b) => [b.id, b]));
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
      for (const b of state.blocks) {
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
        const target = resolveNoteTarget(state.blocks, absStart);
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

      return {
        blocks: state.blocks.map((b) => {
          const kept = b.notes.filter((n) => !relocated.has(n.id));
          const add = additions.get(b.id);
          if (!add && kept.length === b.notes.length) return b;
          return { ...b, notes: add ? [...kept, ...add] : kept };
        }),
      };
    }),

  applyNoteResize: (snapshots, dLength) =>
    set((state) => {
      if (snapshots.length === 0) return {};
      const lengthOf = (blockId: string) =>
        state.blocks.find((b) => b.id === blockId)?.length ?? 0;

      const delta = commonDelta(snapshots, lengthOf, dLength, (s, blockLength) => [
        1 - s.length,
        Math.max(1 - s.length, blockLength - s.start - s.length),
      ]);

      const byId = new Map(snapshots.map((s) => [s.noteId, s]));
      return {
        blocks: state.blocks.map((b) => {
          if (!b.notes.some((n) => byId.has(n.id))) return b;
          return {
            ...b,
            notes: b.notes.map((n) => {
              const snap = byId.get(n.id);
              if (!snap) return n;
              return { ...n, length: snap.length + delta };
            }),
          };
        }),
      };
    }),

  clearAll: () =>
    transact(() =>
      set({
        blocks: [],
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
        selectedSegmentStart: null,
      }),
    ),

  /**
   * ファイルから読み込んだ内容を丸ごと反映する。
   * ブロック / 小節数 / 拍子は Undo 対象（誤って読み込んでも Ctrl+Z で戻せる）。
   * それ以外の設定は他のセッターと同様に Undo 対象外。
   */
  loadProject: (file) =>
    transact(() =>
      set({
        blocks: file.blocks,
        bars: file.bars,
        rangeStart: file.rangeStart ?? 0,
        timeSignature: file.timeSignature,
        bpm: file.bpm,
        chordResolution: file.chordResolution,
        quantize: file.quantize,
        snap: file.snap,
        instrumentId: file.instrumentId,
        volumeDb: file.volumeDb,
        selectedBlockId: null,
        selectedBlockIds: [],
        selectedNoteIds: [],
        selectedSegmentStart: null,
        clipboard: null,
      }),
    ),

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
