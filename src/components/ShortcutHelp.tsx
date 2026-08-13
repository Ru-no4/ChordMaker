import { useEffect } from 'react';
import { TOOLS } from './ToolStrip';
import { useT, type Localized } from '../i18n/useT';
import { strings } from '../i18n/strings';
import { BreakLines } from '../i18n/BreakLines';
import './ShortcutHelp.css';

interface ShortcutHelpProps {
  onClose: () => void;
}

/** ツールごとの操作。タッチとデスクトップで差が出ないことを確認できるよう並べる。 */
const TOOL_OPERATIONS: Record<string, Array<[Localized, Localized]>> = {
  draw: [
    [
      { ja: '空きをタップ', en: 'Tap empty space' },
      { ja: 'ノート配置（そのままドラッグで長さ決め）', en: 'Place a note (drag right after to set its length)' },
    ],
    [
      { ja: 'ノートをタップ', en: 'Tap a note' },
      { ja: '選択', en: 'Select it' },
    ],
    [
      { ja: 'ノートをドラッグ', en: 'Drag a note' },
      { ja: '移動（複数選択中はまとめて。小節・ブロックを跨いでも可）', en: 'Move it (moves the whole selection together; can cross bars and blocks)' },
    ],
    [
      { ja: 'ノート右端をドラッグ', en: 'Drag the right edge of a note' },
      { ja: '長さ変更', en: 'Resize it' },
    ],
    [
      { ja: 'ノートをダブルクリック', en: 'Double-click a note' },
      { ja: '削除（マウス）', en: 'Delete it (mouse)' },
    ],
    [
      { ja: 'コードトラックの空きをタップ', en: 'Tap empty space on the chord track' },
      { ja: 'コードブロック追加', en: 'Add a chord block' },
    ],
    [
      { ja: 'ブロックをドラッグ / 端をドラッグ', en: 'Drag a block / drag its edge' },
      { ja: '移動 / 長さ変更', en: 'Move it / resize it' },
    ],
  ],
  range: [
    [
      { ja: '空きをドラッグ', en: 'Drag empty space' },
      { ja: '矩形で複数ノートを選択（小節を跨げます）', en: 'Box-select multiple notes (can span bars)' },
    ],
    [
      { ja: 'ノートをタップ', en: 'Tap a note' },
      { ja: '選択に追加 / 解除（トグル）', en: 'Add to / remove from the selection (toggle)' },
    ],
    [
      { ja: '選択をドラッグ', en: 'Drag the selection' },
      { ja: '選択全体を移動', en: 'Move the whole selection' },
    ],
    [
      { ja: '右端をドラッグ', en: 'Drag the right edge' },
      { ja: '選択全体を同じ量だけリサイズ', en: 'Resize the whole selection by the same amount' },
    ],
    [
      { ja: 'ノートをダブルクリック', en: 'Double-click a note' },
      { ja: '削除（マウス）', en: 'Delete it (mouse)' },
    ],
    [
      { ja: 'コードトラックの空きをドラッグ', en: 'Drag empty space on the chord track' },
      { ja: '複数のコードブロックを選択', en: 'Select multiple chord blocks' },
    ],
  ],
  erase: [
    [
      { ja: 'ノートをタップ', en: 'Tap a note' },
      { ja: '削除', en: 'Delete it' },
    ],
    [
      { ja: 'ノートをなぞる', en: 'Drag over notes' },
      { ja: 'なぞった分をまとめて削除（離した時点で確定）', en: 'Delete everything you passed over (confirmed on release)' },
    ],
    [
      { ja: 'ブロックをタップ', en: 'Tap a block' },
      { ja: 'コードブロックを削除', en: 'Delete the chord block' },
    ],
  ],
  pan: [
    [
      { ja: 'ドラッグ', en: 'Drag' },
      { ja: 'ビューをスクロール', en: 'Scroll the view' },
    ],
    [
      { ja: '—', en: '—' },
      { ja: '内容には触れません', en: 'Never touches the content' },
    ],
  ],
};

const DESKTOP_SHORTCUTS: Array<[Localized, Localized]> = [
  [
    { ja: 'Shift + ドラッグ', en: 'Shift + drag' },
    { ja: '一時的に矩形選択（ツールを問わず）', en: 'Box-select temporarily (regardless of the active tool)' },
  ],
  [
    { ja: 'Shift + クリック', en: 'Shift + click' },
    { ja: 'ノート / コードブロックを選択に追加・解除（複数選択）', en: 'Add or remove a note / chord block from the selection (multi-select)' },
  ],
  [
    { ja: 'Ctrl (Cmd) + ドラッグ', en: 'Ctrl (Cmd) + drag' },
    { ja: 'ノート / コード（1小節内の1つだけでも可）を複製し、どこへでも移動', en: 'Duplicate a note / chord (even just one within a bar) and move it anywhere' },
  ],
  [
    { ja: 'Ctrl (Cmd) + クリック（離すだけ）', en: 'Ctrl (Cmd) + click (release only)' },
    { ja: '複製を最も近い空き小節へ自動配置', en: 'Auto-places a duplicate in the nearest empty bar' },
  ],
  [
    { ja: '中ボタンドラッグ', en: 'Middle-button drag' },
    { ja: 'ビューをスクロール', en: 'Scroll the view' },
  ],
  [
    { ja: 'ダブルクリック / 右クリック', en: 'Double-click / right-click' },
    { ja: 'ノート・コードブロックを削除', en: 'Delete a note or chord block' },
  ],
  [
    { ja: 'Ctrl (Cmd) + ホイール', en: 'Ctrl (Cmd) + wheel' },
    { ja: '横方向の拡大縮小（Shift 併用で縦）', en: 'Zoom horizontally (add Shift to zoom vertically)' },
  ],
];

const KEYS: Array<[string, Localized]> = [
  ['1 / 2 / 3 / 4', { ja: 'ツール切替（鉛筆 / 範囲選択 / 消しゴム / 手）', en: 'Switch tools (Pencil / Range select / Eraser / Hand)' }],
  ['Ctrl + Z', { ja: '元に戻す', en: 'Undo' }],
  ['Ctrl + Y · Ctrl + Shift + Z', { ja: 'やり直す', en: 'Redo' }],
  ['Ctrl + C', { ja: '選択中のノート / コードブロックをコピー', en: 'Copy the selected notes / chord block' }],
  ['Ctrl + V', { ja: '再生ヘッドの位置を始点に貼り付け', en: 'Paste starting at the playhead' }],
  ['Space', { ja: '再生 / 一時停止', en: 'Play / pause' }],
  ['Esc', { ja: '停止（鳴っている音も即座に切れます）', en: 'Stop (also cuts any sounding notes immediately)' }],
  ['Delete · Backspace', { ja: '選択ノートを削除（未選択ならブロックを削除）', en: 'Delete the selected notes (or the block if nothing is selected)' }],
  ['Ctrl + A', { ja: 'ブロック内の全ノートを選択', en: 'Select every note in the block' }],
  ['P', { ja: 'ピアノロールの開閉', en: 'Open/close the piano roll' }],
  ['? · F1', { ja: 'この一覧', en: 'This guide' }],
];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const { t, locale } = useT();
  const sh = strings.shortcutHelp;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label={t(sh.dialogAria)}>
      <div className="help-backdrop" onClick={onClose} />
      <div className="help-panel">
        <header className="help-panel__head">
          <h2>{t(sh.title)}</h2>
          <p className="help-panel__lead">
            <BreakLines lines={sh.lead[locale]} />
          </p>
          <button type="button" className="help-close" onClick={onClose} aria-label={t(sh.close)}>
            ×
          </button>
        </header>

        <div className="help-body">
          <section className="help-section">
            <h3>{t(sh.toolsHeading)}</h3>
            <div className="help-tools">
              {TOOLS.map((tool) => (
                <div key={tool.id} className="help-tool">
                  <div className="help-tool__head">
                    <span className="help-tool__icon">{tool.icon}</span>
                    <strong>{t(tool.label)}</strong>
                    <kbd>{tool.shortcut}</kbd>
                  </div>
                  <table className="help-table">
                    <tbody>
                      {TOOL_OPERATIONS[tool.id].map(([op, what]) => (
                        <tr key={op.ja}>
                          <th>{t(op)}</th>
                          <td>{t(what)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          <div className="help-columns">
            <section className="help-section">
              <h3>
                {t(sh.desktopShortcutsHeading)} <span className="help-note">{t(sh.desktopShortcutsNote)}</span>
              </h3>
              <table className="help-table">
                <tbody>
                  {DESKTOP_SHORTCUTS.map(([op, what]) => (
                    <tr key={op.ja}>
                      <th>{t(op)}</th>
                      <td>{t(what)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="help-section">
              <h3>{t(sh.keyboardHeading)}</h3>
              <table className="help-table">
                <tbody>
                  {KEYS.map(([key, what]) => (
                    <tr key={key}>
                      <th>
                        <kbd>{key}</kbd>
                      </th>
                      <td>{t(what)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="help-section">
            <h3>{t(sh.instrumentsHeading)}</h3>
            <p className="help-text">
              <BreakLines lines={sh.instrumentsText[locale]} />
            </p>
          </section>

          <section className="help-section">
            <h3>{t(sh.followHeading)}</h3>
            <p className="help-text">
              <BreakLines lines={sh.followText[locale]} />
            </p>
          </section>

          <section className="help-section">
            <h3>{t(sh.chordResolutionHeading)}</h3>
            <p className="help-text">
              <BreakLines lines={sh.chordResolutionText[locale]} />
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
