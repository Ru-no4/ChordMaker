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
import { DEFAULT_SYNTH_OPTIONS, SPLENDID_ID, SYNTH_ID, findInstrument } from './instruments';

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
  /** 戻り値はそのノートを止めるための関数。duration は渡さず、自前で管理する。 */
  start(event: { note: number; velocity?: number; time?: number }): (time?: number) => void;
  stop(): void;
  dispose(): void;
}

/** 停止時に音を切るための短いリリース秒数 */
const STOP_RELEASE = 0.02;
/** 発音の最短時間。ごく短いノートでも音として聞こえるようにする下限。 */
const MIN_DURATION = 0.03;

/* ------------------------------------------------------------------ */
/* 音量の正規化                                                        */
/*                                                                      */
/* 音源によって「同じつもりで鳴らしても」聞こえ方の大きさが揃わない。      */
/* 原因は2つあるので、別々に補正する。                                   */
/*  1. 内蔵シンセの波形差 — 矩形波は三角波と同じピークでも実効値(RMS)が   */
/*     √3 倍あり、はっきり大きく聞こえる。これは波形の数式から厳密に      */
/*     計算できるので、波形ごとの固定トリム値で打ち消す。                 */
/*  2. サンプル音源ごとの録音レベル差 — GM 128音色や Splendid Grand      */
/*     Piano は元の収録レベルがバラバラなので、計算では出せない。         */
/*     そのため実際に鳴った音を計測し、内蔵シンセを基準にゲインを         */
/*     自動補正する（初回は基準値ぶんズレるが、以降のノートから揃う）。   */
/* ------------------------------------------------------------------ */

/** 内蔵シンセの基準音量（既定は三角波・正弦波の中間くらいを狙う） */
const BASE_SYNTH_VOLUME_DB = -6;

/**
 * 波形ごとの実効値(RMS)の違いを打ち消すトリム。三角波・のこぎり波を基準(0dB)に、
 * 矩形波は 20*log10((1/√3)/1) ≈ -4.8dB、正弦波は 20*log10((1/√3)/(1/√2)) ≈ -1.8dB。
 */
const WAVEFORM_TRIM_DB: Record<string, number> = {
  triangle: 0,
  sawtooth: 0,
  square: -4.8,
  sine: -1.8,
};

/** シンセの実測前に使う暫定の基準ラウドネス（三角波・-6dB・sustain 0.55 からの理論値） */
const FALLBACK_TARGET_RMS = 0.16;
/** ノート開始からどれだけ待って音量を計測するか（アタックの過渡を避ける） */
const CALIBRATION_DELAY_MS = 120;
/** 補正ゲインの許容範囲。極端な補正はノイズや無音の誤検出とみなして避ける。 */
const MIN_CORRECTION_GAIN = 0.15;
const MAX_CORRECTION_GAIN = 4;

/**
 * 鳴っている1音の後始末。
 *
 * `stop()` を呼ぶと消音する。呼び出しは1回だけにする — smplr の Voice.stop() は
 * 「最初の呼び出し以降は無視される（idempotent）」実装なので、発音時に
 * duration 付きで自動停止を仕込んでしまうと、後から止めたくても止められなくなる。
 * そのため自動停止は smplr の機能に任せず、常にこちらの setTimeout で管理する。
 */
interface ActiveVoice {
  timer: ReturnType<typeof setTimeout>;
  stop: () => void;
}

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
  /** サンプル音源の自動音量補正（音源ごとに学習したゲインを掛ける） */
  private sampledTrim: GainNode | null = null;
  /** 音量計測用の分岐先。音声経路そのものには影響しない。 */
  private sampledAnalyser: AnalyserNode | null = null;
  private synthAnalyser: AnalyserNode | null = null;
  /** 音源ID → 学習済みの補正ゲイン（線形） */
  private sampledGainCache = new Map<string, number>();
  /** 計測中の音源ID。二重に計測しないための見張り。 */
  private calibratingSampledId: string | null = null;
  /** 基準ラウドネス。内蔵シンセの実測値で自己補正される。 */
  private targetRms = FALLBACK_TARGET_RMS;
  private synthTargetCalibrated = false;

  private sampled: SampledInstrument | null = null;
  private instrumentId: string = SYNTH_ID;
  /** 読み込み完了前に別の音色へ切り替えられたかの判定に使う */
  private loadToken = 0;

  /** いま鳴っている（＝まだ止めていない）ノート。stop() で即座に全部止められるように追跡する。 */
  private activeVoices = new Set<ActiveVoice>();

  private part: Tone.Part<PartEvent> | null = null;
  private releaseRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  /** 現在の synth 系プリセットの通常リリース秒数（silenceNow からの復帰先） */
  private currentSynthRelease = DEFAULT_SYNTH_OPTIONS.envelope.release;
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

    // 初回再生前に synth 系プリセットへ切り替えられている場合があるので、
    // ここで初めて作る synth にもその設定を反映する
    // （切り替え時点では this.synth がまだ無く .set() が効かないため）。
    const activePreset = findInstrument(this.instrumentId);
    const synthOpts =
      activePreset?.kind === 'synth' ? (activePreset.synth ?? DEFAULT_SYNTH_OPTIONS) : DEFAULT_SYNTH_OPTIONS;
    this.currentSynthRelease = synthOpts.envelope.release;

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: synthOpts.oscillator,
      envelope: synthOpts.envelope,
    }).connect(this.reverb);
    this.synth.maxPolyphony = 64;
    this.synth.volume.value = BASE_SYNTH_VOLUME_DB + (WAVEFORM_TRIM_DB[synthOpts.oscillator.type] ?? 0);

    // smplr はネイティブの AudioNode しか受け取らないので、
    // 中継用の GainNode を Tone のエフェクト経路へ差し込む
    const raw = Tone.getContext().rawContext;

    // シンセの実測レベルを正規化の基準にする（音声経路には影響しない計測用の枝分かれ）
    this.synthAnalyser = raw.createAnalyser();
    this.synthAnalyser.fftSize = 4096;
    Tone.connect(this.synth, this.synthAnalyser);

    // サンプル音源は録音レベルがバラバラなので、間に補正用ゲインを挟む
    this.sampledBus = raw.createGain();
    this.sampledTrim = raw.createGain();
    this.sampledAnalyser = raw.createAnalyser();
    this.sampledAnalyser.fftSize = 4096;
    this.sampledBus.connect(this.sampledTrim);
    this.sampledTrim.connect(this.sampledAnalyser);
    Tone.connect(this.sampledTrim, this.reverb);
  }

  /** 直近 fftSize サンプルの実効値(RMS) */
  private measureRms(analyser: AnalyserNode): number {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  /** 内蔵シンセの実測値で基準ラウドネスを更新する（初回だけでよい。波形間の相対関係は理論値で揃っているため） */
  private maybeCalibrateSynthTarget(): void {
    if (this.synthTargetCalibrated || !this.synthAnalyser) return;
    this.synthTargetCalibrated = true;
    const analyser = this.synthAnalyser;
    setTimeout(() => {
      const measured = this.measureRms(analyser);
      if (measured > 0.001) this.targetRms = measured;
    }, CALIBRATION_DELAY_MS);
  }

  /** サンプル音源1つぶんの音量を、鳴った実音から自動で基準へ合わせる */
  private maybeCalibrateSampled(): void {
    const id = this.instrumentId;
    if (this.sampledGainCache.has(id) || this.calibratingSampledId === id) return;
    this.calibratingSampledId = id;
    const analyser = this.sampledAnalyser;
    const trim = this.sampledTrim;
    setTimeout(() => {
      this.calibratingSampledId = null;
      if (!analyser || !trim || this.instrumentId !== id) return; // 計測前に切り替えられた
      const measured = this.measureRms(analyser);
      if (measured <= 0.001) return; // 無音（発音失敗など）は補正しない
      const gain = Math.min(
        MAX_CORRECTION_GAIN,
        Math.max(MIN_CORRECTION_GAIN, this.targetRms / measured),
      );
      this.sampledGainCache.set(id, gain);
      trim.gain.setTargetAtTime(gain, Tone.now(), 0.05);
    }, CALIBRATION_DELAY_MS);
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
    const preset = findInstrument(id);
    if (!preset) throw new Error(`未知の音色: ${id}`);

    // synth 系（内蔵シンセ / 8bit プリセット）は波形とエンベロープを
    // 差し替えるだけで、ネットワーク読み込みが要らない。
    if (preset.kind === 'synth') {
      if (id === this.instrumentId && !this.sampled) return;
      this.instrumentId = id;
      this.disposeSampled();
      const opts = preset.synth ?? DEFAULT_SYNTH_OPTIONS;
      this.currentSynthRelease = opts.envelope.release;
      this.synth?.set({ oscillator: opts.oscillator, envelope: opts.envelope });
      if (this.synth) {
        this.synth.volume.value =
          BASE_SYNTH_VOLUME_DB + (WAVEFORM_TRIM_DB[opts.oscillator.type] ?? 0);
      }
      return;
    }

    if (id === this.instrumentId && this.sampled) return;

    const token = ++this.loadToken;
    this.instrumentId = id;

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

    // この音源で既に学習済みのゲインがあれば即適用。無ければ実音を鳴らした
    // ときに自動計測されるまで、収録レベルそのまま（ニュートラル）で鳴らす。
    const cached = this.sampledGainCache.get(id);
    this.sampledTrim?.gain.setTargetAtTime(cached ?? 1, Tone.now(), 0.01);
  }

  private disposeSampled(): void {
    if (!this.sampled) return;
    // この楽器に紐づくノートの停止タイマーは、対象が dispose 済みになると
    // 呼び出し時に例外を投げうるので、あわせて後始末する。
    for (const voice of this.activeVoices) {
      clearTimeout(voice.timer);
    }
    this.activeVoices.clear();
    this.sampled.stop();
    this.sampled.dispose();
    this.sampled = null;
  }

  /* --------------------------------------------------------------- */
  /* 発音                                                             */
  /* --------------------------------------------------------------- */

  /**
   * 現在の音源で1音鳴らす。time は AudioContext の絶対秒。
   *
   * 音源側の「duration 付き自動停止」には頼らない。smplr の Voice.stop() は
   * 一度呼ぶと以降の呼び出しを無視する実装なので、発音と同時に
   * 未来の停止を予約してしまうと、途中で即座に止めたくなったときに
   * 打つ手がなくなる（stop() を呼んでも無視される）。
   * かわりに自前の setTimeout でノート終了を管理し、stop() 側から
   * いつでもキャンセルして即座に打ち切れるようにする。
   */
  private trigger(midi: number, durationSec: number, timeSec: number, velocity: number): void {
    const duration = Math.max(MIN_DURATION, durationSec);
    const delayMs = Math.max(0, (timeSec - Tone.now() + duration) * 1000);

    if (this.sampled) {
      const instrument = this.sampled;
      const stopNote = instrument.start({
        note: midi,
        velocity: toMidiVelocity(velocity),
        time: timeSec,
      });
      this.maybeCalibrateSampled();
      const voice: ActiveVoice = {
        stop: () => {
          try {
            stopNote();
          } catch {
            // 楽器が切り替わって dispose 済みの可能性がある。無視して良い。
          }
        },
        timer: setTimeout(() => {
          this.activeVoices.delete(voice);
          voice.stop();
        }, delayMs),
      };
      this.activeVoices.add(voice);
      return;
    }

    const synth = this.synth;
    if (!synth) return;
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    synth.triggerAttack(freq, timeSec, velocity);
    this.maybeCalibrateSynthTarget();

    const voice: ActiveVoice = {
      stop: () => synth.triggerRelease(freq, Tone.now()),
      timer: setTimeout(() => {
        this.activeVoices.delete(voice);
        voice.stop();
      }, delayMs),
    };
    this.activeVoices.add(voice);
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
   * `activeVoices` に載っているノートは、それぞれの停止タイマーを
   * キャンセルしたうえで即座に止める（＝自然な終了を待たない）。
   * 内蔵シンセはさらに release を一時的に詰めてから止めることで、
   * 通常のリリース（1秒強）ぶんの余韻が残らないようにする。
   */
  silenceNow(): void {
    const synth = this.synth;
    if (synth) synth.set({ envelope: { release: STOP_RELEASE } });

    for (const voice of this.activeVoices) {
      clearTimeout(voice.timer);
      voice.stop();
    }
    this.activeVoices.clear();

    // 何らかの理由で追跡から漏れたボイスがあれば、ここで確実に止める
    synth?.releaseAll();
    this.sampled?.stop();

    if (synth) {
      if (this.releaseRestoreTimer !== null) clearTimeout(this.releaseRestoreTimer);
      const release = this.currentSynthRelease;
      this.releaseRestoreTimer = setTimeout(() => {
        synth.set({ envelope: { release } });
        this.releaseRestoreTimer = null;
      }, STOP_RELEASE * 1000 + 40);
    }
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
