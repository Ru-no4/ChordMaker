import { useCallback, useEffect, useRef } from 'react';
import { audioEngine } from '../lib/audio';
import { totalSteps } from '../lib/grid';
import { flattenNotes, useProjectStore } from '../store/useProjectStore';
import { usePlayheadStore } from '../store/usePlayheadStore';

/** ストアの状態を Tone.js トランスポートへ反映し、再生操作を提供する */
export function useTransport() {
  const bpm = useProjectStore((s) => s.bpm);
  const timeSignature = useProjectStore((s) => s.timeSignature);
  const bars = useProjectStore((s) => s.bars);
  const loop = useProjectStore((s) => s.loop);
  const blocks = useProjectStore((s) => s.blocks);
  const volumeDb = useProjectStore((s) => s.volumeDb);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const setStep = usePlayheadStore((s) => s.setStep);

  const total = totalSteps(timeSignature, bars);

  /* --- 設定の反映 --- */
  useEffect(() => {
    audioEngine.setTempo(bpm, timeSignature);
    audioEngine.setTimeSignature(timeSignature);
  }, [bpm, timeSignature]);

  useEffect(() => {
    audioEngine.setLoop(loop, total);
  }, [loop, total]);

  useEffect(() => {
    audioEngine.setEndOfProject(total, () => {
      setPlaying(false);
      setStep(0);
    });
  }, [total, setPlaying, setStep]);

  useEffect(() => {
    audioEngine.setNotes(flattenNotes(blocks));
  }, [blocks]);

  useEffect(() => {
    audioEngine.setVolumeDb(volumeDb);
  }, [volumeDb]);

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
    audioEngine.setTempo(
      useProjectStore.getState().bpm,
      useProjectStore.getState().timeSignature,
    );
    audioEngine.play();
    setPlaying(true);
  }, [setPlaying]);

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
