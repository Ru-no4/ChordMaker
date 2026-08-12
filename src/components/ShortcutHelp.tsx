import { useEffect } from 'react';
import { TOOLS } from './ToolStrip';
import './ShortcutHelp.css';

interface ShortcutHelpProps {
  onClose: () => void;
}

/** ツールごとの操作。タッチとデスクトップで差が出ないことを確認できるよう並べる。 */
const TOOL_OPERATIONS: Record<string, Array<[string, string]>> = {
  draw: [
    ['空きをタップ', 'ノート配置（そのままドラッグで長さ決め）'],
    ['ノートをタップ', '選択'],
    ['ノートをドラッグ', '移動（複数選択中はまとめて。小節・ブロックを跨いでも可）'],
    ['ノート右端をドラッグ', '長さ変更'],
    ['ノートをダブルクリック', '削除（マウス）'],
    ['コードトラックの空きをタップ', 'コードブロック追加'],
    ['ブロックをドラッグ / 端をドラッグ', '移動 / 長さ変更'],
  ],
  range: [
    ['空きをドラッグ', '矩形で複数ノートを選択（小節を跨げます）'],
    ['ノートをタップ', '選択に追加 / 解除（トグル）'],
    ['選択をドラッグ', '選択全体を移動'],
    ['右端をドラッグ', '選択全体を同じ量だけリサイズ'],
    ['ノートをダブルクリック', '削除（マウス）'],
  ],
  erase: [
    ['ノートをタップ', '削除'],
    ['ノートをなぞる', 'なぞった分をまとめて削除（離した時点で確定）'],
    ['ブロックをタップ', 'コードブロックを削除'],
  ],
  pan: [
    ['ドラッグ', 'ビューをスクロール'],
    ['—', '内容には一切触れない安全モード'],
  ],
};

const DESKTOP_SHORTCUTS: Array<[string, string]> = [
  ['Shift + ドラッグ', '一時的に矩形選択（ツールを問わず）'],
  ['Shift + クリック', 'ノートを選択に追加 / 解除'],
  ['Ctrl (Cmd) + ドラッグ', '選択中のノート / コードブロックを複製して、離した位置へ配置'],
  ['中ボタンドラッグ', 'ビューをスクロール'],
  ['ダブルクリック / 右クリック', 'ノート・コードブロックを削除'],
  ['Ctrl (Cmd) + ホイール', '横方向の拡大縮小（Shift 併用で縦）'],
];

const KEYS: Array<[string, string]> = [
  ['1 / 2 / 3 / 4', 'ツール切替（鉛筆 / 範囲選択 / 消しゴム / 手）'],
  ['Ctrl + Z', '元に戻す'],
  ['Ctrl + Y · Ctrl + Shift + Z', 'やり直す'],
  ['Ctrl + C', '選択中のノート / コードブロックをコピー'],
  ['Ctrl + V', '再生ヘッドの位置を始点に貼り付け'],
  ['Space', '再生 / 一時停止'],
  ['Esc', '停止（鳴っている音も即座に切れます）'],
  ['Delete · Backspace', '選択ノートを削除（未選択ならブロックを削除）'],
  ['Ctrl + A', 'ブロック内の全ノートを選択'],
  ['P', 'ピアノロールの開閉'],
  ['? · F1', 'この一覧'],
];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
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
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label="操作一覧">
      <div className="help-backdrop" onClick={onClose} />
      <div className="help-panel">
        <header className="help-panel__head">
          <h2>操作一覧</h2>
          <p className="help-panel__lead">
            すべての操作はツールだけで到達できます。修飾キー・右クリックは
            デスクトップの近道で、無くても同じことができます。
          </p>
          <button type="button" className="help-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        <div className="help-body">
          <section className="help-section">
            <h3>ツール</h3>
            <div className="help-tools">
              {TOOLS.map((tool) => (
                <div key={tool.id} className="help-tool">
                  <div className="help-tool__head">
                    <span className="help-tool__icon">{tool.icon}</span>
                    <strong>{tool.label}</strong>
                    <kbd>{tool.shortcut}</kbd>
                  </div>
                  <table className="help-table">
                    <tbody>
                      {TOOL_OPERATIONS[tool.id].map(([op, what]) => (
                        <tr key={op}>
                          <th>{op}</th>
                          <td>{what}</td>
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
                デスクトップの近道 <span className="help-note">（タッチでは不要）</span>
              </h3>
              <table className="help-table">
                <tbody>
                  {DESKTOP_SHORTCUTS.map(([op, what]) => (
                    <tr key={op}>
                      <th>{op}</th>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="help-section">
              <h3>キーボード</h3>
              <table className="help-table">
                <tbody>
                  {KEYS.map(([key, what]) => (
                    <tr key={key}>
                      <th>
                        <kbd>{key}</kbd>
                      </th>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="help-section">
            <h3>音源</h3>
            <p className="help-text">
              コントロールバーの「音源」から切り替えられます。
              <strong>合成音</strong> はダウンロード不要で即鳴る既定の音源、
              <strong>Splendid Grand Piano</strong> は Steinway のマルチサンプル、
              その他は GM 128音色です。サンプルの読み込み中は「読込中」と表示され、
              その間も合成音で鳴り続けるので操作は止まりません。
              一度読み込んだ音源はブラウザにキャッシュされます。
            </p>
          </section>

          <section className="help-section">
            <h3>再生ヘッドの追従（FOLLOW）</h3>
            <p className="help-text">
              再生中、再生ヘッドが表示領域の中央に来たところから画面が自動で流れます。
              中央より左にいる間はスクロールせずヘッドだけが進み、
              最初から中央より右にある場合は一度中央へ寄せてから追従します。
              手動でスクロールしながら聴きたいときは <strong>FOLLOW</strong> を切ってください。
            </p>
          </section>

          <section className="help-section">
            <h3>コード解像度（Chord）</h3>
            <p className="help-text">
              コードトラックは、1つのブロックの中でもコードが変わればセルを分けて表示します。
              この設定は「どれくらいの細かさで判定するか」を決めるものです。
              <strong>1/4</strong> なら1拍ごとに判定し、同じコードが続く区間は自動でつながります。
              アルペジオは窓の中で1つのコードにまとまり、長く伸びた和音の上を走る短い音は
              経過音として判定から外れます。刻みの細かい曲では <strong>1/8</strong>、
              1小節1コードで固定したいときは <strong>小節</strong> を選んでください。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
