import { useCallback, useEffect, useState } from 'react';
import { ControlBar } from './components/ControlBar';
import { ChordInspector } from './components/ChordInspector';
import { ChordTimeline } from './components/ChordTimeline';
import { PianoRoll } from './components/PianoRoll';
import { ShortcutHelp } from './components/ShortcutHelp';
import { TOOLS } from './components/ToolStrip';
import { useTransport } from './hooks/useTransport';
import { useProjectStore, type EditorTool } from './store/useProjectStore';
import './styles/app.css';

/** ステータスバーに出す、そのツールで今できること */
const TOOL_HINTS: Record<EditorTool, string[]> = {
  draw: [
    'タップで配置',
    'ドラッグで移動',
    '右端ドラッグで長さ変更',
    'ダブルクリックで削除',
  ],
  range: [
    'ドラッグで矩形選択（小節を跨げます）',
    'タップで選択トグル',
    '選択をまとめて移動・リサイズ',
    'ダブルクリックで削除',
  ],
  erase: ['タップで削除', 'なぞってまとめて削除'],
  pan: ['ドラッグでスクロール', '内容には触れません'],
};

export default function App() {
  const { play, pause, stop, seek, previewNote, previewNotes, isPlaying } = useTransport();
  const [helpOpen, setHelpOpen] = useState(false);

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
    selectedNoteIds.length,
    setEditorTool,
    setPianoRollOpen,
    undo,
    redo,
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
        <PianoRoll onPreview={previewNote} />
      </main>

      <footer className="status-bar">
        <span className="status-bar__tool">
          <span className="status-bar__tool-icon">{tool?.icon}</span>
          {tool?.label}
        </span>
        {TOOL_HINTS[editorTool].map((hint) => (
          <span key={hint}>{hint}</span>
        ))}
        <span className="status-bar__spacer" />
        <button type="button" className="status-bar__help" onClick={() => setHelpOpen(true)}>
          操作一覧 <kbd>?</kbd>
        </button>
      </footer>

      {helpOpen && <ShortcutHelp onClose={closeHelp} />}
    </div>
  );
}
