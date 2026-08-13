import { useProjectStore, type EditorTool } from '../store/useProjectStore';
import { useT, type Localized } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ToolStrip.css';

interface ToolDef {
  id: EditorTool;
  label: Localized;
  shortcut: string;
  hint: Localized;
  icon: JSX.Element;
}

/** すべての操作がツールだけで到達できるように4つ揃える（タッチ対応の要） */
export const TOOLS: ToolDef[] = [
  {
    id: 'draw',
    label: { ja: '鉛筆', en: 'Pencil' },
    shortcut: '1',
    hint: { ja: '配置・選択・移動・長さ変更', en: 'Place, select, move, resize' },
    icon: (
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
        <path
          d="M3 15h3l8.1-8.1a1.6 1.6 0 0 0 0-2.3l-.7-.7a1.6 1.6 0 0 0-2.3 0L3 12z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M10.6 4.6l2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'range',
    label: { ja: '範囲選択', en: 'Range select' },
    shortcut: '2',
    hint: { ja: '複数ノートの選択・一括移動・一括リサイズ', en: 'Select multiple notes, move or resize together' },
    icon: (
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
        <rect
          x="2.5"
          y="3.5"
          width="13"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 2.2"
          rx="1.5"
        />
      </svg>
    ),
  },
  {
    id: 'erase',
    label: { ja: '消しゴム', en: 'Eraser' },
    shortcut: '3',
    hint: { ja: 'タップで削除・なぞって一括削除', en: 'Tap to delete, drag to delete in bulk' },
    icon: (
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
        <path
          d="M6.6 14.5 2.9 10.8a1.4 1.4 0 0 1 0-2l6-6a1.4 1.4 0 0 1 2 0l3.6 3.7a1.4 1.4 0 0 1 0 2l-6 6z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M6.6 14.5H15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5.2 6.5 10.9 12.2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
      </svg>
    ),
  },
  {
    id: 'pan',
    label: { ja: '手', en: 'Hand' },
    shortcut: '4',
    hint: { ja: 'ドラッグでビューをスクロール（内容に触れない）', en: 'Drag to scroll the view (never touches content)' },
    icon: (
      <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
        <path
          d="M6 8.2V4.6a1.1 1.1 0 0 1 2.2 0v3.2m0-.4V3.7a1.1 1.1 0 0 1 2.2 0v4m0-.3V4.8a1.1 1.1 0 0 1 2.2 0v4.9c0 3-1.7 5.3-4.6 5.3-2.4 0-3.4-1-4.6-2.9L2 9.9a1.1 1.1 0 0 1 1.8-1.3l1.4 1.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/** 編集ツールの切り替え。アクティブ表示があるのでモード迷子にならない。 */
export function ToolStrip() {
  const editorTool = useProjectStore((s) => s.editorTool);
  const setEditorTool = useProjectStore((s) => s.setEditorTool);
  const { t } = useT();

  return (
    <div className="tool-strip" role="group" aria-label={t(strings.toolStrip.groupAria)}>
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`tool-btn ${editorTool === tool.id ? 'is-active' : ''}`}
          onClick={() => setEditorTool(tool.id)}
          aria-pressed={editorTool === tool.id}
          aria-label={t(tool.label)}
          title={`${t(tool.label)}（${tool.shortcut}） — ${t(tool.hint)}`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
