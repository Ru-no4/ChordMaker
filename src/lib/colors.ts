import type { ChordCategory } from './theory';

export interface CategoryStyle {
  label: string;
  /** ブロック / ノートの基調色 */
  base: string;
  /** 明るいアクセント（枠線・テキスト） */
  accent: string;
}

/** コードタイプ別の色分け定義 */
export const CATEGORY_STYLES: Record<ChordCategory, CategoryStyle> = {
  major: { label: 'Major', base: '#2f6fd0', accent: '#7db4ff' },
  minor: { label: 'Minor', base: '#6b4bd6', accent: '#b79bff' },
  dominant: { label: 'Dominant', base: '#c96a1e', accent: '#ffb367' },
  diminished: { label: 'Diminished', base: '#c03352', accent: '#ff859c' },
  suspended: { label: 'Suspended', base: '#1e8f74', accent: '#5fe0bd' },
  tension: { label: 'Tension', base: '#b39018', accent: '#ffdb63' },
};

/** 未判定（構成音なし / 候補提示中）のブロック色 */
export const NEUTRAL_STYLE: CategoryStyle = {
  label: '—',
  base: '#40464f',
  accent: '#8b939f',
};

export const styleFor = (category: ChordCategory | null | undefined): CategoryStyle =>
  category ? CATEGORY_STYLES[category] : NEUTRAL_STYLE;

export const CATEGORY_ORDER: ChordCategory[] = [
  'major',
  'minor',
  'dominant',
  'diminished',
  'suspended',
  'tension',
];
