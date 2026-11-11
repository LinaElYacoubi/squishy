import { CONFIG } from '../config';
import { Spring, approach, clamp, easeInOut, lerp } from './anim';
import { REST_POSE, type GreetPose } from './idleGreeting';

/**
 * Distance from the body's centre to its flattened base, in body radii.
 * Shared with the renderer so hit testing and visuals agree.
 */
export const BODY_BOTTOM = 0.86;

export type Expression =
  | 'neutral'
  | 'curious'
  | 'surprised'
  | 'happy'
  | 'cheeky'
  | 'hungry'
  /** Spiral eyes after a big bounce (secret reaction). */
  | 'dizzy'
  /** Eyes closed, relaxed smile (being petted). */
  | 'content'
  /** Crossed eyes and a lopsided grin (a silly miss or a wrong answer). */
  | 'goofy'
  /** Big eyes, open grin (anticipation before a toss, a lit bubble). */
  | 'excited'
  /** Eyes closed, small open mouth (dozing off after a long pet). */
  | 'sleepy';

/** How a creature last became airborne: thrown, dropped slowly, or let go because the hand was lost. */
export type Launch = 'throw' | 'drop' | 'lost' | null;

/** Temporary Merge Magic looks. */
export type MagicLook = 'star' | 'ocean' | 'galaxy';

/**
 * free:     on the floor, idle behaviour and dodging allowed
 * grabbed:  held by the visitor (only one creature at a time)
 * airborne: thrown, dropped or falling; simple bouncing physics
 * merging / splitting: part of a short scripted sequence, not interactive
 */
export type Motion = 'free' | 'grabbed' | 'airborne' | 'merging' | 'splitting';

/** sRGB colour, components 0..1. */
export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 2x2 body deformation in the screen plane plus a depth scale. Maps local (x, y) to (a x + b y, c x + d y). */
export interface Deform {
  a: number;
  b: number;
  c: number;
  d: number;
  z: number;
}

interface Hop {
  phase: 'anticipate' | 'air';
  t: number;
  anticipation: number;
  duration: number;
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  height: number;
}

/**
 * Animation state for one jelly creature. Pure data plus small helpers; the renderer reads it
 * every frame and never writes back. Position (x, y) is the point where the body would touch
 * the floor (the bottom of the undeformed body).
 */
export class CreatureModel {
  alive = false;
  motion: Motion = 'free';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** Size relative to the main creature's radius; the world radius is derived from the stage. */
  radiusFactor = 1;
  radius = 1;
  color: RGB = [1, 0.5, 0.8];
  tint: RGB = [1, 1, 1];
  tintAmount = 0;

  /** Presence scale (0..1+) for appearing, disappearing and size changes. */
  grow = new Spring(1, 1, 220, 16);
  /** Temporary puff-up after eating. */
  puff = new Spring(1, 1, 30, 5);
  /** Vertical squash; horizontal scale preserves volume. Underdamped for a jelly wobble. */
  squash = new Spring(1, 1, 260, 9);
  /** Signed stretch along stretchAxis (negative = squeezed). Underdamped for the release wobble. */
  stretch = new Spring(0, 0, 150, 7);
  stretchAxisX = 0;
  stretchAxisY = 1;
  /** Body lean in radians (positive leans left). */
  lean = new Spring(0, 0, 60, 11);

  lookX = 0;
  lookY = 0;
  lookTargetX = 0;
  lookTargetY = 0;
  /** 0 = open, 1 = closed. */
  blink = 0;
  /** Expression when no short reaction is playing. */
  baseExpression: Expression = 'neutral';
  shiver = 0;
  /** Seconds since this model was created; drives reaction timers. */
  clock = 0;
  /** Timers used by the game (in this model's clock). */
  nextIdleAt = 3;
  nextLookAt = 0;
  chewUntil = 0;
  /**
   * Idle greeting pose, set by the app each frame. Visual only: the renderer adds it on top of
   * the model; gameplay, physics and hit testing never read it.
   */
  greet: Readonly<GreetPose> = REST_POSE;

  /** How this creature became airborne (cleared when it lands). Lost-hand drops never count as throws. */
  launch: Launch = null;
  /** Seconds the current grab has lasted. */
  heldFor = 0;
  /** Bounces and hardest impact (0..1) since the last release. */
  bounces = 0;
  hardestImpact = 0;
  /** 0..1: relaxed by petting (lower squash, rosier cheeks). Visual only. */
  relax = 0;
  /** Temporary Merge Magic look and its remaining strength (0..1, fades out at the end). */
  magic: MagicLook | null = null;
  magicUntil = 0;

  private reaction: Expression | null = null;
  private wiggleUntil = 0;
  private wiggleAmp = 0;
  private wiggleHz = 0;
  private wiggleStart = 0;
  private reactionUntil = 0;
  private lookHoldUntil = 0;
  private tintFadeRate = 0;
  private hop: Hop | null = null;
  private blinkTimer = 2;
  private blinkPhase = -1;
  private breathePhase: number;
  private wobbleScale = 1;
  private maxStretch: number = CONFIG.grab.maxStretch;

  constructor(
    readonly slot: number,
    private rng: () => number,
  ) {
    this.breathePhase = rng() * Math.PI * 2;
    this.blinkTimer = 1 + rng() * 3;
  }

  get isHopping(): boolean {
    return this.hop !== null;
  }

  get chewing(): boolean {
    return this.clock < this.chewUntil;
  }

  get expression(): Expression {
    return this.reaction && this.clock < this.reactionUntil ? this.reaction : this.baseExpression;
  }

  /** Current visible radius. */
  get size(): number {
    return this.radius * Math.max(0, this.grow.value) * Math.max(0.5, this.puff.value);
  }

  /** Vertical squash including breathing. */
  get scaleY(): number {
    return Math.max(0.35, this.squash.value + Math.sin(this.breathePhase) * 0.022 * this.wobbleScale);
  }

  /** Squash combined with the directional stretch, in the screen plane. */
  deform(): Deform {
    const sy = this.scaleY;
    const sx = 1 / Math.sqrt(sy);
    const s = 1 + clamp(this.stretch.value, -CONFIG.grab.maxCompress, this.maxStretch);
    const p = 1 / Math.sqrt(s);
    const ux = this.stretchAxisX;
    const uy = this.stretchAxisY;
    const m11 = p + (s - p) * ux * ux;
    const m12 = (s - p) * ux * uy;
    const m22 = p + (s - p) * uy * uy;
    return { a: m11 * sx, b: m12 * sy, c: m12 * sx, d: m22 * sy, z: sx * p };
  }

  /** World-space body centre. */
  get centerY(): number {
    return this.y + this.size * BODY_BOTTOM * this.deform().d;
  }

  /** World-space mouth position (used for feeding). */
  get mouthY(): number {
    const d = this.deform();
    return this.centerY - 0.12 * this.size * d.d;
  }

  setWobbleScale(s: number): void {
    this.wobbleScale = s;
  }

  setMaxStretch(s: number): void {
    this.maxStretch = s;
  }

  /** Jelly impulse: negative = squash, positive = stretch upward. */
  kick(amount: number): void {
    this.squash.velocity += amount * this.wobbleScale;
  }

  /** Play a short expression, then return to the base expression. */
  react(expr: Expression, seconds: number): void {
    this.reaction = expr;
    this.reactionUntil = this.clock + seconds;
  }

  /** Currently playing short reaction, if any. */
  get reactionExpression(): Expression | null {
    return this.reaction && this.clock < this.reactionUntil ? this.reaction : null;
  }

  /**
   * A side-to-side wiggle (happy wiggle, head shake, goofy wobble). Visual only: the renderer adds
   * `wiggleLean` to the body lean; position and hit areas are unchanged.
   */
  wiggle(seconds: number, amplitude: number, hz: number): void {
    this.wiggleStart = this.clock;
    this.wiggleUntil = this.clock + seconds;
    this.wiggleAmp = amplitude * this.wobbleScale;
    this.wiggleHz = hz;
  }

  get wiggling(): boolean {
    return this.clock < this.wiggleUntil;
  }

  get wiggleLean(): number {
    if (this.clock >= this.wiggleUntil) return 0;
    const t = this.clock - this.wiggleStart;
    const total = this.wiggleUntil - this.wiggleStart;
    const env = Math.min(1, t / 0.12) * Math.min(1, (total - t) / 0.25);
    return this.wiggleAmp * env * Math.sin(t * Math.PI * 2 * this.wiggleHz);
  }

  /** Strength of the Merge Magic look (0..1), fading out over its last second. */
  get magicAmount(): number {
    if (!this.magic) return 0;
    return clamp(this.magicUntil - this.clock, 0, 1);
  }

  setMagic(look: MagicLook, seconds: number): void {
    this.magic = look;
    this.magicUntil = this.clock + seconds;
  }

  /** Quick surprised blink (after a bounce or merge). */
  surpriseBlink(): void {
    this.react('surprised', 0.35);
    this.blinkPhase = 0.15;
  }

  /** Look in a fixed direction for a while, ignoring other look targets. */
  holdLook(x: number, y: number, seconds: number): void {
    this.lookTargetX = clamp(x, -1, 1);
    this.lookTargetY = clamp(y, -1, 1);
    this.lookHoldUntil = this.clock + seconds;
  }

  get lookHeld(): boolean {
    return this.clock < this.lookHoldUntil;
  }

  setTint(rgb: RGB, amount: number, fadeSeconds: number): void {
    this.tint = rgb;
    this.tintAmount = amount;
    this.tintFadeRate = amount / Math.max(0.1, fadeSeconds);
  }

  /** Clear every transient effect (used by reset). */
  clearEffects(): void {
    this.cancelHop();
    this.vx = this.vy = 0;
    this.grow.snap(1);
    this.puff.snap(1);
    this.squash.snap(1);
    this.stretch.snap(0);
    this.lean.snap(0);
    this.lookTargetX = this.lookTargetY = 0;
    this.shiver = 0;
    this.tintAmount = 0;
    this.reaction = null;
    this.reactionUntil = 0;
    this.lookHoldUntil = 0;
    this.chewUntil = 0;
    this.baseExpression = 'neutral';
    this.motion = 'free';
    this.launch = null;
    this.heldFor = 0;
    this.bounces = 0;
    this.hardestImpact = 0;
    this.relax = 0;
    this.magic = null;
    this.magicUntil = 0;
    this.wiggleUntil = 0;
  }

  cancelHop(): void {
    if (this.hop) {
      this.squash.target = 1;
      this.hop = null;
    }
  }

  startHop(toX: number, toY: number, height: number, duration: number, anticipation: number): void {
    this.hop = { phase: 'anticipate', t: 0, anticipation, duration, fromX: this.x, toX, fromY: this.y, toY, height };
  }

  lookAt(tx: number, ty: number): void {
    if (this.lookHeld) return;
    const range = this.radius * 3;
    this.lookTargetX = clamp((tx - this.x) / range, -1, 1);
    this.lookTargetY = clamp((ty - this.centerY) / range, -1, 1);
  }

  lookDirection(dx: number, dy: number): void {
    if (this.lookHeld) return;
    const len = Math.hypot(dx, dy) || 1;
    this.lookTargetX = (dx / len) * 0.8;
    this.lookTargetY = (dy / len) * 0.8;
  }

  /** Advance springs, blinking, looking, effects and any hop in progress. */
  update(dt: number): void {
    this.clock += dt;
    this.breathePhase += dt * Math.PI * 2 * 0.33;
    this.updateHop(dt);
    this.grow.update(dt);
    this.puff.update(dt);
    this.squash.update(dt);
    this.stretch.update(dt);
    this.lean.update(dt);
    this.lookX = approach(this.lookX, this.lookTargetX, 12, dt);
    this.lookY = approach(this.lookY, this.lookTargetY, 12, dt);
    this.shiver = approach(this.shiver, 0, 6, dt);
    this.tintAmount = Math.max(0, this.tintAmount - this.tintFadeRate * dt);
    if (this.magic && this.clock >= this.magicUntil) this.magic = null;
    this.updateBlink(dt);
  }

  private updateHop(dt: number): void {
    const hop = this.hop;
    if (!hop) return;
    hop.t += dt;
    if (hop.phase === 'anticipate') {
      // Crouch before jumping.
      this.squash.target = 1 - 0.22 * this.wobbleScale;
      if (hop.t >= hop.anticipation) {
        hop.phase = 'air';
        hop.t = 0;
        this.squash.target = 1;
        this.kick(5);
      }
      return;
    }
    const p = clamp(hop.t / hop.duration, 0, 1);
    this.x = lerp(hop.fromX, hop.toX, easeInOut(p));
    this.y = lerp(hop.fromY, hop.toY, p) + 4 * hop.height * p * (1 - p);
    // Stretch while rising and falling fast, rounder at the apex.
    this.squash.target = 1 + 0.18 * Math.abs(1 - 2 * p) * this.wobbleScale;
    if (p >= 1) {
      this.y = hop.toY;
      this.hop = null;
      this.squash.target = 1;
      this.kick(-7);
    }
  }

  private updateBlink(dt: number): void {
    const expr = this.expression;
    // Happy (including delighted chewing) and content close the eyes into smiling arcs.
    if (expr === 'happy' || expr === 'content') {
      this.blink = approach(this.blink, 1, 18, dt);
      return;
    }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.16;
      this.blink = this.blinkPhase < 0.5 ? this.blinkPhase * 2 : Math.max(0, 2 - this.blinkPhase * 2);
      if (this.blinkPhase >= 1) {
        this.blinkPhase = -1;
        this.blink = 0;
        // Occasionally blink twice.
        this.blinkTimer = this.rng() < 0.2 ? 0.18 : 2 + this.rng() * 3.5;
      }
    } else {
      this.blink = approach(this.blink, 0, 20, dt);
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && expr !== 'surprised') this.blinkPhase = 0;
    }
  }
}
