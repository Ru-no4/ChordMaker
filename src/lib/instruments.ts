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

export interface InstrumentPreset {
  id: string;
  label: string;
  kind: InstrumentKind;
  /** kind === 'soundfont' のときの音色名 */
  soundfont?: string;
}

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
        { id: SYNTH_ID, label: '合成音（ダウンロード不要）', kind: 'synth' },
        { id: SPLENDID_ID, label: 'Splendid Grand Piano', kind: 'splendid' },
      ],
    },
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

  // 残り全部。GM 128音色をひととおり試せるようにしておく。
  const rest = getSoundfontNames()
    .filter((name) => !featuredNames.has(name))
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
