import { useCallback, useEffect, useMemo, useRef } from 'react';
import { audioEngine, type ScheduledNote } from '../lib/audio';
import { contentExtentSteps, stepsPerBar, totalSteps } from '../lib/grid';
import { flattenNotes, useProjectStore, type ChordBlockItem } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';

/** ストアの状態を Tone.js トランスポートへ反映し、再生操作を提供する */
export function useTransport() {
  const bpm = useProjectStore((s) => s.bpm);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const rangeStart = useProjectStore((s) => s.rangeStart);
  const loop = useProjectStore((s) => s.loop);
  const tracks = useProjectStore((s) => s.tracks);
  const trackSettings = useProjectStore((s) => s.trackSettings);
  const volumeDb = useProjectStore((s) => s.volumeDb);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const activeTrackId = useProjectStore((s) => s.activeTrackId);
  const setTrackInstrumentStatus = useProjectStore((s) => s.setTrackInstrumentStatus);
  const setStep = usePlayheadStore((s) => s.setStep);

  // トラックの中身（ブロック）は編集のたびに参照が変わるので、そのまま依存配列に
  // 使うと無関係な effect（音源読み込み等）まで毎回走ってしまう。
  // トラックの「顔ぶれ」（id の集合と並び）だけを安定した文字列キーにしておく。
  const trackIdsKey = tracks.map((t) => t.id).join(',');
  const trackIds = useMemo(() => trackIdsKey.split(',').filter(Boolean), [trackIdsKey]);

  /**
   * ノート/ブロックのドラッグ中は pointermove のたびに tracks 配列全体が
   * 新しい参照になるが、実際に中身が変わったのは操作中の1トラックだけ
   * （他トラックは store 側で同じ blocks 参照のまま保たれる）。
   * ここでトラックごとに「blocks 参照が変わっていなければ前回計算した
   * notes 配列をそのまま使い回す」キャッシュを持つ。こうして生成した
   * notes 配列を audioEngine.setTracks に渡すと、中身が変わっていない
   * トラックの Tone.Part まで毎フレーム作り直す（重い）のを避けられる
   * （audioEngine.setTracks 側は notes の参照が前回と同じかどうかだけを見る）。
   */
  const notesCacheRef = useRef(new Map<string, { blocks: ChordBlockItem[]; notes: ScheduledNote[] }>());
  const trackNotesInput = useMemo(() => {
    const cache = notesCacheRef.current;
    const nextCache = new Map<string, { blocks: ChordBlockItem[]; notes: ScheduledNote[] }>();
    const input = tracks.map((t) => {
      const cached = cache.get(t.id);
      const notes = cached && cached.blocks === t.blocks ? cached.notes : flattenNotes(t.blocks);
      nextCache.set(t.id, { blocks: t.blocks, notes });
      return { trackId: t.id, notes };
    });
    notesCacheRef.current = nextCache;
    return input;
  }, [tracks]);

  const total = totalSteps(timeSignature, bars);
  // 開始位置が終了位置以降になっている（入れ替わっている）間は無効扱いにし、
  // 範囲による制限をやめて、置かれている内容の全域を再生・ループする
  // （全トラックぶんの内容を見て、どのトラックの末尾も欠けないようにする）
  const rangeValid = rangeStart < bars;
  const loopStart = rangeValid ? rangeStart * stepsPerBar(timeSignature) : 0;
  const contentExtent = tracks.reduce(
    (max, t) => Math.max(max, contentExtentSteps(t.blocks)),
    0,
  );
  const loopEnd = rangeValid ? total : Math.max(total, contentExtent);

  /* --- 設定の反映 --- */
  useEffect(() => {
    audioEngine.setTempo(bpm, timeSignature);
    audioEngine.setTimeSignature(timeSignature);
  }, [bpm, timeSignature]);

  useEffect(() => {
    audioEngine.setLoop(loop, loopStart, loopEnd);
  }, [loop, loopStart, loopEnd]);

  useEffect(() => {
    audioEngine.setEndOfProject(total, () => {
      setPlaying(false);
      setStep(0);
    });
  }, [total, setPlaying, setStep]);

  useEffect(() => {
    // ループ中は再生をループ範囲に切り詰める。範囲の途中から鳴っているはずの
    // 音が頭から聞こえない、範囲の終端をまたぐ音がループしても鳴り続ける、
    // という2つの問題を避けるため。ループ無効時は従来通り本来の長さで鳴らす。
    // 全トラックぶんをまとめて渡す（存在しなくなったトラックのチャンネルは
    // audioEngine 側で自動的に破棄される。中身が変わっていないトラックの
    // Tone.Part を作り直さない最適化は audioEngine.setTracks 側で行う）。
    audioEngine.setTracks(
      trackNotesInput,
      loop ? { startStep: loopStart, endStep: loopEnd } : null,
    );
  }, [trackNotesInput, loop, loopStart, loopEnd]);

  useEffect(() => {
    audioEngine.setVolumeDb(volumeDb);
  }, [volumeDb]);

  /* --- トラックごとの音量 --- */
  useEffect(() => {
    for (const id of trackIds) {
      const db = trackSettings[id]?.volumeDb;
      if (db !== undefined) audioEngine.setTrackVolumeDb(id, db);
    }
  }, [trackIds, trackSettings]);

  /*
   * --- トラックごとのミュート/ソロ、および鳴りうるトラック数 ---
   * ソロ中のトラックが1本でもあれば、ソロされていない他トラックは強制的に
   * ミュート扱いにする（自身のミュート状態はそのまま維持: ミュート かつ ソロ
   * のトラックはソロ解除後もミュートのまま）。多重にソロされているときの
   * 特別な後始末は不要 — 毎回この計算をゼロからやり直すだけでよい。
   *
   * あわせて「実際に鳴りうる」トラック数（ミュートされておらず、かつ
   * ノートが1つ以上ある）を数え、マスター手前の自動トリムへ反映する。
   * トラックが増えるほど音が単純に合算されて大きくなるのを緩和するため
   * （詳細は audioEngine.setAudibleTrackCount のコメント参照）。
   */
  useEffect(() => {
    const anySolo = trackIds.some((id) => trackSettings[id]?.solo);
    let audibleCount = 0;
    for (const id of trackIds) {
      const settings = trackSettings[id];
      if (!settings) continue;
      const effectiveMuted = anySolo ? !settings.solo || settings.muted : settings.muted;
      audioEngine.setTrackMuted(id, effectiveMuted);
      if (!effectiveMuted && tracks.find((t) => t.id === id)?.blocks.some((b) => b.notes.length > 0)) {
        audibleCount++;
      }
    }
    audioEngine.setAudibleTrackCount(audibleCount);
  }, [trackIds, trackSettings, tracks]);

  /* --- 音源の読み込み（トラックごと） --- */
  useEffect(() => {
    let cancelled = false;
    for (const id of trackIds) {
      const desired = trackSettings[id]?.instrumentId;
      if (!desired) continue;

      if (audioEngine.currentTrackInstrumentId(id) === desired) {
        // StrictMode の開発時二重実行では、直前の呼び出しが同期的に
        // 音源IDを更新済みのままここへ来ることがある。その場合の .then() は
        // cleanup で握りつぶされて呼ばれないため、ここで明示的に読み込み中
        // フラグを下ろしておかないと固まったままになる。
        setTrackInstrumentStatus(id, false);
        continue;
      }

      setTrackInstrumentStatus(id, true);
      audioEngine
        .loadTrackInstrument(id, desired)
        .then(() => {
          if (!cancelled) setTrackInstrumentStatus(id, false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // 失敗しても内蔵シンセで鳴り続ける
          setTrackInstrumentStatus(id, false, true);
          console.error('音源の読み込みに失敗しました', error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [trackIds, trackSettings, setTrackInstrumentStatus]);

  /* --- 再生位置の追従 --- */
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      setStep(audioEngine.currentStep());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying, setStep]);

  /* --- 操作 --- */
  const play = useCallback(async () => {
    await audioEngine.ensureStarted();
    const state = useProjectStore.getState();
    audioEngine.setTempo(state.bpm, state.timeSignature);

    // 再生ヘッド（赤いバー）が再生範囲の開始スライダーと違う位置にいたら、
    // そこへ移動してから再生する（開始スライダーが無効なときは何もしない）。
    if (state.rangeStart < state.bars) {
      const targetStep = state.rangeStart * stepsPerBar(state.timeSignature);
      if (Math.abs(audioEngine.currentStep() - targetStep) > 0.01) {
        audioEngine.silenceNow();
        audioEngine.seekToStep(targetStep);
        setStep(targetStep);
      }
    }

    audioEngine.play();
    setPlaying(true);
  }, [setPlaying, setStep]);

  const pause = useCallback(() => {
    audioEngine.pause();
    setPlaying(false);
  }, [setPlaying]);

  const stop = useCallback(() => {
    audioEngine.stop();
    setPlaying(false);
    setStep(0);
  }, [setPlaying, setStep]);

  const seek = useCallback(
    (step: number) => {
      const limit = totalSteps(
        useProjectStore.getState().timeSignature,
        useProjectStore.getState().bars,
      );
      const clamped = Math.min(Math.max(0, step), limit);
      // 飛んだ先と関係のない音が鳴り続けないように切る
      audioEngine.silenceNow();
      audioEngine.seekToStep(clamped);
      setStep(clamped);
    },
    [setStep],
  );

  const previewNotes = useCallback(
    (midis: number[]) => {
      void audioEngine.previewNotes(activeTrackId, midis);
    },
    [activeTrackId],
  );

  const previewNote = useCallback(
    (midi: number) => {
      void audioEngine.previewNotes(activeTrackId, [midi], 0.45);
    },
    [activeTrackId],
  );

  return { play, pause, stop, seek, previewNote, previewNotes, isPlaying };
}
