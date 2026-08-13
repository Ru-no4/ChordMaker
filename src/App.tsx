import { useCallback, useEffect, useState } from 'react';
import { ControlBar } from './components/ControlBar';
import { ChordInspector } from './components/ChordInspector';
import { ChordTimeline } from './components/ChordTimeline';
import { ChordTrackResizeHandle } from './components/ChordTrackResizeHandle';
import { PianoRoll } from './components/PianoRoll';
import { ShortcutHelp } from './components/ShortcutHelp';
import { TOOLS } from './components/ToolStrip';
import { useTransport } from './hooks/useTransport';
import { useProjectStore, type EditorTool } from './store/useProjectStore';
import { usePlayheadStore } from './store/usePlayheadStore';
import { useT, type Localized } from './i18n/useT';
import { strings } from './i18n/strings';
import './styles/app.css';

/** ステータスバーに出す、そのツールで今できること */
const TOOL_HINTS: Record<EditorTool, Localized[]> = {
  draw: [
    { ja: 'タップで配置', en: 'Tap to place' },
    { ja: 'ドラッグで移動', en: 'Drag to move' },
    { ja: '右端ドラッグで長さ変更', en: 'Drag the right edge to resize' },
    { ja: 'ダブルクリックで削除', en: 'Double-click to delete' },
  ],
  range: [
    { ja: 'ドラッグで矩形選択（小節を跨げます）', en: 'Drag to box-select (can span bars)' },
    { ja: 'タップで選択トグル', en: 'Tap to toggle selection' },
    { ja: '選択をまとめて移動・リサイズ', en: 'Move or resize the whole selection together' },
    { ja: 'ダブルクリックで削除', en: 'Double-click to delete' },
  ],
  erase: [
    { ja: 'タップで削除', en: 'Tap to delete' },
    { ja: 'なぞってまとめて削除', en: 'Drag over to delete in one go' },
  ],
  pan: [
    { ja: 'ドラッグでスクロール', en: 'Drag to scroll' },
    { ja: '内容には触れません', en: 'Never touches the content' },
  ],
};

export default function App() {
  const { play, pause, stop, seek, previewNote, previewNotes, isPlaying } = useTransport();
  const [helpOpen, setHelpOpen] = useState(false);
  const { t } = useT();

  const editorTool = useProjectStore((s) => s.editorTool);
  const setEditorTool = useProjectStore((s) => s.setEditorTool);
  const selectedBlockId = useProjectStore((s) => s.selectedBlockId);
  const selectedNoteIds = useProjectStore((s) => s.selectedNoteIds);
  const removeBlock = useProjectStore((s) => s.removeBlock);
  const removeSelectedNotes = useProjectStore((s) => s.removeSelectedNotes);
  const selectAllNotesInBlock = useProjectStore((s) => s.selectAllNotesInBlock);
  const setPianoRollOpen = useProjectStore((s) => s.setPianoRollOpen);
  const pianoRollOpen = useProjectStore((s) => s.pianoRollOpen);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const clipboard = useProjectStore((s) => s.clipboard);
  const copyBlock = useProjectStore((s) => s.copyBlock);
  const pasteBlockAt = useProjectStore((s) => s.pasteBlockAt);
  const copySelectedNotes = useProjectStore((s) => s.copySelectedNotes);
  const pasteNotesAt = useProjectStore((s) => s.pasteNotesAt);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  /* --- キーボードショートカット --- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      if (e.key === '?' || e.code === 'F1') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (helpOpen) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
          case 'KeyY':
            e.preventDefault();
            redo();
            return;
          case 'KeyA':
            if (!selectedBlockId) return;
            e.preventDefault();
            selectAllNotesInBlock(selectedBlockId);
            return;
          case 'KeyC':
            if (selectedNoteIds.length > 0) copySelectedNotes();
            else if (selectedBlockId) copyBlock(selectedBlockId);
            else return;
            e.preventDefault();
            return;
          case 'KeyV': {
            if (!clipboard) return;
            e.preventDefault();
            const step = usePlayheadStore.getState().step;
            if (clipboard.kind === 'notes') pasteNotesAt(step);
            else pasteBlockAt(step);
            return;
          }
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (isPlaying) pause();
          else void play();
          break;
        case 'Escape':
          stop();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          if (selectedNoteIds.length > 0) removeSelectedNotes();
          else if (selectedBlockId) removeBlock(selectedBlockId);
          break;
        case 'Digit1':
          setEditorTool('draw');
          break;
        case 'Digit2':
          setEditorTool('range');
          break;
        case 'Digit3':
          setEditorTool('erase');
          break;
        case 'Digit4':
          setEditorTool('pan');
          break;
        case 'KeyP':
          setPianoRollOpen(!pianoRollOpen);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    helpOpen,
    isPlaying,
    pause,
    play,
    stop,
    pianoRollOpen,
    removeBlock,
    removeSelectedNotes,
    selectAllNotesInBlock,
    selectedBlockId,
    selectedNoteIds,
    setEditorTool,
    setPianoRollOpen,
    undo,
    redo,
    clipboard,
    copyBlock,
    pasteBlockAt,
    copySelectedNotes,
    pasteNotesAt,
  ]);

  const tool = TOOLS.find((t) => t.id === editorTool);

  return (
    <div className="app">
      <ControlBar
        onPlay={() => void play()}
        onPause={pause}
        onStop={stop}
        onJumpToStart={() => seek(0)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <ChordInspector onPreview={previewNotes} />
      <main className="workspace">
        <ChordTimeline onSeek={seek} />
        <ChordTrackResizeHandle />
        <PianoRoll onPreview={previewNote} />
      </main>

      <footer className="status-bar">
        <span className="status-bar__tool">
          <span className="status-bar__tool-icon">{tool?.icon}</span>
          {tool && t(tool.label)}
        </span>
        {TOOL_HINTS[editorTool].map((hint) => (
          <span key={hint.ja}>{t(hint)}</span>
        ))}
        <span className="status-bar__spacer" />
        <button type="button" className="status-bar__help" onClick={() => setHelpOpen(true)}>
          {t(strings.shortcutHelp.title)} <kbd>?</kbd>
        </button>
      </footer>

      {helpOpen && <ShortcutHelp onClose={closeHelp} />}
    </div>
  );
}
