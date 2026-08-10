/**
 * Tone.js を用いた再生エンジン。
 *
 * スケジューリングは Transport の tick 基準で行うため、
 * 再生中に BPM を変えても走っている音がずれない。
 *
 * 音源は AudioEngine 内部に閉じ込めてあるので、後から
 * Tone.Sampler（フリー音源 / 市販音源）へ差し替えられる。
 */
import * as Tone from 'tone';
import type { TimeSignature } from './grid';

export interface ScheduledNote {
  midi: number;
  /** 32分音符単位の開始位置 */
  startStep: number;
  /** 32分音符単位の長さ */
  lengthSteps: number;
  velocity?: number;
}

/** Tone.Part に渡すイベント。`time` は Transport tick 表記。 */
interface PartEvent {
  time: string;
  midi: number;
  lengthSteps: number;
  velocity: number;
}

/** 通常のリリース（余韻）秒数 */
const NOTE_RELEASE = 1.1;
/** 停止時に音を切るための短いリリース秒数 */
const STOP_RELEASE = 0.02;

/** 1 step（32分音符）あたりの Tone tick 数。PPQ は 4分音符あたりの tick 数。 */
const toneTicksPerStep = (): number => Tone.getTransport().PPQ / 8;

/**
 * Tone の BPM は常に4分音符基準。
 * 本アプリの BPM は「拍子の分母を1拍」とした値なので変換する。
 */
const toQuarterBpm = (bpm: number, sig: TimeSignature): number =>
  (bpm * 4) / sig.denominator;

class AudioEngine {
  private instrument: Tone.PolySynth | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private part: Tone.Part<PartEvent> | null = null;
  private releaseRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private pendingNotes: ScheduledNote[] = [];

  /** ブラウザの自動再生制限のため、ユーザー操作の中から呼ぶこと */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.buildInstrument();
    this.started = true;
    // init 前に設定されたノートを反映
    this.setNotes(this.pendingNotes);
  }

  get isReady(): boolean {
    return this.started;
  }

  private buildInstrument(): void {
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.limiter);
    this.instrument = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.7, sustain: 0.22, release: NOTE_RELEASE },
    }).connect(this.reverb);
    this.instrument.maxPolyphony = 64;
    this.instrument.volume.value = -12;
  }

  /* --------------------------------------------------------------- */
  /* トランスポート設定                                                */
  /* --------------------------------------------------------------- */

  setTempo(bpm: number, sig: TimeSignature): void {
    Tone.getTransport().bpm.value = toQuarterBpm(bpm, sig);
  }

  setTimeSignature(sig: TimeSignature): void {
    Tone.getTransport().timeSignature = [sig.numerator, sig.denominator];
  }

  setLoop(enabled: boolean, totalStepCount: number): void {
    const transport = Tone.getTransport();
    transport.loop = enabled;
    transport.loopStart = 0;
    transport.loopEnd = `${totalStepCount * toneTicksPerStep()}i`;
  }

  /** ループ無効時に末尾で自動停止させるためのコールバック登録 */
  private endEventId: number | null = null;

  setEndOfProject(totalStepCount: number, onEnd: () => void): void {
    const transport = Tone.getTransport();
    if (this.endEventId !== null) transport.clear(this.endEventId);
    this.endEventId = transport.schedule(() => {
      if (!transport.loop) {
        transport.stop();
        transport.position = 0;
        Tone.getDraw().schedule(onEnd, Tone.now());
      }
    }, `${totalStepCount * toneTicksPerStep()}i`);
  }

  /* --------------------------------------------------------------- */
  /* ノートスケジューリング                                            */
  /* --------------------------------------------------------------- */

  setNotes(notes: ScheduledNote[]): void {
    this.pendingNotes = notes;
    if (!this.started || !this.instrument) return;

    this.part?.stop();
    this.part?.dispose();

    const ticksPerStep = toneTicksPerStep();
    const events: PartEvent[] = notes.map((n) => ({
      time: `${n.startStep * ticksPerStep}i`,
      midi: n.midi,
      lengthSteps: Math.max(1, n.lengthSteps),
      velocity: n.velocity ?? 0.8,
    }));

    this.part = new Tone.Part<PartEvent>((time, ev) => {
      const freq = Tone.Frequency(ev.midi, 'midi').toFrequency();
      const durationSec = Tone.Time(`${ev.lengthSteps * ticksPerStep}i`).toSeconds();
      this.instrument?.triggerAttackRelease(
        freq,
        Math.max(0.03, durationSec * 0.98),
        time,
        ev.velocity,
      );
    }, events);

    this.part.start(0);
  }

  /* --------------------------------------------------------------- */
  /* 再生制御                                                          */
  /* --------------------------------------------------------------- */

  play(): void {
    Tone.getTransport().start();
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.silenceNow();
  }

  /**
   * 鳴っている音を即座に消す。
   *
   * releaseAll() だけでは通常のリリース（1秒強）ぶん余韻が残り、
   * 停止したのに鳴り続けているように聞こえる。
   * リリースを一時的に詰めてから解放し、すぐ元の値へ戻す。
   */
  silenceNow(): void {
    const synth = this.instrument;
    if (!synth) return;

    synth.set({ envelope: { release: STOP_RELEASE } });
    synth.releaseAll();

    if (this.releaseRestoreTimer !== null) clearTimeout(this.releaseRestoreTimer);
    this.releaseRestoreTimer = setTimeout(() => {
      synth.set({ envelope: { release: NOTE_RELEASE } });
      this.releaseRestoreTimer = null;
    }, STOP_RELEASE * 1000 + 40);
  }

  /** 再生位置（32分音符単位、小数を含む） */
  currentStep(): number {
    return Tone.getTransport().ticks / toneTicksPerStep();
  }

  seekToStep(step: number): void {
    Tone.getTransport().ticks = Math.max(0, step) * toneTicksPerStep();
  }

  /* --------------------------------------------------------------- */
  /* プレビュー（鍵盤クリック / ノート配置時）                          */
  /* --------------------------------------------------------------- */

  async previewNotes(midis: number[], duration = 0.6): Promise<void> {
    await this.ensureStarted();
    if (!this.instrument || midis.length === 0) return;
    const freqs = midis.map((m) => Tone.Frequency(m, 'midi').toFrequency());
    this.instrument.triggerAttackRelease(freqs, duration, Tone.now(), 0.75);
  }

  setVolumeDb(db: number): void {
    if (this.instrument) this.instrument.volume.value = db;
  }
}

export const audioEngine = new AudioEngine();
