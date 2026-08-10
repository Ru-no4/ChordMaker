/**
 * 音楽理論ユーティリティ
 *  - 音名 / MIDI 変換
 *  - コード判定（13th までの拡張コード、分数コード対応）
 *  - 単音 / 2音の候補提示
 *
 * 判定はテンプレート総当たりではなく「ルート候補ごとの構造解析」で行う。
 * これにより 13th + オルタードテンションのような組み合わせ爆発する和音も
 * 破綻せずに命名できる。
 */

/* ------------------------------------------------------------------ */
/* 音名                                                                */
/* ------------------------------------------------------------------ */

/** 表示に使う音名（ジャズ慣用に寄せてフラット優先、F# のみシャープ） */
export const PITCH_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

/** 鍵盤ラベル用（シャープ表記） */
export const PITCH_NAMES_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** MIDI 60 = C4 とする */
export const MIDDLE_C = 60;

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;
export const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1;

/**
 * シャープ系で綴るルート（G / D / A / E / B / F#）。
 * A メジャーの第3音は Db ではなく C# なので、分数コードのベース表記は
 * ルートがどちら側の調域にあるかで綴りを切り替える。
 */
const SHARP_SPELLING_ROOTS = new Set([7, 2, 9, 4, 11, 6]);

export const spellsWithSharps = (rootPc: number): boolean =>
  SHARP_SPELLING_ROOTS.has(pitchClass(rootPc));

export const pcName = (pc: number, preferSharp = false): string =>
  (preferSharp ? PITCH_NAMES_SHARP : PITCH_NAMES)[pitchClass(pc)];

export const midiToName = (midi: number): string =>
  `${PITCH_NAMES_SHARP[pitchClass(midi)]}${octaveOf(midi)}`;

export const isBlackKey = (midi: number): boolean =>
  [1, 3, 6, 8, 10].includes(pitchClass(midi));

/* ------------------------------------------------------------------ */
/* 型                                                                  */
/* ------------------------------------------------------------------ */

/** コードタイプ別の色分けカテゴリ */
export type ChordCategory =
  | 'major'
  | 'minor'
  | 'dominant'
  | 'diminished'
  | 'suspended'
  | 'tension';

export interface ChordAnalysis {
  /** 表示用シンボル（例: "C13(#11)/E"） */
  symbol: string;
  /** ルートのピッチクラス */
  root: number;
  /** 分数コードのベース（ルートと異なる場合のみ非 null） */
  slashBass: number | null;
  /** サフィックス（例: "m7b5"） */
  quality: string;
  category: ChordCategory;
  /** 構成音のディグリー表記（例: ["R","3","5","b7","9"]） */
  degrees: string[];
  score: number;
}

export interface ChordCandidate {
  symbol: string;
  root: number;
  quality: string;
  category: ChordCategory;
  /** テンプレートの構成音（ピッチクラス） */
  pitches: number[];
  /** 入力に含まれていない＝補完される音 */
  missing: number[];
}

export type DetectionKind = 'empty' | 'candidates' | 'chord';

export interface DetectionResult {
  kind: DetectionKind;
  /** kind === 'chord' のときの第一候補 */
  chord: ChordAnalysis | null;
  /** 第二候補以降（別解釈） */
  alternatives: ChordAnalysis[];
  /** kind === 'candidates' のときの候補和音 */
  candidates: ChordCandidate[];
  /** 2音のときの音程名（例: "完全5度"） */
  intervalName: string | null;
  /** 入力された構成音（MIDI 昇順） */
  notes: number[];
}

/* ------------------------------------------------------------------ */
/* 音程名（2音のとき用）                                                */
/* ------------------------------------------------------------------ */

const INTERVAL_NAMES = [
  '完全1度（ユニゾン）',
  '短2度',
  '長2度',
  '短3度',
  '長3度',
  '完全4度',
  '増4度（三全音）',
  '完全5度',
  '短6度',
  '長6度',
  '短7度',
  '長7度',
];

export function intervalName(a: number, b: number): string {
  const semis = Math.abs(b - a);
  const base = INTERVAL_NAMES[semis % 12];
  const octaves = Math.floor(semis / 12);
  return octaves > 0 ? `${base} + ${octaves}oct` : base;
}

/* ------------------------------------------------------------------ */
/* ルート候補ごとの構造解析                                             */
/* ------------------------------------------------------------------ */

type ThirdKind = 'maj' | 'min' | 'sus4' | 'sus2' | 'none';
type FifthKind = 'perfect' | 'flat' | 'sharp' | 'none';
type SeventhKind = 'maj7' | 'b7' | 'sixth' | 'none';

const ALTERED = new Set(['b9', '#9', '#11', 'b13', 'b5', '#5']);

interface RootAnalysis {
  quality: string;
  category: ChordCategory;
  degrees: string[];
  score: number;
}

/**
 * ルートを固定したうえで、インターバル集合を
 * 3rd / 5th / 7th / テンション に分解して命名する。
 */
function analyzeAtRoot(intervals: Set<number>): RootAnalysis | null {
  if (!intervals.has(0)) return null;

  const rest = new Set(intervals);
  rest.delete(0);

  let score = 10;
  let penalty = 0;
  const degrees: string[] = ['R'];

  /* --- 3rd -------------------------------------------------------- */
  let third: ThirdKind = 'none';
  if (rest.has(4)) {
    third = 'maj';
    rest.delete(4);
    score += 6;
    degrees.push('3');
  } else if (rest.has(3)) {
    third = 'min';
    rest.delete(3);
    score += 6;
    degrees.push('b3');
  } else if (rest.has(5)) {
    third = 'sus4';
    rest.delete(5);
    score += 4;
    degrees.push('4');
  } else if (rest.has(2)) {
    third = 'sus2';
    rest.delete(2);
    score += 4;
    degrees.push('2');
  }

  /* --- 5th -------------------------------------------------------- */
  // 完全5度があれば 6 は #11、8 は b13 として後段のテンション扱いになる。
  let fifth: FifthKind = 'none';
  if (rest.has(7)) {
    fifth = 'perfect';
    rest.delete(7);
    score += 3;
    degrees.push('5');
  } else if (rest.has(6)) {
    fifth = 'flat';
    rest.delete(6);
    score += 2;
    degrees.push('b5');
  } else if (rest.has(8)) {
    fifth = 'sharp';
    rest.delete(8);
    score += 2;
    degrees.push('#5');
  }

  /* --- 7th -------------------------------------------------------- */
  let seventh: SeventhKind = 'none';
  if (rest.has(11)) {
    seventh = 'maj7';
    rest.delete(11);
    score += 4;
    degrees.push('M7');
  } else if (rest.has(10)) {
    seventh = 'b7';
    rest.delete(10);
    score += 4;
    degrees.push('b7');
  } else if (rest.has(9)) {
    seventh = 'sixth';
    rest.delete(9);
    score += 2;
    degrees.push(third === 'min' && fifth === 'flat' ? 'bb7' : '6');
  }

  /* --- テンション --------------------------------------------------- */
  const alterations: string[] = [];
  let nat9 = false;
  let nat11 = false;
  let nat13 = false;

  for (const iv of [...rest].sort((a, b) => a - b)) {
    switch (iv) {
      case 1: // b9
        alterations.push('b9');
        if (seventh === 'b7') score += 1;
        else penalty += 3;
        degrees.push('b9');
        break;
      case 2: // 9th
        nat9 = true;
        score += 1;
        degrees.push('9');
        break;
      case 3: // #9（長3度と共存するときのみ自然）
        if (third === 'maj' && seventh === 'b7') {
          alterations.push('#9');
          score += 1;
        } else {
          alterations.push('#9');
          penalty += 4;
        }
        degrees.push('#9');
        break;
      case 4: // 長3度と短3度の同居 → 別ルート解釈のほうが妥当
        penalty += 5;
        degrees.push('M3');
        break;
      case 5: // 11th
        if (third === 'maj') {
          // 長3度と完全11度は強い衝突
          alterations.push('add11');
          penalty += 3;
        } else {
          nat11 = true;
          score += 1;
        }
        degrees.push('11');
        break;
      case 6: // #11
        alterations.push('#11');
        if (seventh === 'none') penalty += 1;
        else score += 1;
        degrees.push('#11');
        break;
      case 8: // b13（完全5度あり） / #5
        if (fifth === 'perfect') {
          alterations.push('b13');
          if (seventh === 'b7') score += 1;
          else penalty += 2;
          degrees.push('b13');
        } else {
          alterations.push('#5');
          degrees.push('#5');
        }
        break;
      case 9: // 13th
        if (seventh === 'b7' || seventh === 'maj7') {
          nat13 = true;
          score += 1;
          degrees.push('13');
        } else {
          alterations.push('add13');
          penalty += 2;
          degrees.push('13');
        }
        break;
      case 10: // 7th の二重登場
      case 11:
        penalty += 5;
        degrees.push(iv === 10 ? 'b7' : 'M7');
        break;
      case 7:
        penalty += 5;
        degrees.push('5');
        break;
      default:
        penalty += 3;
        break;
    }
  }

  /* --- 命名 -------------------------------------------------------- */
  // 自然テンションの最上位が基本数字になる（13 は 9/11 の省略を許容）
  const topNatural = nat13 ? '13' : nat11 ? '11' : nat9 ? '9' : null;

  let quality = '';
  const mods: string[] = [];
  let fifthConsumed = false;

  const isDim = third === 'min' && fifth === 'flat';

  if (isDim && seventh === 'sixth') {
    quality = 'dim7';
    fifthConsumed = true;
  } else if (isDim && seventh === 'none') {
    quality = 'dim';
    fifthConsumed = true;
  } else if (third === 'maj' && fifth === 'sharp' && seventh === 'none') {
    quality = 'aug';
    fifthConsumed = true;
  } else {
    switch (third) {
      case 'maj':
        if (seventh === 'maj7') quality = `maj${topNatural ?? '7'}`;
        else if (seventh === 'b7') quality = topNatural ?? '7';
        else if (seventh === 'sixth') quality = nat9 ? '6/9' : '6';
        else quality = nat9 ? 'add9' : '';
        break;
      case 'min':
        if (seventh === 'maj7') quality = `mMaj${topNatural ?? '7'}`;
        else if (seventh === 'b7') quality = `m${topNatural ?? '7'}`;
        else if (seventh === 'sixth') quality = nat9 ? 'm6/9' : 'm6';
        else quality = nat9 ? 'm(add9)' : 'm';
        break;
      case 'sus4':
        if (seventh === 'maj7') quality = `maj${topNatural ?? '7'}sus4`;
        else if (seventh === 'b7') quality = `${topNatural ?? '7'}sus4`;
        else if (seventh === 'sixth') quality = '6sus4';
        else quality = 'sus4';
        break;
      case 'sus2':
        if (seventh === 'b7') quality = `${topNatural ?? '7'}sus2`;
        else if (seventh === 'maj7') quality = `maj${topNatural ?? '7'}sus2`;
        else quality = 'sus2';
        break;
      case 'none':
        if (seventh === 'b7') quality = `${topNatural ?? '7'}(no3)`;
        else if (seventh === 'maj7') quality = `maj${topNatural ?? '7'}(no3)`;
        else if (seventh === 'sixth') quality = '6(no3)';
        else if (fifth === 'perfect') quality = '5';
        else quality = '(no3)';
        break;
    }
  }

  // 7th を持たない和音では基本数字にテンションを載せられないので add 表記にする
  if (seventh === 'none') {
    if (nat9 && !quality.includes('9')) mods.push('add9');
    if (nat11) mods.push('add11');
  }

  if (!fifthConsumed) {
    if (fifth === 'flat') mods.push('b5');
    else if (fifth === 'sharp' && quality !== 'aug') mods.push('#5');
  }
  mods.push(...alterations);

  // m7b5 は括弧なしの慣用表記を優先
  if (quality === 'm7' && mods.length === 1 && mods[0] === 'b5') {
    quality = 'm7b5';
  } else if (mods.length > 0) {
    quality += `(${mods.join(',')})`;
  }

  /* --- カテゴリ ----------------------------------------------------- */
  // b5 / #5 が「オルタード」かどうかは 3rd との組み合わせで決まる。
  // 短3度 + 減5度は dim ファミリーであってテンションではない。
  const alteredCount =
    alterations.filter((a) => ALTERED.has(a)).length +
    (!fifthConsumed && fifth === 'sharp' ? 1 : 0) +
    (!fifthConsumed && fifth === 'flat' && third !== 'min' ? 1 : 0);
  const naturalTensionCount = [nat9, nat11, nat13].filter(Boolean).length;

  let category: ChordCategory;
  if (alteredCount > 0 || quality.startsWith('aug') || naturalTensionCount >= 3) {
    category = 'tension';
  } else if (isDim) {
    category = 'diminished';
  } else if (third === 'sus4' || third === 'sus2') {
    category = 'suspended';
  } else if (third === 'maj' && seventh === 'b7') {
    category = 'dominant';
  } else if (third === 'min') {
    category = 'minor';
  } else {
    category = 'major';
  }

  /* --- 構造の明快さ / 無理さをスコアに反映 --------------------------- */
  // 3度と完全5度が揃った「核」を持つ解釈は、転回形の読み替えより信頼できる
  if ((third === 'maj' || third === 'min') && fifth === 'perfect') score += 1;

  // 3度も5度も無い解釈は情報量が乏しい
  if (third === 'none' && fifth === 'none') penalty += 4;
  // 短3度 + 増5度はほぼ使われない（転回形の誤読であることが多い）
  if (third === 'min' && fifth === 'sharp') penalty += 6;
  // sus + 6th も稀
  if ((third === 'sus4' || third === 'sus2') && seventh === 'sixth') penalty += 3;
  // 小さな和音で5度が無いのは不自然（テンション和音の省略5度は許容）
  if (fifth === 'none' && intervals.size <= 4) penalty += 2;

  return { quality, category, degrees, score: score - penalty };
}

/* ------------------------------------------------------------------ */
/* 候補提示（単音 / 2音）                                               */
/* ------------------------------------------------------------------ */

interface CandidateTemplate {
  quality: string;
  intervals: number[];
  category: ChordCategory;
  priority: number;
}

const CANDIDATE_TEMPLATES: CandidateTemplate[] = [
  { quality: '', intervals: [0, 4, 7], category: 'major', priority: 0 },
  { quality: 'm', intervals: [0, 3, 7], category: 'minor', priority: 0 },
  { quality: '7', intervals: [0, 4, 7, 10], category: 'dominant', priority: 1 },
  { quality: 'maj7', intervals: [0, 4, 7, 11], category: 'major', priority: 1 },
  { quality: 'm7', intervals: [0, 3, 7, 10], category: 'minor', priority: 1 },
  { quality: 'sus4', intervals: [0, 5, 7], category: 'suspended', priority: 2 },
  { quality: 'sus2', intervals: [0, 2, 7], category: 'suspended', priority: 2 },
  { quality: '6', intervals: [0, 4, 7, 9], category: 'major', priority: 2 },
  { quality: 'm6', intervals: [0, 3, 7, 9], category: 'minor', priority: 2 },
  { quality: 'add9', intervals: [0, 2, 4, 7], category: 'major', priority: 2 },
  { quality: 'dim', intervals: [0, 3, 6], category: 'diminished', priority: 2 },
  { quality: 'm7b5', intervals: [0, 3, 6, 10], category: 'diminished', priority: 2 },
  { quality: 'dim7', intervals: [0, 3, 6, 9], category: 'diminished', priority: 3 },
  { quality: 'aug', intervals: [0, 4, 8], category: 'tension', priority: 3 },
  { quality: 'mMaj7', intervals: [0, 3, 7, 11], category: 'minor', priority: 3 },
  { quality: '7sus4', intervals: [0, 5, 7, 10], category: 'suspended', priority: 3 },
  { quality: '9', intervals: [0, 2, 4, 7, 10], category: 'dominant', priority: 4 },
  { quality: 'maj9', intervals: [0, 2, 4, 7, 11], category: 'major', priority: 4 },
  { quality: 'm9', intervals: [0, 2, 3, 7, 10], category: 'minor', priority: 4 },
  // パワーコードは「ちょうど2音」のときだけ上位に来るよう補完コストを高めに扱う
  { quality: '5', intervals: [0, 7], category: 'major', priority: 5 },
];

const MAX_CANDIDATES = 12;
/** ベース音をルートとする候補で埋め尽くさないための上限 */
const MAX_ROOTED_CANDIDATES = 8;

function buildCandidates(pcs: number[], bassPc: number): ChordCandidate[] {
  const given = new Set(pcs);
  const out: ChordCandidate[] = [];

  for (let root = 0; root < 12; root++) {
    for (const tpl of CANDIDATE_TEMPLATES) {
      const pitches = tpl.intervals.map((i) => (root + i) % 12);
      const set = new Set(pitches);
      // 入力音がすべてテンプレートに含まれることが条件
      if (![...given].every((pc) => set.has(pc))) continue;

      out.push({
        symbol: `${pcName(root)}${tpl.quality}`,
        root,
        quality: tpl.quality,
        category: tpl.category,
        pitches,
        missing: pitches.filter((pc) => !given.has(pc)),
      });
    }
  }

  const rank = (c: ChordCandidate): number => {
    const priority = CANDIDATE_TEMPLATES.find((t) => t.quality === c.quality)?.priority ?? 9;
    // 補完なしで成立する解釈（完全5度に対する C5 など）は最優先
    if (c.missing.length === 0) return priority * 0.1;
    // それ以外は「補完する音の少なさ」と「コードの一般性」で並べる
    return priority + c.missing.length * 1.5;
  };

  const byRank = (a: ChordCandidate, b: ChordCandidate): number => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return (
      CANDIDATE_TEMPLATES.findIndex((t) => t.quality === a.quality) -
      CANDIDATE_TEMPLATES.findIndex((t) => t.quality === b.quality)
    );
  };

  // ベース音をルートとする解釈を優先しつつ、
  // 「その音が3rd/5thになる別ルートの和音」も学習用に残す
  const rooted = out.filter((c) => c.root === bassPc).sort(byRank);
  const others = out.filter((c) => c.root !== bassPc).sort(byRank);
  const head = rooted.slice(0, MAX_ROOTED_CANDIDATES);

  return [...head, ...others.slice(0, MAX_CANDIDATES - head.length)];
}

/* ------------------------------------------------------------------ */
/* エントリポイント                                                     */
/* ------------------------------------------------------------------ */

/** 第一候補からこのスコア差までを「別解釈」として提示する */
const ALTERNATIVE_SCORE_WINDOW = 6;

const EMPTY_RESULT: DetectionResult = {
  kind: 'empty',
  chord: null,
  alternatives: [],
  candidates: [],
  intervalName: null,
  notes: [],
};

/**
 * MIDI ノート番号の集合からコードを判定する。
 *  - 3音以上: コード名を確定（複数解釈は alternatives へ）
 *  - 1〜2音 : 候補提示モード
 */
export function detectChord(midiNotes: number[]): DetectionResult {
  const notes = [...new Set(midiNotes)].sort((a, b) => a - b);
  if (notes.length === 0) return EMPTY_RESULT;

  const pcs = [...new Set(notes.map(pitchClass))];
  const bassPc = pitchClass(notes[0]);

  if (notes.length <= 2 || pcs.length <= 2) {
    return {
      kind: 'candidates',
      chord: null,
      alternatives: [],
      candidates: buildCandidates(pcs, bassPc),
      intervalName: notes.length === 2 ? intervalName(notes[0], notes[1]) : null,
      notes,
    };
  }

  const analyses: ChordAnalysis[] = [];

  /**
   * 解釈1: 全構成音を1つの和音として解析する。
   * ルートがベースと違えば転回形＝分数コードとして表示する。
   */
  for (let root = 0; root < 12; root++) {
    const intervals = new Set(pcs.map((pc) => (pc - root + 12) % 12));
    const res = analyzeAtRoot(intervals);
    if (!res) continue;

    const isSlash = root !== bassPc;
    const sharp = spellsWithSharps(root);
    analyses.push({
      symbol: `${pcName(root, sharp)}${res.quality}${isSlash ? `/${pcName(bassPc, sharp)}` : ''}`,
      root,
      slashBass: isSlash ? bassPc : null,
      quality: res.quality,
      category: res.category,
      degrees: res.degrees,
      // ルート＝ベースの解釈を優先
      score: res.score + (isSlash ? 0 : 3),
    });
  }

  /**
   * 解釈2: ベース音を上部構造から切り離した本来の分数コード（F/G, C/D など）。
   * ベースが上部和音の構成音なら残りが2音になり自然に低スコアとなるため、
   * 転回形（C/E, C/G）を誤ってこちらで拾うことはない。
   */
  if (pcs.length >= 4) {
    const upper = pcs.filter((pc) => pc !== bassPc);
    for (let root = 0; root < 12; root++) {
      if (root === bassPc) continue;
      const intervals = new Set(upper.map((pc) => (pc - root + 12) % 12));
      const res = analyzeAtRoot(intervals);
      if (!res) continue;

      const sharp = spellsWithSharps(root);
      analyses.push({
        symbol: `${pcName(root, sharp)}${res.quality}/${pcName(bassPc, sharp)}`,
        root,
        slashBass: bassPc,
        quality: res.quality,
        category: res.category,
        degrees: [...res.degrees, `bass:${pcName(bassPc, sharp)}`],
        // 上部構造が明快なときだけ勝てる程度のボーナス
        score: res.score + 2,
      });
    }
  }

  if (analyses.length === 0) {
    // ルート候補が見つからない（理論上ほぼ起きない）
    return {
      kind: 'candidates',
      chord: null,
      alternatives: [],
      candidates: buildCandidates(pcs, bassPc),
      intervalName: null,
      notes,
    };
  }

  analyses.sort((a, b) => b.score - a.score);

  // 同じ表記が複数の経路から出ることがあるので重複を除く
  const seen = new Set<string>();
  const unique = analyses.filter((a) => {
    if (seen.has(a.symbol)) return false;
    seen.add(a.symbol);
    return true;
  });

  // 最有力から離れすぎた解釈はノイズなので出さない
  const best = unique[0].score;
  const alternatives = unique
    .slice(1)
    .filter((a) => a.score >= best - ALTERNATIVE_SCORE_WINDOW)
    .slice(0, 3);

  return {
    kind: 'chord',
    chord: unique[0],
    alternatives,
    candidates: [],
    intervalName: null,
    notes,
  };
}

/** 候補から実際の和音（MIDI）を組み立てる。ベース音の高さを基準に配置。 */
export function candidateToMidi(candidate: ChordCandidate, baseMidi = 48): number[] {
  const rootMidi = baseMidi + ((candidate.root - pitchClass(baseMidi) + 12) % 12);
  const rootIv = candidate.pitches.map((pc) => (pc - candidate.root + 12) % 12);
  return rootIv.sort((a, b) => a - b).map((iv) => rootMidi + iv);
}
