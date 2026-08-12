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
  label: string;
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
    label: '8bit スクエア',
    kind: 'synth',
    synth: { oscillator: { type: 'square' }, envelope: CHIP_ENVELOPE },
  },
  {
    id: CHIP_SAWTOOTH_ID,
    label: '8bit のこぎり波',
    kind: 'synth',
    synth: { oscillator: { type: 'sawtooth' }, envelope: CHIP_ENVELOPE },
  },
  {
    id: CHIP_TRIANGLE_ID,
    label: '8bit トライアングル',
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

const soundfontPreset = (name: string, label?: string): InstrumentPreset => ({
  id: name,
  label: label ?? prettify(name),
  kind: 'soundfont',
  soundfont: name,
});

/** よく使うものを先に出す。ここに出さない音色は「すべての音色」から選べる。 */
const FEATURED: Array<{ group: string; names: string[] }> = [
  {
    group: 'ピアノ・鍵盤',
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
    group: 'オルガン',
    names: ['drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ', 'reed_organ'],
  },
  {
    group: 'ギター',
    names: [
      'acoustic_guitar_nylon',
      'acoustic_guitar_steel',
      'electric_guitar_clean',
      'electric_guitar_jazz',
    ],
  },
  {
    group: '弦・パッド',
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
    group: '音板・その他',
    names: ['vibraphone', 'marimba', 'music_box', 'kalimba'],
  },
];

export interface InstrumentGroup {
  label: string;
  presets: InstrumentPreset[];
}

function buildGroups(): InstrumentGroup[] {
  const available = new Set(getSoundfontNames());
  const featuredNames = new Set<string>();

  const groups: InstrumentGroup[] = [
    {
      label: '内蔵',
      presets: [
        { id: SYNTH_ID, label: '合成音', kind: 'synth', synth: DEFAULT_SYNTH_OPTIONS },
        { id: SPLENDID_ID, label: 'Splendid Grand Piano', kind: 'splendid' },
      ],
    },
    { label: '8bit', presets: CHIP_PRESETS },
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
  if (rest.length > 0) groups.push({ label: 'すべての音色', presets: rest });

  return groups;
}

export const INSTRUMENT_GROUPS: InstrumentGroup[] = buildGroups();

const BY_ID = new Map<string, InstrumentPreset>(
  INSTRUMENT_GROUPS.flatMap((g) => g.presets.map((p) => [p.id, p] as const)),
);

export const findInstrument = (id: string): InstrumentPreset | null => BY_ID.get(id) ?? null;

export const instrumentLabel = (id: string): string => findInstrument(id)?.label ?? id;

/** 既定はダウンロードなしで鳴る内蔵シンセ */
export const DEFAULT_INSTRUMENT_ID = SYNTH_ID;
