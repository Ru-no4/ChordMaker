/**
 * Tone.js を用いた再生エンジン。
 *
 * スケジューリングは Transport の tick 基準で行うため、
 * 再生中に BPM を変えても走っている音がずれない。
 *
 * トラックごとに独立した発音経路（TrackChannel）を持つ。各チャンネルは
 *  - 内蔵シンセ（Tone.PolySynth）: ダウンロード不要で即鳴る。既定かつ読み込み中の代替。
 *  - サンプル音源（smplr）: Splendid Grand Piano と GM 128音色。
 * の2系統を own し、トラックごとに別の音源・音量で同時再生できる。
 * どのチャンネルも同じ AudioContext・共有の reverb/limiter/マスター音量へ
 * 合流するので、発音タイミングの扱いはチャンネルを跨いで共通のまま。
 */
import * as Tone from 'tone';
import { Soundfont, SplendidGrandPiano } from 'smplr';
import type { TimeSignature } from './grid';
import {
  DEFAULT_INSTRUMENT_ID,
  DEFAULT_SYNTH_OPTIONS,
  SPLENDID_ID,
  SYNTH_ID,
  findInstrument,
} from './instruments';

export interface ScheduledNote {
  midi: number;
  /** 32分音符単位の開始位置 */
  startStep: number;
  /** 32分音符単位の長さ */
  lengthSteps: number;
  velocity?: number;
}

/**
 * ループ中の発音をこの範囲（32分音符単位）に切り詰めるための情報。
 * - 範囲より前に始まって範囲にかかっているノートは、範囲の先頭から鳴らす
 *   （鳴っている途中から再生を始めても音が欠けない）。
 * - 範囲の終端をまたぐノートは、そこで打ち切る（ループして戻っても鳴り続けない）。
 * - 範囲に一切かからないノートはスケジュールしない。
 */
export interface LoopRange {
  startStep: number;
  endStep: number;
}

/** setTracks に渡す、トラック1本ぶんの再生データ */
export interface TrackNotes {
  trackId: string;
  notes: ScheduledNote[];
}

/**
 * setTracks の呼び出し元（useTransport）は、実際に変更の無いトラックについても
 * 毎回 notes 配列を作り直さず、同じ参照を渡すよう気を付けている
 * （ドラッグ中の pointermove のたびに全トラックの Tone.Part を作り直すと
 * 重くなるため）。ここではその参照の一致だけを見て「本当に変わったトラック」
 * を判定する — 中身の深い比較はしない（呼び出し元の責務）。
 */
function loopRangeEquals(a: LoopRange | null, b: LoopRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.startStep === b.startStep && a.endStep === b.endStep;
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
/*                                                                      */
/* 「基準ラウドネス」と「音源ID→補正ゲイン」はトラックを跨いだ共有状態    */
/* にする（同じ音源を2トラックが使っても2回目は再計測しない）。           */
/* 一方、計測用のアナライザーそのものはトラックごとの発音経路に個別に      */
/* 挟む必要がある（他トラックの同時発音が計測に混入するのを防ぐため）。   */
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
 * 1トラックのシンセに割り当てる最大同時発音数。
 * 単一トラック前提だった頃は64だったが、トラックが増えても単純にN倍にはせず、
 * まずはこの値を目安にし、実機での確認を経て調整する運用値とする。
 */
const TRACK_MAX_POLYPHONY = 16;

/** ミュート切り替え時のランプ時間（秒）。発音中に切り替えてもプチノイズが出ないようにする。 */
const MUTE_RAMP_SECONDS = 0.03;

/**
 * 鳴りうるトラック数 N に対する自動トリム量(dB)。
 * 等パワー減衰（-10*log10(N)）。無相関な音源同士が重なったときの
 * 体感音量の増加を打ち消す目安として使う。倍にしても4倍にはならない
 * 程度の緩めの補正で、意図的に音を重ねて盛り上げる余地は残す。
 */
const trackCountTrimDb = (count: number): number => -10 * Math.log10(Math.max(1, count));

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

/**
 * 1トラックぶんの発音経路。
 *
 * `buildNodes()` を呼ぶまでは実際の Tone/AudioNode を持たない軽量な入れ物で、
 * トラックの存在だけを先に登録できる（`ensureStarted()` 前でも
 * `setTracks`/`loadTrackInstrument`/`setTrackVolumeDb` を呼べるようにするため）。
 */
class TrackChannel {
  readonly id: string;
  built = false;
  volume: Tone.Volume | null = null;
  synth: Tone.PolySynth | null = null;
  sampled: SampledInstrument | null = null;
  /** smplr のインスタンスをエフェクト経路へ入れるためのネイティブノード */
  sampledBus: GainNode | null = null;
  /** サンプル音源の自動音量補正（音源ごとに学習したゲインを掛ける） */
  sampledTrim: GainNode | null = null;
  /** 音量計測用の分岐先。音声経路そのものには影響しない。 */
  sampledAnalyser: AnalyserNode | null = null;
  synthAnalyser: AnalyserNode | null = null;

  instrumentId: string = DEFAULT_INSTRUMENT_ID;
  volumeDb = 0;
  /** ミュート中か（ソロによる強制ミュートも含めた実効値。呼び出し元が計算して渡す） */
  muted = false;
  /** 読み込み完了前に別の音色へ切り替えられたかの判定に使う */
  loadToken = 0;
  /** 計測中の音源ID。二重に計測しないための見張り。 */
  calibratingSampledId: string | null = null;
  /** 現在の synth 系プリセットの通常リリース秒数（silenceNow からの復帰先） */
  currentSynthRelease = DEFAULT_SYNTH_OPTIONS.envelope.release;
  releaseRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  /** いま鳴っている（＝まだ止めていない）ノート */
  activeVoices = new Set<ActiveVoice>();
  part: Tone.Part<PartEvent> | null = null;
  /** buildNodes() 前に setTracks() が呼ばれた場合の待避先 */
  pendingNotes: ScheduledNote[] = [];

  constructor(id: string, volumeDb: number) {
    this.id = id;
    this.volumeDb = volumeDb;
  }

  dispose(): void {
    for (const voice of this.activeVoices) clearTimeout(voice.timer);
    this.activeVoices.clear();
    if (this.releaseRestoreTimer !== null) clearTimeout(this.releaseRestoreTimer);
    // stop() が稀に浮動小数点誤差で RangeError を投げることがある
    // （scheduleChannelPart 側の同じ対処のコメント参照）。無視して構わない。
    try {
      this.part?.stop();
    } catch {
      // 上記の理由により無視する
    }
    this.part?.dispose();
    this.synth?.dispose();
    this.sampled?.stop();
    this.sampled?.dispose();
    this.volume?.dispose();
  }
}

class AudioEngine {
  private reverb: Tone.Reverb | null = null;
  private master: Tone.Volume | null = null;
  private limiter: Tone.Limiter | null = null;
  /**
   * 鳴りうるトラック数に応じてマスター手前にかける自動トリム。
   * 各トラックのチャンネルフェーダーは既定0dB（素通し）で合算されるため、
   * トラックが増えるほど単純に信号が重なって大きくなる。マスターフェーダーは
   * 固定値でそれを補正しないので、このノードで別途補正する
   * （ユーザー操作用のマスター/チャンネルフェーダーはそのまま独立に残す）。
   */
  private trackCountTrim: Tone.Volume | null = null;
  private audibleTrackCount = 1;
  private volumeDb = -12;

  private channels = new Map<string, TrackChannel>();

  /** 音源ID → 学習済みの補正ゲイン（線形）。トラックを跨いで共有する。 */
  private sampledGainCache = new Map<string, number>();
  /** 基準ラウドネス。内蔵シンセの実測値で自己補正される。トラックを跨いで共有する。 */
  private targetRms = FALLBACK_TARGET_RMS;
  private synthTargetCalibrated = false;

  private started = false;
  private pendingLoopRange: LoopRange | null = null;

  /** ブラウザの自動再生制限のため、ユーザー操作の中から呼ぶこと */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.buildGraph();
    this.started = true;
    // init 前に登録されていたトラックのノードをここでまとめて作る
    for (const channel of this.channels.values()) {
      this.buildChannelNodes(channel);
    }
  }

  get isReady(): boolean {
    return this.started;
  }

  private buildGraph(): void {
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Volume(this.volumeDb).connect(this.limiter);
    this.trackCountTrim = new Tone.Volume(trackCountTrimDb(this.audibleTrackCount)).connect(
      this.master,
    );
    this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).connect(this.trackCountTrim);
  }

  /** トラックIDに対応するチャンネルを返す。無ければ（軽量な）入れ物を新設する。 */
  private getOrCreateChannel(trackId: string): TrackChannel {
    let channel = this.channels.get(trackId);
    if (!channel) {
      channel = new TrackChannel(trackId, 0);
      this.channels.set(trackId, channel);
      if (this.started) this.buildChannelNodes(channel);
    }
    return channel;
  }

  /** チャンネルの実際の Tone/AudioNode を組み立てる（ensureStarted 後、初回のみ）。 */
  private buildChannelNodes(channel: TrackChannel): void {
    if (channel.built || !this.reverb) return;
    channel.built = true;

    // ミュート中に構築される場合（まだ発音していないので即時でよい）
    channel.volume = new Tone.Volume(channel.muted ? -Infinity : channel.volumeDb).connect(this.reverb);

    // 初回構築前に synth 系プリセットへ切り替えられている場合があるので、
    // ここで初めて作る synth にもその設定を反映する。
    const activePreset = findInstrument(channel.instrumentId);
    const synthOpts =
      activePreset?.kind === 'synth' ? (activePreset.synth ?? DEFAULT_SYNTH_OPTIONS) : DEFAULT_SYNTH_OPTIONS;
    channel.currentSynthRelease = synthOpts.envelope.release;

    channel.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: synthOpts.oscillator,
      envelope: synthOpts.envelope,
    }).connect(channel.volume);
    channel.synth.maxPolyphony = TRACK_MAX_POLYPHONY;
    channel.synth.volume.value = BASE_SYNTH_VOLUME_DB + (WAVEFORM_TRIM_DB[synthOpts.oscillator.type] ?? 0);

    // smplr はネイティブの AudioNode しか受け取らないので、
    // 中継用の GainNode を Tone のエフェクト経路へ差し込む
    const raw = Tone.getContext().rawContext;

    // シンセの実測レベルを正規化の基準にする（音声経路には影響しない計測用の枝分かれ）
    channel.synthAnalyser = raw.createAnalyser();
    channel.synthAnalyser.fftSize = 4096;
    Tone.connect(channel.synth, channel.synthAnalyser);

    // サンプル音源は録音レベルがバラバラなので、間に補正用ゲインを挟む
    channel.sampledBus = raw.createGain();
    channel.sampledTrim = raw.createGain();
    channel.sampledAnalyser = raw.createAnalyser();
    channel.sampledAnalyser.fftSize = 4096;
    channel.sampledBus.connect(channel.sampledTrim);
    channel.sampledTrim.connect(channel.sampledAnalyser);
    Tone.connect(channel.sampledTrim, channel.volume);

    this.scheduleChannelPart(channel, this.pendingLoopRange);
  }

  /** 直近 fftSize サンプルの実効値(RMS) */
  private measureRms(analyser: AnalyserNode): number {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  /** 内蔵シンセの実測値で基準ラウドネスを更新する（全チャンネルで初回だけでよい） */
  private maybeCalibrateSynthTarget(channel: TrackChannel): void {
    if (this.synthTargetCalibrated || !channel.synthAnalyser) return;
    this.synthTargetCalibrated = true;
    const analyser = channel.synthAnalyser;
    setTimeout(() => {
      const measured = this.measureRms(analyser);
      if (measured > 0.001) this.targetRms = measured;
    }, CALIBRATION_DELAY_MS);
  }

  /** サンプル音源1つぶんの音量を、鳴った実音から自動で基準へ合わせる */
  private maybeCalibrateSampled(channel: TrackChannel): void {
    const id = channel.instrumentId;
    if (this.sampledGainCache.has(id) || channel.calibratingSampledId === id) return;
    channel.calibratingSampledId = id;
    const analyser = channel.sampledAnalyser;
    const trim = channel.sampledTrim;
    setTimeout(() => {
      channel.calibratingSampledId = null;
      if (!analyser || !trim || channel.instrumentId !== id) return; // 計測前に切り替えられた
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

  /** 指定トラックが現在鳴らしている音色ID */
  currentTrackInstrumentId(trackId: string): string {
    return this.channels.get(trackId)?.instrumentId ?? DEFAULT_INSTRUMENT_ID;
  }

  /**
   * 指定トラックの音色を読み込んで差し替える。
   * 読み込みが終わるまでは内蔵シンセのまま鳴るので、操作は止まらない。
   */
  async loadTrackInstrument(trackId: string, id: string): Promise<void> {
    const preset = findInstrument(id);
    if (!preset) throw new Error(`未知の音色: ${id}`);
    const channel = this.getOrCreateChannel(trackId);

    // synth 系（内蔵シンセ / 8bit プリセット）は波形とエンベロープを
    // 差し替えるだけで、ネットワーク読み込みが要らない。
    if (preset.kind === 'synth') {
      if (id === channel.instrumentId && !channel.sampled) return;
      channel.instrumentId = id;
      this.disposeSampled(channel);
      const opts = preset.synth ?? DEFAULT_SYNTH_OPTIONS;
      channel.currentSynthRelease = opts.envelope.release;
      channel.synth?.set({ oscillator: opts.oscillator, envelope: opts.envelope });
      if (channel.synth) {
        channel.synth.volume.value =
          BASE_SYNTH_VOLUME_DB + (WAVEFORM_TRIM_DB[opts.oscillator.type] ?? 0);
      }
      return;
    }

    if (id === channel.instrumentId && channel.sampled) return;

    const token = ++channel.loadToken;
    channel.instrumentId = id;

    await this.ensureStarted();
    const context = Tone.getContext().rawContext as BaseAudioContext;
    const destination = channel.sampledBus ?? undefined;

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
      if (token === channel.loadToken) channel.instrumentId = SYNTH_ID;
      throw error;
    }

    // 読み込み中に別の音色へ切り替えられていたら破棄する
    if (token !== channel.loadToken) {
      instrument.dispose();
      return;
    }

    this.disposeSampled(channel);
    channel.sampled = instrument;

    // この音源で既に学習済みのゲインがあれば即適用（他トラックの計測結果も含む）。
    // 無ければ実音を鳴らしたときに自動計測されるまで、収録レベルそのまま（ニュートラル）で鳴らす。
    const cached = this.sampledGainCache.get(id);
    channel.sampledTrim?.gain.setTargetAtTime(cached ?? 1, Tone.now(), 0.01);
  }

  private disposeSampled(channel: TrackChannel): void {
    if (!channel.sampled) return;
    // この楽器に紐づくノートの停止タイマーは、対象が dispose 済みになると
    // 呼び出し時に例外を投げうるので、あわせて後始末する。
    for (const voice of channel.activeVoices) {
      clearTimeout(voice.timer);
    }
    channel.activeVoices.clear();
    channel.sampled.stop();
    channel.sampled.dispose();
    channel.sampled = null;
  }

  /* --------------------------------------------------------------- */
  /* 発音                                                             */
  /* --------------------------------------------------------------- */

  /**
   * 指定チャンネルの現在の音源で1音鳴らす。time は AudioContext の絶対秒。
   *
   * 音源側の「duration 付き自動停止」には頼らない。smplr の Voice.stop() は
   * 一度呼ぶと以降の呼び出しを無視する実装なので、発音と同時に
   * 未来の停止を予約してしまうと、途中で即座に止めたくなったときに
   * 打つ手がなくなる（stop() を呼んでも無視される）。
   * かわりに自前の setTimeout でノート終了を管理し、stop() 側から
   * いつでもキャンセルして即座に打ち切れるようにする。
   */
  private trigger(
    channel: TrackChannel,
    midi: number,
    durationSec: number,
    timeSec: number,
    velocity: number,
  ): void {
    const duration = Math.max(MIN_DURATION, durationSec);
    const delayMs = Math.max(0, (timeSec - Tone.now() + duration) * 1000);

    if (channel.sampled) {
      const instrument = channel.sampled;
      const stopNote = instrument.start({
        note: midi,
        velocity: toMidiVelocity(velocity),
        time: timeSec,
      });
      this.maybeCalibrateSampled(channel);
      const voice: ActiveVoice = {
        stop: () => {
          try {
            stopNote();
          } catch {
            // 楽器が切り替わって dispose 済みの可能性がある。無視して良い。
          }
        },
        timer: setTimeout(() => {
          channel.activeVoices.delete(voice);
          voice.stop();
        }, delayMs),
      };
      channel.activeVoices.add(voice);
      return;
    }

    const synth = channel.synth;
    if (!synth) return;
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    synth.triggerAttack(freq, timeSec, velocity);
    this.maybeCalibrateSynthTarget(channel);

    const voice: ActiveVoice = {
      stop: () => synth.triggerRelease(freq, Tone.now()),
      timer: setTimeout(() => {
        channel.activeVoices.delete(voice);
        voice.stop();
      }, delayMs),
    };
    channel.activeVoices.add(voice);
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

  setLoop(enabled: boolean, loopStartStep: number, loopEndStep: number): void {
    const transport = Tone.getTransport();
    transport.loop = enabled;
    transport.loopStart = `${loopStartStep * toneTicksPerStep()}i`;
    transport.loopEnd = `${loopEndStep * toneTicksPerStep()}i`;
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

  /** 1チャンネルぶんの Tone.Part を、そのチャンネルの pendingNotes から作り直す */
  private scheduleChannelPart(channel: TrackChannel, loopRange: LoopRange | null): void {
    if (!channel.built) return;

    // 稀に Tone 内部の時刻計算が浮動小数点誤差でごく僅かに負値になり、
    // stop() が RangeError を投げることがある（同じ Part を何度も
    // 立て直すたびに起こりうる）。無視して構わない — どのみち直後に
    // dispose して新しい Part を作り直すだけなので、停止処理自体の成否は
    // 結果に影響しない。
    try {
      channel.part?.stop();
    } catch {
      // 上記の理由により無視する
    }
    channel.part?.dispose();

    const ticksPerStep = toneTicksPerStep();
    const events: PartEvent[] = [];
    for (const n of channel.pendingNotes) {
      let start = n.startStep;
      let end = start + Math.max(1, n.lengthSteps);
      if (loopRange) {
        start = Math.max(start, loopRange.startStep);
        end = Math.min(end, loopRange.endStep);
        if (end <= start) continue; // ループ範囲に一切かからない音は鳴らさない
      }
      events.push({
        time: `${start * ticksPerStep}i`,
        midi: n.midi,
        lengthSteps: end - start,
        velocity: n.velocity ?? 0.8,
      });
    }

    channel.part = new Tone.Part<PartEvent>((time, ev) => {
      const durationSec = Tone.Time(`${ev.lengthSteps * ticksPerStep}i`).toSeconds();
      // 音源の切り替えはここを通るたびに反映される
      this.trigger(channel, ev.midi, durationSec * 0.98, time, ev.velocity);
    }, events);

    channel.part.start(0);
  }

  /**
   * loopRange を渡すと、そのループの間だけ発音をその範囲に切り詰めてスケジュールする。
   * これにより「範囲の途中から鳴っているはずの音が頭から聞こえない」
   * 「範囲の終端をまたぐ音がループしても鳴り続ける」という2つの問題を避ける。
   * ループしていない（loopRange が null）ときは従来通り、ノート本来の長さで鳴らす。
   *
   * `tracks` に含まれなくなったトラック（削除された）のチャンネルはここで破棄する。
   */
  setTracks(tracks: TrackNotes[], loopRange: LoopRange | null = null): void {
    // ループ範囲が変わったときは、範囲による切り詰め方が全チャンネルに
    // 影響するので、ノートに変更が無いチャンネルも含めて全部作り直す必要がある。
    const loopRangeChanged = !loopRangeEquals(this.pendingLoopRange, loopRange);
    this.pendingLoopRange = loopRange;

    const seen = new Set<string>();
    for (const t of tracks) {
      seen.add(t.trackId);
      const channel = this.getOrCreateChannel(t.trackId);
      // notes が前回と同じ参照（＝そのトラックの中身は変わっていない）で、
      // ループ範囲も変わっていなければ、この Part を作り直す必要は無い。
      // ノートをドラッグしている間、動かしていない他トラックの Tone.Part まで
      // 毎フレーム stop/dispose/再構築してしまう（重い）のを避けるための判定。
      if (channel.pendingNotes === t.notes && !loopRangeChanged) continue;
      channel.pendingNotes = t.notes;
      this.scheduleChannelPart(channel, loopRange);
    }

    for (const [id, channel] of [...this.channels]) {
      if (!seen.has(id)) {
        channel.dispose();
        this.channels.delete(id);
      }
    }
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
   * 鳴っている音を即座に消す（全トラック分）。
   *
   * 各チャンネルの `activeVoices` に載っているノートは、それぞれの停止タイマーを
   * キャンセルしたうえで即座に止める（＝自然な終了を待たない）。
   * 内蔵シンセはさらに release を一時的に詰めてから止めることで、
   * 通常のリリース（1秒強）ぶんの余韻が残らないようにする。
   */
  silenceNow(): void {
    for (const channel of this.channels.values()) {
      const synth = channel.synth;
      if (synth) synth.set({ envelope: { release: STOP_RELEASE } });

      for (const voice of channel.activeVoices) {
        clearTimeout(voice.timer);
        voice.stop();
      }
      channel.activeVoices.clear();

      // 何らかの理由で追跡から漏れたボイスがあれば、ここで確実に止める
      synth?.releaseAll();
      channel.sampled?.stop();

      if (synth) {
        if (channel.releaseRestoreTimer !== null) clearTimeout(channel.releaseRestoreTimer);
        const release = channel.currentSynthRelease;
        channel.releaseRestoreTimer = setTimeout(() => {
          synth.set({ envelope: { release } });
          channel.releaseRestoreTimer = null;
        }, STOP_RELEASE * 1000 + 40);
      }
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

  async previewNotes(trackId: string, midis: number[], duration = 0.6): Promise<void> {
    await this.ensureStarted();
    if (midis.length === 0) return;
    const channel = this.getOrCreateChannel(trackId);
    const now = Tone.now();
    for (const midi of midis) this.trigger(channel, midi, duration, now, 0.75);
  }

  /** マスターフェーダー。個々のトラック音量は setTrackVolumeDb を使う。 */
  setVolumeDb(db: number): void {
    this.volumeDb = db;
    if (this.master) this.master.volume.value = db;
  }

  /** トラック単位のチャンネルフェーダー */
  setTrackVolumeDb(trackId: string, db: number): void {
    const channel = this.getOrCreateChannel(trackId);
    channel.volumeDb = db;
    // ミュート中は実際のノードには反映しない（-Infinity のまま）。
    // 値だけ覚えておき、ミュート解除時にその値へ戻す。
    if (channel.volume && !channel.muted) channel.volume.volume.value = db;
  }

  /**
   * トラック単位のミュート。呼び出し元（useTransport）でソロによる強制ミュートも
   * 含めた実効値を計算して渡す想定。
   *
   * Tone.Volume 標準の `mute` セッターはランプ無しで即座に -Infinity へ
   * ジャンプする実装になっており（Tone.js 本体のソースで確認済み）、発音中に
   * 切り替えるとプチノイズの原因になる。そのため `mute` プロパティは使わず、
   * `volume.rampTo()` で滑らかに切り替える。
   */
  setTrackMuted(trackId: string, muted: boolean): void {
    const channel = this.getOrCreateChannel(trackId);
    if (channel.muted === muted) return;
    channel.muted = muted;
    if (!channel.volume) return; // 未構築ならビルド時に channel.muted を見て反映される
    channel.volume.volume.rampTo(muted ? -Infinity : channel.volumeDb, MUTE_RAMP_SECONDS);
  }

  /**
   * 現在ミュートされておらず、かつノートを持つ（＝実際に鳴りうる）トラックの数を
   * 呼び出し元（useTransport）から渡してもらい、マスター手前の自動トリムへ反映する。
   * トラックの追加/削除やミュート切り替えのたびに呼ばれる程度の頻度なので、
   * 短いランプで十分（プチノイズ回避）。
   */
  setAudibleTrackCount(count: number): void {
    const next = Math.max(1, Math.round(count));
    if (this.audibleTrackCount === next) return;
    this.audibleTrackCount = next;
    if (!this.trackCountTrim) return; // 未構築なら buildGraph 時に audibleTrackCount を見て反映される
    this.trackCountTrim.volume.rampTo(trackCountTrimDb(next), MUTE_RAMP_SECONDS);
  }
}

export const audioEngine = new AudioEngine();
