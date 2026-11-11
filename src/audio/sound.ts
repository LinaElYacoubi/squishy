import { CONFIG } from '../config';

export type SoundName =
  | 'grab'
  | 'drop'
  | 'throw'
  | 'bounce'
  | 'feed'
  | 'merge'
  /** A bubble or button was pinched. */
  | 'select'
  /** A Squishy Says bubble lights up or is answered (pitch varies per bubble). */
  | 'chime'
  | 'pop'
  /** Silly "whoops" for a wrong answer or a miss. */
  | 'oops'
  | 'cheer'
  | 'hello'
  | 'purr'
  | 'hiccup'
  | 'sparkle'
  | 'nope'
  | 'giggle'
  | 'dizzy';

/**
 * off:         the visitor or operator muted the sounds
 * locked:      sounds are on, but the browser needs a click or key press before audio may start
 * on:          sounds can play
 * unavailable: sounds are on, but this browser cannot create Web Audio
 */
export type SoundState = 'off' | 'locked' | 'on' | 'unavailable';

/** Creates the audio context. Returns null (or throws) when Web Audio is not available. */
export type AudioContextFactory = () => AudioContext | null;

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/** One soft tone: a pitch glide with a short attack and an exponential fade. */
interface Tone {
  from: number;
  to: number;
  /** Delay after the sound starts, and duration, in seconds. */
  at: number;
  dur: number;
  type: OscillatorType;
  vol: number;
}

/** Cute, short, quiet sounds. All are simple sine/triangle glides, so they stay gentle. */
const RECIPES: Record<SoundName, Tone[]> = {
  // A small rising "boop".
  grab: [{ from: 520, to: 820, at: 0, dur: 0.09, type: 'sine', vol: 0.55 }],
  // A soft falling "plop".
  drop: [{ from: 620, to: 360, at: 0, dur: 0.12, type: 'sine', vol: 0.45 }],
  // "Wheee": up, then a little down.
  throw: [
    { from: 420, to: 980, at: 0, dur: 0.14, type: 'triangle', vol: 0.35 },
    { from: 980, to: 760, at: 0.13, dur: 0.1, type: 'sine', vol: 0.25 },
  ],
  // A low jelly "bloop"; volume follows the impact strength.
  bounce: [{ from: 300, to: 170, at: 0, dur: 0.09, type: 'sine', vol: 0.6 }],
  // "Nom nom" and a tiny sparkle.
  feed: [
    { from: 440, to: 400, at: 0, dur: 0.08, type: 'triangle', vol: 0.4 },
    { from: 520, to: 470, at: 0.12, dur: 0.08, type: 'triangle', vol: 0.4 },
    { from: 1320, to: 1560, at: 0.24, dur: 0.12, type: 'sine', vol: 0.18 },
  ],
  // A happy little up-arpeggio.
  merge: [
    { from: 523, to: 523, at: 0, dur: 0.1, type: 'sine', vol: 0.35 },
    { from: 659, to: 659, at: 0.08, dur: 0.1, type: 'sine', vol: 0.35 },
    { from: 784, to: 800, at: 0.16, dur: 0.18, type: 'sine', vol: 0.35 },
  ],
  select: [{ from: 660, to: 990, at: 0, dur: 0.08, type: 'sine', vol: 0.4 }],
  chime: [
    { from: 660, to: 660, at: 0, dur: 0.22, type: 'sine', vol: 0.4 },
    { from: 1320, to: 1320, at: 0, dur: 0.16, type: 'sine', vol: 0.1 },
  ],
  // A soft bubble "pop": a quick upward blip.
  pop: [
    { from: 380, to: 1400, at: 0, dur: 0.06, type: 'sine', vol: 0.5 },
    { from: 1500, to: 1700, at: 0.05, dur: 0.06, type: 'sine', vol: 0.15 },
  ],
  // "Whoops": a wobbly slide down.
  oops: [
    { from: 520, to: 300, at: 0, dur: 0.18, type: 'triangle', vol: 0.35 },
    { from: 340, to: 380, at: 0.18, dur: 0.14, type: 'triangle', vol: 0.3 },
  ],
  // Little fanfare.
  cheer: [
    { from: 523, to: 523, at: 0, dur: 0.1, type: 'triangle', vol: 0.3 },
    { from: 659, to: 659, at: 0.1, dur: 0.1, type: 'triangle', vol: 0.3 },
    { from: 784, to: 784, at: 0.2, dur: 0.1, type: 'triangle', vol: 0.3 },
    { from: 1046, to: 1060, at: 0.3, dur: 0.28, type: 'sine', vol: 0.35 },
  ],
  // "Hi!": two notes up.
  hello: [
    { from: 600, to: 640, at: 0, dur: 0.09, type: 'sine', vol: 0.35 },
    { from: 800, to: 900, at: 0.11, dur: 0.12, type: 'sine', vol: 0.35 },
  ],
  // Contented hum.
  purr: [{ from: 240, to: 260, at: 0, dur: 0.35, type: 'triangle', vol: 0.25 }],
  hiccup: [{ from: 700, to: 1100, at: 0, dur: 0.06, type: 'sine', vol: 0.4 }],
  sparkle: [
    { from: 1320, to: 1400, at: 0, dur: 0.08, type: 'sine', vol: 0.2 },
    { from: 1568, to: 1640, at: 0.07, dur: 0.08, type: 'sine', vol: 0.2 },
    { from: 1976, to: 2100, at: 0.14, dur: 0.14, type: 'sine', vol: 0.18 },
  ],
  // "Nuh-uh": two low notes.
  nope: [
    { from: 330, to: 310, at: 0, dur: 0.1, type: 'triangle', vol: 0.3 },
    { from: 300, to: 260, at: 0.14, dur: 0.12, type: 'triangle', vol: 0.3 },
  ],
  giggle: [
    { from: 900, to: 1000, at: 0, dur: 0.05, type: 'sine', vol: 0.25 },
    { from: 950, to: 1050, at: 0.08, dur: 0.05, type: 'sine', vol: 0.25 },
    { from: 1000, to: 1100, at: 0.16, dur: 0.06, type: 'sine', vol: 0.25 },
  ],
  // Woozy wobble.
  dizzy: [
    { from: 500, to: 420, at: 0, dur: 0.16, type: 'sine', vol: 0.25 },
    { from: 470, to: 390, at: 0.16, dur: 0.16, type: 'sine', vol: 0.22 },
    { from: 440, to: 360, at: 0.32, dur: 0.2, type: 'sine', vol: 0.2 },
  ],
};

function defaultFactory(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * Playful sound effects synthesized with Web Audio (no audio files are downloaded).
 *
 * Muted by default. The audio context is only created inside unlock(), which must be called
 * from a click or key handler: browsers refuse to start audio otherwise, and a webcam gesture
 * is not a user activation. Everything degrades silently if audio is unavailable.
 */
export class SoundFx {
  onStateChange?: (state: SoundState) => void;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private failed = false;
  private hidden = false;
  private voices = new Set<Voice>();
  private lastPlayed = new Map<SoundName, number>();
  private bounceTimes: number[] = [];

  constructor(
    private enabled = false,
    private factory: AudioContextFactory = defaultFactory,
    private now: () => number = () => performance.now(),
  ) {}

  get state(): SoundState {
    if (!this.enabled) return 'off';
    if (this.failed) return 'unavailable';
    return this.ctx && this.ctx.state === 'running' ? 'on' : 'locked';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Number of tones currently scheduled or playing (diagnostics and tests). */
  get activeVoices(): number {
    return this.voices.size;
  }

  /**
   * Create or resume the audio context. Call only from a click or keyboard handler.
   * Does nothing while muted.
   */
  unlock(): void {
    if (!this.enabled || this.hidden || this.failed) return;
    if (!this.ctx) {
      try {
        this.ctx = this.factory();
      } catch {
        this.ctx = null;
      }
      if (!this.ctx) {
        this.failed = true;
        this.notify();
        return;
      }
      try {
        this.master = this.ctx.createGain();
        this.master.gain.value = CONFIG.sound.masterVolume;
        this.master.connect(this.ctx.destination);
        this.ctx.onstatechange = () => this.notify();
      } catch {
        this.failSafe();
        return;
      }
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().then(
        () => this.notify(),
        () => this.notify(),
      );
    }
    this.notify();
  }

  /** Turn sounds on or off. Pass fromUserAction only when called from a click or key handler. */
  setEnabled(on: boolean, fromUserAction: boolean): void {
    this.enabled = on;
    if (!on) {
      this.stopAll();
      this.suspend();
    } else if (fromUserAction) {
      this.unlock();
    }
    this.notify();
  }

  /** Page hidden: stop everything and suspend. Visible again: resume if it was already unlocked. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) {
      this.stopAll();
      this.suspend();
    } else if (this.enabled && this.ctx && this.ctx.state !== 'closed') {
      this.ctx.resume().then(
        () => this.notify(),
        () => this.notify(),
      );
    }
  }

  /**
   * Play a sound. `strength` (0..1) scales the volume (used for bounces); `pitch` multiplies every
   * frequency (Squishy Says gives each bubble its own note). Returns true if it played.
   */
  play(name: SoundName, strength = 1, pitch = 1): boolean {
    const ctx = this.ctx;
    if (!this.enabled || this.hidden || !ctx || !this.master || ctx.state !== 'running') return false;
    const s = CONFIG.sound;
    const t = this.now();
    if (t - (this.lastPlayed.get(name) ?? -Infinity) < s.minIntervalMs[name]) return false;
    if (name === 'bounce') {
      if (strength < s.minBounceStrength) return false;
      this.bounceTimes = this.bounceTimes.filter((b) => t - b < 1000);
      if (this.bounceTimes.length >= s.bouncesPerSecond) return false;
    }
    const tones = RECIPES[name];
    if (this.voices.size + tones.length > s.maxVoices) return false;

    this.lastPlayed.set(name, t);
    if (name === 'bounce') this.bounceTimes.push(t);
    const vol = Math.min(1, Math.max(0, strength));
    try {
      for (const tone of tones) this.tone(ctx, this.master, tone, vol, pitch);
    } catch {
      // A broken audio graph must never break the game.
      return false;
    }
    return true;
  }

  /** Stop all sounds immediately. */
  stopAll(): void {
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(0);
        v.gain.gain.value = 0;
        v.osc.onended = null;
        v.osc.stop();
      } catch {
        // Already stopped.
      }
      this.release(v);
    }
    this.voices.clear();
  }

  dispose(): void {
    this.stopAll();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) {
      ctx.onstatechange = null;
      ctx.close().catch(() => undefined);
    }
    this.onStateChange = undefined;
  }

  private tone(ctx: AudioContext, out: GainNode, tone: Tone, strength: number, pitch = 1): void {
    const t0 = ctx.currentTime + tone.at;
    const end = t0 + tone.dur;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.from * pitch, t0);
    if (tone.to !== tone.from) osc.frequency.exponentialRampToValueAtTime(tone.to * pitch, end);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(tone.vol * strength, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(out);
    const voice: Voice = { osc, gain };
    this.voices.add(voice);
    osc.onended = () => {
      this.voices.delete(voice);
      this.release(voice);
    };
    osc.start(t0);
    osc.stop(end + 0.03);
  }

  private release(v: Voice): void {
    try {
      v.osc.disconnect();
      v.gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private suspend(): void {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  private failSafe(): void {
    this.failed = true;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    ctx?.close().catch(() => undefined);
    this.notify();
  }

  private notify(): void {
    this.onStateChange?.(this.state);
  }
}
