import { Spring, approach, clamp } from '../anim';
import type { TextKey } from '../../ui/i18n';

/**
 * Symbols drawn inside bubbles. Squishy Says bubbles differ by shape AND colour, so they stay
 * distinguishable for colour-blind visitors and on the hologram.
 */
export type BubbleSymbol =
  | 'star'
  | 'heart'
  | 'triangle'
  | 'berry'
  | 'fruit'
  | 'blueberry'
  | 'play'
  | 'minis'
  | 'home'
  | 'next'
  | 'stop'
  | 'ring';

/**
 * ui:      a button (Play with me, Mini me, Next game, Free play, Stop)
 * says:    a Squishy Says answer bubble
 * target:  the Bubble Bounce target (not pinchable: Squishy has to be tossed through it)
 * thought: Squishy's snack wish (not pinchable)
 */
export type BubbleRole = 'ui' | 'says' | 'target' | 'thought';

let nextId = 1;

/**
 * One floating bubble. Pure data (creature-plane world units); the effects layer draws it and
 * the visitor overlay places its label. Pops are short and soft: no flashing.
 */
export class Bubble {
  readonly id = nextId++;
  /** Appear / disappear scale. */
  readonly scale = new Spring(0, 1, 160, 13);
  /** Squish when pressed or bumped. */
  readonly squish = new Spring(0, 0, 220, 8);
  /** 0..1: lit up (Squishy Says) or highlighted (Play with me). Eased, never flashed. */
  glow = 0;
  glowTarget = 0;
  /** Gentle attention pulse for the invitation bubble. */
  attention = false;
  /** Popping: grows and fades out over POP_S, then the bubble is gone. */
  popT = -1;
  /** Disappearing quietly (scale to 0). */
  leaving = false;
  bob = Math.random() * Math.PI * 2;
  /** Drawn position (home position plus a small bob). */
  x: number;
  y: number;

  constructor(
    public homeX: number,
    public homeY: number,
    public r: number,
    readonly symbol: BubbleSymbol,
    readonly color: string,
    readonly role: BubbleRole,
    /** Text label under the bubble (ui buttons only). */
    public label: TextKey | null = null,
  ) {
    this.x = homeX;
    this.y = homeY;
  }

  static readonly POP_S = 0.38;

  get popping(): boolean {
    return this.popT >= 0;
  }

  /** Fully gone (popped or left): the owner can drop it. */
  get dead(): boolean {
    return (this.popping && this.popT >= Bubble.POP_S) || (this.leaving && this.scale.value < 0.02);
  }

  /** Can be pinched right now. */
  get pinchable(): boolean {
    return (this.role === 'ui' || this.role === 'says') && !this.popping && !this.leaving && this.scale.value > 0.6;
  }

  /** Drawn opacity (fades while popping). */
  get opacity(): number {
    if (!this.popping) return 1;
    return clamp(1 - this.popT / Bubble.POP_S, 0, 1);
  }

  /** Drawn radius including appear, squish and pop growth. */
  get drawRadius(): number {
    const pop = this.popping ? 1 + 0.45 * Math.min(1, this.popT / Bubble.POP_S) : 1;
    return this.r * Math.max(0, this.scale.value) * pop * (1 + this.squish.value * 0.12);
  }

  moveTo(x: number, y: number): void {
    this.homeX = x;
    this.homeY = y;
  }

  /** Pressed by a pinch: a squish. */
  press(): void {
    this.squish.velocity -= 6;
  }

  /** Bumped (a dragged Squishy, a refused snack): a wobble. */
  bump(): void {
    this.squish.velocity += 4;
  }

  pop(): void {
    if (!this.popping) this.popT = 0;
  }

  leave(): void {
    this.leaving = true;
    this.scale.target = 0;
  }

  /** Hit test with a generous radius. Points are the current cursor plus its recent history. */
  hit(points: readonly { x: number; y: number }[], hitScale: number, minHit: number): number {
    const r = Math.max(this.r * hitScale, minHit);
    let best = Infinity;
    for (const p of points) best = Math.min(best, Math.hypot(p.x - this.x, p.y - this.y) / r);
    return best;
  }

  update(dt: number, reduced: boolean): void {
    this.scale.update(dt);
    this.squish.update(dt);
    if (this.popping) this.popT += dt;
    this.glow = approach(this.glow, this.glowTarget, 9, dt);
    this.bob += dt * (reduced ? 0.6 : 1.2);
    const amp = this.r * (reduced ? 0.02 : 0.05);
    this.x = this.homeX;
    this.y = this.homeY + Math.sin(this.bob) * amp;
  }
}
