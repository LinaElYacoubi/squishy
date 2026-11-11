import { CONFIG } from '../config';
import { clamp } from './anim';
import type { Expression } from './creatureModel';

/**
 * Visual-only pose offsets for the idle greeting. The renderer adds these on top of the model;
 * they never change position, size, deformation or hit areas, so gameplay is unaffected.
 */
export interface GreetPose {
  /** Extra lean in radians (the wiggle). */
  lean: number;
  /** Look direction (-1..1) and how strongly it replaces the model's own look (0..1). */
  lookX: number;
  lookY: number;
  lookMix: number;
  /** Small upward bob, in body radii. */
  bob: number;
  /** Expression shown instead of the model's own, or null. */
  expression: Expression | null;
}

export const REST_POSE: Readonly<GreetPose> = Object.freeze({
  lean: 0,
  lookX: 0,
  lookY: 0,
  lookMix: 0,
  bob: 0,
  expression: null,
});

export interface IdleGreetingTiming {
  delayMs: number;
  greetMs: number;
  pauseMs: number;
}

/**
 * Welcoming attract loop: once no hand has been seen for a few seconds, alternate a short
 * greeting (curious look, playful wiggle, happy face) with quiet pauses. It stops the moment
 * a hand appears. Pure timing and pose maths: it never touches the game or plays sounds.
 */
export class IdleGreeting {
  private absentMs = 0;

  constructor(
    private timing: IdleGreetingTiming = {
      delayMs: CONFIG.idle.greetDelayMs,
      greetMs: CONFIG.idle.greetMs,
      pauseMs: CONFIG.idle.pauseMs,
    },
  ) {}

  /** Nobody has been seen for long enough: the welcome is being offered (greeting or pause). */
  get idle(): boolean {
    return this.absentMs >= this.timing.delayMs;
  }

  /** The greeting animation is playing right now (not in a quiet pause). */
  get greeting(): boolean {
    return this.idle && this.cycleMs < this.timing.greetMs;
  }

  /** Greeting progress 0..1, or -1 when not greeting. */
  get progress(): number {
    return this.greeting ? this.cycleMs / this.timing.greetMs : -1;
  }

  private get cycleMs(): number {
    return (this.absentMs - this.timing.delayMs) % (this.timing.greetMs + this.timing.pauseMs);
  }

  update(dtMs: number, handPresent: boolean): void {
    if (handPresent) this.absentMs = 0;
    else this.absentMs += Math.max(0, dtMs);
  }

  reset(): void {
    this.absentMs = 0;
  }

  /**
   * Pose for one creature. `offsetMs` staggers several creatures so they do not move in lockstep.
   * Returns REST_POSE whenever no greeting is playing.
   */
  pose(reduced: boolean, offsetMs = 0): GreetPose {
    if (!this.greeting) return REST_POSE;
    const { greetMs } = this.timing;
    const local = this.cycleMs - offsetMs;
    if (local < 0 || local >= greetMs) return REST_POSE;
    const p = local / greetMs;
    const sec = local / 1000;
    const c = CONFIG.idle;

    // Soft in/out so nothing jumps at the start or end of the greeting.
    const env = smoothstep(0, 0.12, p) * (1 - smoothstep(0.85, 1, p));

    // 1. Curious look: a peek to the side and up, then straight at the visitor.
    const peek = 1 - smoothstep(0.35, 0.55, p);
    const lookX = 0.55 * peek * Math.sin(sec * Math.PI * 1.4);
    const lookY = 0.35 * peek + 0.05;

    // 2. Playful wiggle in the middle of the greeting.
    const wig = smoothstep(0.2, 0.32, p) * (1 - smoothstep(0.7, 0.82, p));
    const amp = reduced ? c.reducedWiggleLean : c.wiggleLean;
    const hz = reduced ? c.reducedWiggleHz : c.wiggleHz;
    const lean = amp * wig * Math.sin(sec * Math.PI * 2 * hz);
    const bob = reduced ? 0 : 0.035 * wig * Math.abs(Math.sin(sec * Math.PI * 2 * hz));

    // 3. Happy face at the end.
    const expression: Expression = p < 0.6 ? 'curious' : 'happy';
    return { lean: lean * env, lookX, lookY, lookMix: clamp(env, 0, 1), bob: bob * env, expression };
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
