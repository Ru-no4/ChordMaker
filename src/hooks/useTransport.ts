import { useCallback, useEffect, useRef } from 'react';
import { audioEngine } from '../lib/audio';
import { contentExtentSteps, stepsPerBar, totalSteps } from '../lib/grid';
import { flattenNotes, useProjectStore } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';

/** ストアの状態を Tone.js トランスポートへ反映し、再生操作を提供する */
export function useTransport() {
  const bpm = useProjectStore((s) => s.bpm);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const rangeStart = useProjectStore((s) => s.rangeStart);
  const loop = useProjectStore((s) => s.loop);
  const blocks = useProjectStore((s) => s.blocks);
  const volumeDb = useProjectStore((s) => s.volumeDb);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const instrumentId = useProjectStore((s) => s.instrumentId);
  const setInstrumentStatus = useProjectStore((s) => s.setInstrumentStatus);
  const setStep = usePlayheadStore((s) => s.setStep);

  const total = totalSteps(timeSignature, bars);
  // 開始位置が終了位置以降になっている（入れ替わっている）間は無効扱いにし、
  // 範囲による制限をやめて、置かれている内容の全域を再生・ループする
  const rangeValid = rangeStart < bars;
  const loopStart = rangeValid ? rangeStart * stepsPerBar(timeSignature) : 0;
  const loopEnd = rangeValid ? total : Math.max(total, contentExtentSteps(blocks));

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
    audioEngine.setNotes(flattenNotes(blocks), loop ? { startStep: loopStart, endStep: loopEnd } : null);
  }, [blocks, loop, loopStart, loopEnd]);

  useEffect(() => {
    audioEngine.setVolumeDb(volumeDb);
  }, [volumeDb]);

  /* --- 音源の読み込み --- */
  useEffect(() => {
    if (audioEngine.currentInstrumentId === instrumentId) return;

    let cancelled = false;
    setInstrumentStatus(true);
    audioEngine
      .loadInstrument(instrumentId)
      .then(() => {
        if (!cancelled) setInstrumentStatus(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // 失敗しても内蔵シンセで鳴り続ける
        setInstrumentStatus(false, '音源を読み込めませんでした');
        console.error('音源の読み込みに失敗しました', error);
      });
    return () => {
      cancelled = true;
    };
  }, [instrumentId, setInstrumentStatus]);

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

  const previewNotes = useCallback((midis: number[]) => {
    void audioEngine.previewNotes(midis);
  }, []);

  const previewNote = useCallback((midi: number) => {
    void audioEngine.previewNotes([midi], 0.45);
  }, []);

  return { play, pause, stop, seek, previewNote, previewNotes, isPlaying };
}
