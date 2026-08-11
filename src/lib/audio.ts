/**
 * Tone.js を用いた再生エンジン。
 *
 * スケジューリングは Transport の tick 基準で行うため、
 * 再生中に BPM を変えても走っている音がずれない。
 *
 * 音源は2系統を持つ:
 *  - 内蔵シンセ（Tone.PolySynth）: ダウンロード不要で即鳴る。既定かつ読み込み中の代替。
 *  - サンプル音源（smplr）: Splendid Grand Piano と GM 128音色。
 *
 * どちらも同じ AudioContext・同じエフェクト経路に流すので、
 * 発音タイミングの扱いは共通のまま差し替えられる。
 */
import * as Tone from 'tone';
import { Soundfont, SplendidGrandPiano } from 'smplr';
import type { TimeSignature } from './grid';
import { SPLENDID_ID, SYNTH_ID, findInstrument } from './instruments';

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

/** smplr のインスタンス（必要な部分だけ） */
interface SampledInstrument {
  readonly ready: Promise<void>;
  start(event: { note: number; velocity?: number; time?: number; duration?: number }): unknown;
  stop(): void;
  dispose(): void;
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

/** 0〜1 のベロシティを MIDI の 0〜127 へ */
const toMidiVelocity = (velocity: number): number =>
  Math.max(1, Math.min(127, Math.round(velocity * 127)));

class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private reverb: Tone.Reverb | null = null;
  private master: Tone.Volume | null = null;
  private limiter: Tone.Limiter | null = null;
  /** サンプル音源をエフェクト経路へ入れるためのネイティブノード */
  private sampledBus: GainNode | null = null;

  private sampled: SampledInstrument | null = null;
  private instrumentId: string = SYNTH_ID;
  /** 読み込み完了前に別の音色へ切り替えられたかの判定に使う */
  private loadToken = 0;

  private part: Tone.Part<PartEvent> | null = null;
  private releaseRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private pendingNotes: ScheduledNote[] = [];
  private volumeDb = -12;

  /** ブラウザの自動再生制限のため、ユーザー操作の中から呼ぶこと */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.buildGraph();
    this.started = true;
    // init 前に設定されたノートを反映
    this.setNotes(this.pendingNotes);
  }

  get isReady(): boolean {
    return this.started;
  }

  private buildGraph(): void {
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Volume(this.volumeDb).connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.master);

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      // attack を伸ばし、かつ指数カーブにすることで音の立ち上がりの角を丸める
      // （直線カーブだと短い attack でも耳には「ハギング」な打撃音として聞こえる）
      envelope: {
        attack: 0.035,
        attackCurve: 'exponential',
        decay: 0.7,
        sustain: 0.22,
        release: NOTE_RELEASE,
      },
    }).connect(this.reverb);
    this.synth.maxPolyphony = 64;
    this.synth.volume.value = -6;

    // smplr はネイティブの AudioNode しか受け取らないので、
    // 中継用の GainNode を Tone のエフェクト経路へ差し込む
    const raw = Tone.getContext().rawContext;
    this.sampledBus = raw.createGain();
    Tone.connect(this.sampledBus, this.reverb);
  }

  /* --------------------------------------------------------------- */
  /* 音源の切り替え                                                    */
  /* --------------------------------------------------------------- */

  get currentInstrumentId(): string {
    return this.instrumentId;
  }

  /**
   * 音色を読み込んで差し替える。
   * 読み込みが終わるまでは内蔵シンセのまま鳴るので、操作は止まらない。
   */
  async loadInstrument(id: string): Promise<void> {
    if (id === this.instrumentId && (id === SYNTH_ID || this.sampled)) return;

    const token = ++this.loadToken;
    this.instrumentId = id;

    if (id === SYNTH_ID) {
      this.disposeSampled();
      return;
    }

    const preset = findInstrument(id);
    if (!preset) throw new Error(`未知の音色: ${id}`);

    await this.ensureStarted();
    const context = Tone.getContext().rawContext as BaseAudioContext;
    const destination = this.sampledBus ?? undefined;

    const instrument = (
      preset.kind === 'splendid' || id === SPLENDID_ID
        ? SplendidGrandPiano(context, { destination })
        : Soundfont(context, { instrument: preset.soundfont ?? id, destination })
    ) as unknown as SampledInstrument;

    try {
      await instrument.ready;
    } catch (error) {
      instrument.dispose();
      // 読み込みに失敗しても内蔵シンセで鳴り続ける
      if (token === this.loadToken) this.instrumentId = SYNTH_ID;
      throw error;
    }

    // 読み込み中に別の音色へ切り替えられていたら破棄する
    if (token !== this.loadToken) {
      instrument.dispose();
      return;
    }

    this.disposeSampled();
    this.sampled = instrument;
  }

  private disposeSampled(): void {
    if (!this.sampled) return;
    this.sampled.stop();
    this.sampled.dispose();
    this.sampled = null;
  }

  /* --------------------------------------------------------------- */
  /* 発音                                                             */
  /* --------------------------------------------------------------- */

  /** 現在の音源で1音鳴らす。time は AudioContext の絶対秒。 */
  private trigger(midi: number, durationSec: number, timeSec: number, velocity: number): void {
    const duration = Math.max(0.03, durationSec);
    if (this.sampled) {
      this.sampled.start({
        note: midi,
        velocity: toMidiVelocity(velocity),
        time: timeSec,
        duration,
      });
      return;
    }
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    this.synth?.triggerAttackRelease(freq, duration, timeSec, velocity);
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
    if (!this.started) return;

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
      const durationSec = Tone.Time(`${ev.lengthSteps * ticksPerStep}i`).toSeconds();
      // 音源の切り替えはここを通るたびに反映される
      this.trigger(ev.midi, durationSec * 0.98, time, ev.velocity);
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
   * 内蔵シンセは releaseAll() だけでは通常のリリース（1秒強）ぶん余韻が残り、
   * 停止したのに鳴り続けているように聞こえる。
   * リリースを一時的に詰めてから解放し、すぐ元の値へ戻す。
   */
  silenceNow(): void {
    this.sampled?.stop();

    const synth = this.synth;
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
    if (midis.length === 0) return;
    const now = Tone.now();
    for (const midi of midis) this.trigger(midi, duration, now, 0.75);
  }

  setVolumeDb(db: number): void {
    this.volumeDb = db;
    if (this.master) this.master.volume.value = db;
  }
}

export const audioEngine = new AudioEngine();
