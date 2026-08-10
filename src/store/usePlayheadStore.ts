import { create } from 'zustand';

/**
 * 再生位置は毎フレーム更新されるため、プロジェクト本体とは別ストアに分ける。
 * これで再生中に再描画されるのは再生ヘッドと位置表示だけで済む。
 */
interface PlayheadState {
  /** 32分音符単位（小数を含む） */
  step: number;
  setStep: (step: number) => void;
}

export const usePlayheadStore = create<PlayheadState>((set) => ({
  step: 0,
  setStep: (step) => set({ step }),
}));
