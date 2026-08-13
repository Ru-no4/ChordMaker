/**
 * 選択できる音源の一覧。
 *
 * 内蔵シンセ（ダウンロード不要）に加えて、smplr 経由のサンプル音源を使う。
 *  - Splendid Grand Piano: Steinway のマルチサンプル（4ベロシティ）
 *  - Soundfont: GM 128音色（MusyngKite）
 *
 * サンプルは初回再生時にネットワークから取得するため、
 * 読み込み中は内蔵シンセで代替する（AudioEngine 側の責務）。
 */
import { getSoundfontNames } from 'smplr';

interface Localized {
  ja: string;
  en: string;
}

/** 内蔵シンセ。ダウンロードなしで即鳴る */
export const SYNTH_ID = 'synth';
/** Steinway のマルチサンプルピアノ */
export const SPLENDID_ID = 'splendid-grand-piano';

export type InstrumentKind = 'synth' | 'splendid' | 'soundfont';

/** kind === 'synth' の実体（Tone.Synth へそのまま渡す波形とエンベロープ） */
export interface SynthPresetOptions {
  oscillator: { type: 'sine' | 'triangle' | 'square' | 'sawtooth' };
  envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    attackCurve?: 'linear' | 'exponential' | 'sine' | 'cosine' | 'bounce' | 'ripple' | 'step';
    decayCurve?: 'linear' | 'exponential';
  };
}

export interface InstrumentPreset {
  id: string;
  label: Localized;
  kind: InstrumentKind;
  /** kind === 'soundfont' のときの音色名 */
  soundfont?: string;
  /** kind === 'synth' のときの波形・エンベロープ。省略時は DEFAULT_SYNTH_OPTIONS */
  synth?: SynthPresetOptions;
}

/** 既定の内蔵シンセ。電子ピアノ寄りの柔らかい鳴り方（attack を伸ばし decay を緩やかに）。 */
export const DEFAULT_SYNTH_OPTIONS: SynthPresetOptions = {
  oscillator: { type: 'triangle' },
  envelope: {
    attack: 0.035,
    attackCurve: 'sine',
    decay: 0.5,
    decayCurve: 'linear',
    sustain: 0.55,
    release: 1.1,
  },
};

/**
 * 8bit（チップチューン）系プリセット。素の波形をそのまま鳴らす硬い音にする。
 * 'pulse' は Tone.js の OmniOscillator 上での再現度が低い（音色が安定しない）ため、
 * ネイティブの OscillatorNode 波形だけを使う矩形波・三角波・のこぎり波の3種類にした。
 */
export const CHIP_SQUARE_ID = 'chip-square';
export const CHIP_SAWTOOTH_ID = 'chip-sawtooth';
export const CHIP_TRIANGLE_ID = 'chip-triangle';

const CHIP_ENVELOPE = { attack: 0.002, decay: 0.05, sustain: 0.85, release: 0.05 };

const CHIP_PRESETS: InstrumentPreset[] = [
  {
    id: CHIP_SQUARE_ID,
    label: { ja: '8bit スクエア', en: '8bit Square' },
    kind: 'synth',
    synth: { oscillator: { type: 'square' }, envelope: CHIP_ENVELOPE },
  },
  {
    id: CHIP_SAWTOOTH_ID,
    label: { ja: '8bit のこぎり波', en: '8bit Sawtooth' },
    kind: 'synth',
    synth: { oscillator: { type: 'sawtooth' }, envelope: CHIP_ENVELOPE },
  },
  {
    id: CHIP_TRIANGLE_ID,
    label: { ja: '8bit トライアングル', en: '8bit Triangle' },
    kind: 'synth',
    synth: { oscillator: { type: 'triangle' }, envelope: CHIP_ENVELOPE },
  },
];

/**
 * GM 128音色のうち、和音を鳴らす楽器として明らかに不要な「効果音」枠
 * （プログラム番号 121〜128, MusyngKite 名では以下）を除外する。
 * ピッチを持つ楽器音ではなく、ギターのフレットノイズや拍手・銃声などの
 * 効果音サンプルなので、コード進行ツールでは選ぶ意味がない。
 */
const EXCLUDED_SOUNDFONTS = new Set([
  'guitar_fret_noise',
  'breath_noise',
  'seashore',
  'bird_tweet',
  'telephone_ring',
  'helicopter',
  'applause',
  'gunshot',
]);

/** GM 音色名を読みやすいラベルへ（acoustic_grand_piano → Acoustic Grand Piano） */
const prettify = (name: string): string =>
  name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const soundfontPreset = (name: string): InstrumentPreset => {
  const pretty = prettify(name);
  return {
    id: name,
    label: { ja: pretty, en: pretty },
    kind: 'soundfont',
    soundfont: name,
  };
};

/** よく使うものを先に出す。ここに出さない音色は「すべての音色」から選べる。 */
const FEATURED: Array<{ group: Localized; names: string[] }> = [
  {
    group: { ja: 'ピアノ・鍵盤', en: 'Piano & Keys' },
    names: [
      'acoustic_grand_piano',
      'bright_acoustic_piano',
      'electric_grand_piano',
      'electric_piano_1',
      'electric_piano_2',
      'harpsichord',
      'celesta',
    ],
  },
  {
    group: { ja: 'オルガン', en: 'Organ' },
    names: ['drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ', 'reed_organ'],
  },
  {
    group: { ja: 'ギター', en: 'Guitar' },
    names: [
      'acoustic_guitar_nylon',
      'acoustic_guitar_steel',
      'electric_guitar_clean',
      'electric_guitar_jazz',
    ],
  },
  {
    group: { ja: '弦・パッド', en: 'Strings & Pads' },
    names: [
      'string_ensemble_1',
      'string_ensemble_2',
      'synth_strings_1',
      'choir_aahs',
      'pad_1_new_age',
      'pad_2_warm',
      'orchestral_harp',
    ],
  },
  {
    group: { ja: '音板・その他', en: 'Mallets & Other' },
    names: ['vibraphone', 'marimba', 'music_box', 'kalimba'],
  },
];

export interface InstrumentGroup {
  label: Localized;
  presets: InstrumentPreset[];
}

function buildGroups(): InstrumentGroup[] {
  const available = new Set(getSoundfontNames());
  const featuredNames = new Set<string>();

  const groups: InstrumentGroup[] = [
    {
      label: { ja: '内蔵', en: 'Built-in' },
      presets: [
        {
          id: SYNTH_ID,
          label: { ja: '合成音', en: 'Synth' },
          kind: 'synth',
          synth: DEFAULT_SYNTH_OPTIONS,
        },
        {
          id: SPLENDID_ID,
          label: { ja: 'Splendid Grand Piano', en: 'Splendid Grand Piano' },
          kind: 'splendid',
        },
      ],
    },
    { label: { ja: '8bit', en: '8bit' }, presets: CHIP_PRESETS },
  ];

  for (const { group, names } of FEATURED) {
    const presets = names
      .filter((name) => available.has(name))
      .map((name) => {
        featuredNames.add(name);
        return soundfontPreset(name);
      });
    if (presets.length > 0) groups.push({ label: group, presets });
  }

  // 残り全部。GM 128音色をひととおり試せるようにしておく（効果音枠は除く）。
  const rest = getSoundfontNames()
    .filter((name) => !featuredNames.has(name) && !EXCLUDED_SOUNDFONTS.has(name))
    .map((name) => soundfontPreset(name));
  if (rest.length > 0) {
    groups.push({ label: { ja: 'すべての音色', en: 'All instruments' }, presets: rest });
  }

  return groups;
}

export const INSTRUMENT_GROUPS: InstrumentGroup[] = buildGroups();

const BY_ID = new Map<string, InstrumentPreset>(
  INSTRUMENT_GROUPS.flatMap((g) => g.presets.map((p) => [p.id, p] as const)),
);

export const findInstrument = (id: string): InstrumentPreset | null => BY_ID.get(id) ?? null;

export const instrumentLabel = (id: string, locale: 'ja' | 'en'): string =>
  findInstrument(id)?.label[locale] ?? id;

/** 既定はダウンロードなしで鳴る内蔵シンセ */
export const DEFAULT_INSTRUMENT_ID = SYNTH_ID;
