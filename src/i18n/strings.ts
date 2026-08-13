/**
 * コンポーネント単位の翻訳辞書。
 * 表形式のデータ（TOOL_HINTS・VOICING_PRESETS・CHORD_RESOLUTION_LABELS・
 * INTERVAL_NAMES・楽器グループラベルなど）はこのファイルに切り出さず、
 * それぞれのドメインファイルの中で { ja, en } 化する。
 */
export const strings = {
  controlBar: {
    undo: { ja: '元に戻す (Ctrl+Z)', en: 'Undo (Ctrl+Z)' },
    undoAria: { ja: '元に戻す', en: 'Undo' },
    redo: { ja: 'やり直す (Ctrl+Y)', en: 'Redo (Ctrl+Y)' },
    redoAria: { ja: 'やり直す', en: 'Redo' },
    jumpToStart: { ja: '先頭へ戻る', en: 'Jump to start' },
    play: { ja: '再生 (Space)', en: 'Play (Space)' },
    playAria: { ja: '再生', en: 'Play' },
    pause: { ja: '一時停止 (Space)', en: 'Pause (Space)' },
    pauseAria: { ja: '一時停止', en: 'Pause' },
    stop: { ja: '停止 (Esc)', en: 'Stop (Esc)' },
    stopAria: { ja: '停止', en: 'Stop' },
    loopTitle: { ja: 'ループ再生', en: 'Loop playback' },
    followTitle: { ja: '再生ヘッドを画面中央に追従させる', en: 'Keep the playhead centered' },
    bpmLabel: { ja: 'BPM', en: 'BPM' },
    bpmSliderAria: { ja: 'BPM スライダー', en: 'BPM slider' },
    timeSignatureLabel: { ja: '拍子', en: 'Time sig.' },
    barsLabel: { ja: '小節数', en: 'Bars' },
    volumeLabel: { ja: 'Volume', en: 'Volume' },
    volumeAria: { ja: '音量', en: 'Volume' },
    chordLabel: { ja: 'Chord', en: 'Chord' },
    chordTitle: {
      ja: 'コードを判定する時間の刻み（小節を何分割するか）',
      en: 'Chord-detection window (how many parts a bar is split into)',
    },
    quantizeLabel: { ja: 'Quantize', en: 'Quantize' },
    snapTitle: { ja: 'グリッドへの吸着', en: 'Snap to grid' },
    themeToLight: { ja: 'ライトテーマに切り替え', en: 'Switch to light theme' },
    themeToDark: { ja: 'ダークテーマに切り替え', en: 'Switch to dark theme' },
    themeToggleAria: { ja: 'テーマ切り替え', en: 'Toggle theme' },
    localeToggleTitle: { ja: '表示言語を切り替え', en: 'Switch display language' },
    localeToggleAria: { ja: '表示言語を切り替え', en: 'Switch display language' },
    helpTitle: { ja: '操作一覧（?）', en: 'Operation guide (?)' },
    helpAria: { ja: '操作一覧を開く', en: 'Open the operation guide' },
  },

  toolStrip: {
    groupAria: { ja: '編集ツール', en: 'Editing tools' },
  },

  chordInspector: {
    chainVoiceLeadTitle: {
      ja: '先頭のコードは据え置き、以降を順に前のコードへ近いオクターブで合わせる（声部の移動を抑える）',
      en: 'Keeps the first chord as-is, then voices each following chord close to the previous one (minimizes voice movement)',
    },
    chainVoiceLead: { ja: 'ボイシングをつなげる', en: 'Chain voice leading' },
    clearSelection: { ja: '選択解除', en: 'Clear selection' },
    reselectHint: {
      ja: 'Shift+クリック、または範囲選択ツールのドラッグで選び直せます',
      en: 'Shift+click, or drag with the range-select tool, to change the selection',
    },
    chordTypeTitle: { ja: 'コードタイプ', en: 'Chord type' },
    clickHint: { ja: 'コードブロックをクリックすると判定結果を表示します', en: 'Click a chord block to see its detection result' },
    chordsInBar: { ja: '小節内のコード', en: 'Chords in this bar' },
    detected: { ja: 'DETECTED', en: 'DETECTED' },
    detecting: { ja: '判定中', en: 'Detecting' },
    notes: { ja: '構成音', en: 'Notes' },
    notEntered: { ja: '未入力', en: 'None entered' },
    voicing: { ja: 'ボイシング', en: 'Voicing' },
    noPrecedingChord: { ja: '直前にコードがありません', en: 'There is no preceding chord' },
    voiceLeadTitle: {
      ja: '直前のコードの実音に近いオクターブへ各音を配置する',
      en: 'Places each note in the octave closest to the preceding chord',
    },
    candidates: { ja: '候補（クリックで確定）', en: 'Candidates (click to confirm)' },
    alternatives: { ja: '別解釈', en: 'Alternative readings' },
    preview: { ja: '♪ 試聴', en: '♪ Preview' },
  },

  chordTimeline: {
    ariaLabel: { ja: 'コードタイムライン', en: 'Chord timeline' },
    rangeStartHandleTitle: { ja: 'ドラッグして再生範囲の開始位置を変更', en: 'Drag to change the playback range start' },
    rangeEndHandleTitle: { ja: 'ドラッグして再生範囲の終了位置を変更', en: 'Drag to change the playback range end' },
    tapToAdd: { ja: 'タップで追加', en: 'Tap to add' },
    tapToDelete: { ja: 'タップで削除', en: 'Tap to delete' },
    zoomAria: { ja: 'コードトラックの横幅表示倍率', en: 'Chord track horizontal zoom' },
  },

  chordBlock: {
    resizeLeftAria: { ja: '長さ変更（左）', en: 'Resize (left)' },
    resizeRightAria: { ja: '長さ変更（右）', en: 'Resize (right)' },
  },

  chordSegment: {
    notesNotEntered: { ja: 'ノート未入力', en: 'No notes entered' },
  },

  pianoRoll: {
    ariaLabel: { ja: 'ピアノロール', en: 'Piano roll' },
    placeNotesHint: { ja: '構成音を配置してください', en: 'Place some notes' },
    selectBlockHint: { ja: 'コードブロックを選択してください', en: 'Select a chord block' },
    clearNotes: { ja: '構成音クリア', en: 'Clear notes' },
    zoomVAria: { ja: 'ピアノロールの縦方向表示倍率', en: 'Piano roll vertical zoom' },
    zoomHAria: { ja: 'ピアノロールの横幅表示倍率', en: 'Piano roll horizontal zoom' },
  },

  keyboard: {
    ariaLabel: { ja: '鍵盤', en: 'Keyboard' },
  },

  positionReadout: {
    title: { ja: '小節.拍.32分', en: 'bar.beat.32nd' },
  },

  projectFileControls: {
    saveTitle: { ja: 'プロジェクトを保存 (.chrd)', en: 'Save project (.chrd)' },
    saveAria: { ja: 'プロジェクトを保存', en: 'Save project' },
    openTitle: { ja: 'プロジェクトを開く (.chrd)', en: 'Open project (.chrd)' },
    openAria: { ja: 'プロジェクトを開く', en: 'Open project' },
    loadFailedShort: { ja: '読込失敗', en: 'Load failed' },
    clearAllTitle: { ja: '全削除', en: 'Clear all' },
    clearAllAria: { ja: 'すべてのコードを削除', en: 'Delete every chord' },
    resetTitle: { ja: '初期化', en: 'Reset' },
    resetAria: { ja: 'デフォルトのコード進行に戻す', en: 'Reset to the default chord progression' },
  },

  confirmDialog: {
    clearAllTitle: { ja: '全削除しますか？', en: 'Clear everything?' },
    clearAllMessage: {
      ja: '配置されているコードがすべて削除されます。',
      en: 'Every placed chord will be deleted.',
    },
    resetTitle: { ja: '初期化しますか？', en: 'Reset to default?' },
    resetMessage: {
      ja: 'コード進行と設定が、起動時のデフォルトへ戻ります。',
      en: 'The chord progression and settings will be reset to the startup defaults.',
    },
    cancel: { ja: 'キャンセル', en: 'Cancel' },
    ok: { ja: '保存せず実行', en: 'Proceed without saving' },
    saveThenOk: { ja: '保存してから実行 (.chrd)', en: 'Save, then proceed (.chrd)' },
  },

  instrumentSelect: {
    label: { ja: '音源', en: 'Instrument' },
    loadingTitle: { ja: 'サンプルを読み込み中（今は合成音で鳴ります）', en: 'Loading samples (using the synth in the meantime)' },
    loadingText: { ja: '読込中', en: 'Loading' },
    loadFailedText: { ja: '読込失敗', en: 'Load failed' },
  },

  errors: {
    invalidJson: { ja: 'JSON として読み込めませんでした', en: 'Could not be parsed as JSON' },
    invalidFormat: { ja: 'ファイルの形式が不正です', en: 'The file format is invalid' },
    wrongApp: { ja: 'ChrodMaker のプロジェクトファイルではありません', en: 'This is not a ChrodMaker project file' },
    unsupportedVersion: { ja: '対応していないバージョンのファイルです', en: 'This file version is not supported' },
    corruptBlocks: { ja: 'コードトラックのデータが壊れています', en: 'The chord track data is corrupted' },
    corruptTimeSignature: { ja: '拍子のデータが壊れています', en: 'The time signature data is corrupted' },
    corruptSettings: { ja: '設定のデータが壊れています', en: 'The settings data is corrupted' },
    genericLoadFailed: { ja: '読み込みに失敗しました', en: 'Failed to load the file' },
    instrumentLoadFailed: { ja: '音源を読み込めませんでした', en: 'Could not load the instrument' },
  },

  shortcutHelp: {
    dialogAria: { ja: '操作一覧', en: 'Operation guide' },
    title: { ja: '操作一覧', en: 'Operation guide' },
    lead: {
      ja: [
        'すべての操作はツールだけで到達できます。',
        '修飾キー・右クリックはデスクトップの近道で、無くても同じことができます。',
      ],
      en: [
        'Every action can be reached with the tools alone.',
        'Modifier keys and right-click are desktop shortcuts — nothing requires them.',
      ],
    },
    close: { ja: '閉じる', en: 'Close' },
    toolsHeading: { ja: 'ツール', en: 'Tools' },
    desktopShortcutsHeading: { ja: 'デスクトップの近道', en: 'Desktop shortcuts' },
    desktopShortcutsNote: { ja: '（タッチでは不要）', en: '(not needed on touch)' },
    keyboardHeading: { ja: 'キーボード', en: 'Keyboard' },
    instrumentsHeading: { ja: '音源', en: 'Instruments' },
    instrumentsText: {
      ja: [
        'コントロールバーの「音源」から切り替えられます。',
        '合成音はダウンロード不要で即鳴る既定の音源、',
        'Splendid Grand Piano は Steinway のマルチサンプル、',
        'その他は GM 128音色です。',
        'サンプルの読み込み中は「読込中」と表示され、その間も合成音で鳴り続けるので操作は止まりません。',
        '一度読み込んだ音源はブラウザにキャッシュされます。',
      ],
      en: [
        'Switch instruments from “Instrument” in the control bar.',
        'The synth is the default — it needs no download and plays instantly.',
        'Splendid Grand Piano is a Steinway multi-sample.',
        'The rest are the 128 GM instruments.',
        'While a sample loads, it shows “Loading” and the synth keeps playing in the meantime, so nothing is blocked.',
        'Once loaded, an instrument stays cached in the browser.',
      ],
    },
    followHeading: { ja: '再生ヘッドの追従（FOLLOW）', en: 'Playhead follow (FOLLOW)' },
    followText: {
      ja: [
        '再生中、再生ヘッドが表示領域の中央に来たところから画面が自動で流れます。',
        '中央より左にいる間はスクロールせずヘッドだけが進み、',
        '最初から中央より右にある場合は一度中央へ寄せてから追従します。',
        '手動でスクロールしながら聴きたいときは FOLLOW を切ってください。',
      ],
      en: [
        'During playback, the view starts scrolling once the playhead reaches the center.',
        'While it is left of center, only the head moves and the view stays still.',
        'If it starts right of center, the view snaps to center first and then follows.',
        'Turn FOLLOW off to scroll manually while listening.',
      ],
    },
    chordResolutionHeading: { ja: 'コード解像度（Chord）', en: 'Chord resolution (Chord)' },
    chordResolutionText: {
      ja: [
        'コードトラックは、1つのブロックの中でもコードが変わればセルを分けて表示します。',
        'この設定は「どれくらいの細かさで判定するか」を決めるものです。',
        '1/4 なら1拍ごとに判定し、同じコードが続く区間は自動でつながります。',
        'アルペジオは窓の中で1つのコードにまとまり、',
        '長く伸びた和音の上を走る短い音は経過音として判定から外れます。',
        '刻みの細かい曲では 1/8、1小節1コードで固定したいときは 小節 を選んでください。',
      ],
      en: [
        'The chord track splits a block into separate cells whenever the chord changes inside it.',
        'This setting controls how finely that detection runs.',
        'At 1/4, each beat is checked, and cells with the same chord merge automatically.',
        'An arpeggio inside one window is treated as a single chord,',
        'and short passing notes over a sustained chord are excluded from detection.',
        'Choose 1/8 for fast-moving songs, or Bar to lock one chord per bar.',
      ],
    },
  },
} as const;
