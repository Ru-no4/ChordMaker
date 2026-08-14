# マルチトラックDAW化プロジェクト

現状ChrodMakerは「コードトラック」が1本だけの構成になっている。将来的に
Cubase/Ableton的な「複数トラックを追加し、それぞれ別の音源・音量で同時再生できる」
構成へ進化させるための段階移行プロジェクト。このドキュメントは、承認済みの移行プラン
と、現在どこまで実装が進んでいるかを記録する。

## スコープ

同じ性質（コードブロック方式）のトラックをN本、それぞれ独立した音源・音量で
持てるようにするところまで。以前検討した「リズム/ステップシーケンサー的な
別種のトラック」は本プロジェクトのスコープ外。将来別種のトラックを足す余地は
残すが、今回は設計しない。

## 進捗サマリ

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 1 | データモデルのトラック化 | ✅ 完了 |
| 2 | 音声エンジンのトラック化 | 未着手 |
| 3 | UIに2本目のトラックを表示 | 未着手 |
| 4 | 音源・音量UIの配線 + 選択追従の確認 | 未着手 |
| 5 | ミュート/ソロ + 同時再生の実地検証 | 未着手 |
| 6 | 仕上げ | 未着手 |

## 重要な設計判断

**Undo対象の分離を維持すること。** 従来 `instrumentId`・`volumeDb`・
`chordTrackHeight` は意図的にUndo対象外（`DocSnapshot` に含まれない）だった。
トラック化する際、これらを `blocks` と同じ構造体に雑にまとめると「音源を
変えただけでUndo可能になる」という従来と異なる挙動が紛れ込む。

そこで各トラックを2つに分離した：

- `tracks: Track[]` = `{ id, name, color, blocks }` … **中身**。Undo対象
- `trackSettings: Record<trackId, TrackSettings>` = `{ instrumentId, volumeDb, muted, solo, height }` … **設定**。Undo対象外

この分離が以降すべてのフェーズの土台になる。

## フェーズ構成（承認済みプラン）

### フェーズ1: データモデルのトラック化（見た目の変化なし）— 完了

`Track`/`TrackSettings` 型を導入し、既存の単一トラックを「1本だけ入った
tracks配列」として扱うようにする。ブロック/ノート操作アクション
（`moveBlock`・`resizeBlock`・`addNote` 等）は用途に応じて `trackId` 引数を
取るように変更し、`activeTrackId` を新設。選択・Undo・ピアノロールの
「アクティブトラック追従」もここで一緒に片付けた。

**実装内容:**

- `src/store/useProjectStore.ts`
  - `Track` / `TrackSettings` 型を追加。`blocks`/`instrumentId`/`volumeDb`/
    `chordTrackHeight` を `tracks: Track[]` + `trackSettings: Record<string, TrackSettings>`
    + `activeTrackId: string` に置き換え
  - `trackInstrumentLoading` / `trackInstrumentError`（トラック単位の音源読込状態、
    Undo対象外）を追加
  - `DocSnapshot` を `{ tracks, bars, rangeStart, timeSignature }` に変更。
    `reconcileSelection` は `activeTrackId` の再解決も行う
  - ブロック操作（`addBlockAt`/`removeBlock`/`moveBlock`/`resizeBlock`/
    `selectBlock`/`selectBlocks`/`toggleBlockSelection`/`copyBlock`/
    `pasteBlockAt`/`duplicateNotesToNearestGap`）は呼び出し元がトラックを
    明示できるため `trackId` を明示引数に。ノート操作・ピアノロール系
    （`addNote`/`updateNote`/`removeNotes`/`applyNoteDrag`/`applyNoteResize`
    等）は常に「今開いているトラック」に対して働くため、内部で
    `activeTrackId` を参照する形にして呼び出し側のシグネチャは変えていない
  - `addTrack`/`removeTrack`/`setActiveTrack`/`setTrackInstrument`/
    `setTrackVolumeDb`/`setTrackHeight`/`toggleTrackMute`/`toggleTrackSolo`/
    `renameTrack` をフェーズ3以降に備えて用意（UIからはまだ呼ばれない）
  - `mergeTracksForSave`/`selectActiveTrackBlocks` をエクスポートし、UI側の
    セレクタとオートセーブ処理から共通利用できるようにした
- `src/lib/projectFile.ts`
  - 保存形式に `tracks: SerializedTrack[]`（中身と設定を1つにまとめた
    ファイル専用の表現）を追加、`formatVersion` を2に
  - 旧v1形式（`blocks`+`instrumentId`+`volumeDb` が直下にある）を読んだ場合、
    単一トラックへ自動移行するmigration分岐を追加
- UIコンポーネント（`App.tsx`/`ChordTimeline.tsx`/`ChordBlock.tsx`/
  `ChordTrackResizeHandle.tsx`/`PianoRoll.tsx`/`ChordInspector.tsx`/
  `ProjectFileControls.tsx`/`InstrumentSelect.tsx`/`useTransport.ts`/
  `usePianoRollGesture.ts`）のセレクタを新しいストア構造に合わせて機械的に更新

**検証結果（実機ブラウザで確認、見た目・操作感は変更前と同一）:**

- `tsc -b` / `vite build` ともにクリーン
- ブロック移動 → 音源変更 → ノート削除 → 連続Undo で、音源選択が
  Undoに巻き込まれて戻らないことを確認
- 旧v1形式の `.chrd` ファイルを実際のファイル選択UIから読み込み、
  単一トラックへ正しく移行することを確認
- オートセーブの保存 → リロード往復を確認
- 全削除・初期化の確認ダイアログ省略判定、先頭への小節追加、Undo/Redo
  も新しいデータ構造で問題なく動作することを確認

### フェーズ2: 音声エンジンのトラック化（最難関）— 未着手

`AudioEngine` の単一シンセ/サンプル/Partを `Map<trackId, TrackChannel>` に
一般化する。`setNotes()` → `setTracks(tracks[], loopRange)` に変更。
UIはまだトラック1本のまま。

- **チャンネル構造案**: 各トラックが `synth`・`sampled`・`part`・
  `volume`（Tone.Volume、共有reverb/limiterへ接続）・`activeVoices` を
  個別に持つ。ループ範囲での発音切り詰めロジックは共通ヘルパーへ抽出して
  各チャンネルから呼ぶ
- **音量**: 既存の `setVolumeDb` は「マスターフェーダー」として残し、
  新たに `setTrackVolumeDb(trackId, db)` を追加（ストア側は既に用意済み。
  音声エンジン側の配線がフェーズ2の作業）
- **一番危ういところ**: 音量自動較正の仕組み（`sampledGainCache`・
  `targetRms`・アナライザー）。アナライザーのタップ自体はチャンネルごとに
  分離必須（他トラックの同時発音が計測に混入するのを防ぐ）。一方
  「学習済みゲイン」のキャッシュはエンジン全体で共有のままにする
- **ポリフォニー**: 現状は単一シンセに `maxPolyphony: 64`。トラックごとに
  単純にN倍せず、まずは1トラック16程度を目安にし、実機確認後に調整する
- **検証方針**: UIはまだ1トラックのままなので、開発中に手動で2チャンネル分の
  ダミーデータを流し込み、(a)同時再生で片方のノートオフがもう片方を
  巻き込まない (b)チャンネル破棄がエラーにならない (c)同じ音源を
  2チャンネルが使っても二重ダウンロードにならない (d)較正中に他チャンネルが
  鳴っていても較正値が壊れない、を確認する

### フェーズ3: UIに2本目のトラックを表示（最初の見た目の変化）— 未着手

`ChordTimeline` を「ルーラー（共通・1つ）」+「`TrackLane`（トラックごとに
繰り返し）」に分割。トラック追加/削除ボタンと最小限のヘッダー（名前のみ）を
追加。音源選択・音量UIはまだ出さない（フェーズ4で分離）。

- **触るファイル**: `ChordTimeline.tsx`（分割）、`ChordBlock.tsx`
  （`trackId` プロップ追加）、`App.tsx`
- **一番危ういところ**: `scrollSync.ts` のグローバルなSet登録（今は1レーン+
  ピアノロール前提）。レーンが増えても正しく同期・後始末されるか
- **検証方針**: 2本目のトラックを追加し、横スクロール/ズームが全レーン+
  ピアノロールで同期すること、再生ヘッドが全レーンを貫通して表示されること、
  トラック削除で古い登録が残らないこと、2本目以降のトラックでもブロックの
  ドラッグ/リサイズ/コピペ/4ツールが正しく動くこと

### フェーズ4: 音源・音量UIの配線 + 選択追従の確認 — 未着手

フェーズ1・2で下準備済みの `trackId` 単位の音源/音量を、トラックヘッダーに
実際のUIとして出す。ピアノロール・選択状態が正しくアクティブトラックに
追従するかの検証が中心。

- **触るファイル**: トラックヘッダー（`InstrumentSelect`・音量スライダーを
  追加）、`PianoRoll.tsx`、`ControlBar.tsx`（今のグローバル音源選択は
  マスターフェーダー機能へ縮小 or 削除）
- **一番危ういところ**: 「トラックBのブロックを選択したのにピアノロール/
  ヘッダーがトラックAを指したまま」という類のサイレントなズレ
- **検証方針**: 3本以上のトラックを跨いでブロックを選び、ピアノロールと
  各ヘッダーが毎回正しいトラックを指すこと。Ctrl+A/コピペ/削除が
  アクティブトラックに対して働くこと

### フェーズ5: ミュート/ソロ + 同時再生の実地検証 — 未着手

`trackSettings` の `muted`/`solo`（ストア側は用意済み）を、`Tone.Volume` の
`mute` プロパティで実際に音を止めるところまで配線する。ここで初めて
「本当に複数トラックが同時に鳴る」ことを人の耳で検証するフェーズと位置づける。

- **一番危ういところ**: ミュート切替時のプチノイズ（発音中に `.mute` を
  切ると急激なゲイン変化でクリック音が出ることがある → 気になるようなら
  `rampTo` に変更）、ソロの多重解除ロジック
- **検証方針**: 発音中にミュート/ソロを切り替えてクリック音の有無を確認。
  3トラック以上を同時再生してCPU負荷・音切れがないことを確認

### フェーズ6: 仕上げ — 未着手

トラックの並べ替え・色・名前変更・トラックごとの高さ調整（フェーズ1で作った
`ChordTrackResizeHandle` のパターンをトラック単位に一般化）。リスクは最も低い。

## 検証方法まとめ

各フェーズとも、`npx tsc -b`・`npx vite build` に加えてブラウザでの実操作
確認を行う。フェーズ1・2は「現状と見分けがつかないこと」自体が合格基準、
フェーズ3以降は複数トラックを実際に作って操作・耳で確認する。

## 主要な対象ファイル

- `src/store/useProjectStore.ts`
- `src/lib/audio.ts`
- `src/hooks/useTransport.ts`
- `src/lib/projectFile.ts`
- `src/components/ChordTimeline.tsx`
