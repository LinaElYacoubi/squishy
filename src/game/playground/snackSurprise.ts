import { CONFIG } from '../../config';
import type { TextKey } from '../../ui/i18n';
import { hexToRgb, type CreatureModel } from '../creatureModel';
import { FOOD_KINDS, type FoodKind, type FoodModel } from '../food';
import type { GameInput, StageBounds } from '../game';
import { Bubble } from './bubble';
import { clampInside, mainCreature, shuffle, type MiniGame, type MiniGameContext } from './types';

/** What each snack does when it is the one Squishy asked for. */
export const SNACK_EFFECT: Record<FoodKind, 'wiggle' | 'colour' | 'hiccups'> = {
  berry: 'wiggle',
  fruit: 'colour',
  blueberry: 'hiccups',
};

const COLOUR_SHIFT = '#ffe14d';

/**
 * want:   Squishy shows the snack it wants in a thought bubble
 * effect: it ate the right one; its special effect plays
 * done:   all requests served
 */
export type SnackState = 'want' | 'effect' | 'done';

export class SnackSurprise implements MiniGame {
  readonly id = 'snack' as const;
  readonly bubbles: Bubble[] = [];
  coach: TextKey | null = 'gameSnack';
  state: SnackState = 'want';
  requests: FoodKind[] = [];
  served = 0;
  refusals = 0;
  /** Effects that have played this round (tests). */
  readonly played: ('wiggle' | 'colour' | 'hiccups')[] = [];

  private thought: Bubble | null = null;
  private t = 0;

  constructor(private ctx: MiniGameContext) {}

  get done(): boolean {
    return this.state === 'done';
  }

  /** The snack Squishy wants right now. */
  get wanted(): FoodKind | null {
    return this.state === 'want' ? (this.requests[this.served] ?? null) : null;
  }

  start(): void {
    const g = this.ctx.game;
    g.allow = { creatures: true, food: true };
    g.dodgeEnabled = false;
    g.sendHome();
    this.requests = shuffle(FOOD_KINDS, this.ctx.rng).slice(0, CONFIG.playground.snack.requests);
    this.served = 0;
    this.refusals = 0;
    this.played.length = 0;
    this.coach = 'gameSnack';
    this.state = 'want';
    this.t = 0;
    this.showWish(900);
    this.ctx.after(1300, () => {
      if (this.state === 'want') this.coach = 'snackWant';
    });
  }

  layout(b: StageBounds): void {
    if (this.thought) this.placeThought(b);
  }

  update(dt: number, _input: GameInput): void {
    this.t += dt;
    if (this.thought) this.placeThought(this.ctx.game.bounds);
    for (const b of this.bubbles) b.update(dt, this.ctx.reduced);
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i].dead) this.bubbles.splice(i, 1);
  }

  animate(): void {
    const c = mainCreature(this.ctx.game);
    if (!c || !this.thought || this.state !== 'want' || c.motion !== 'free' || this.ctx.game.heldFood) return;
    // Every few seconds Squishy glances up at its wish, so visitors notice the picture.
    if (Math.sin(this.t * 1.6) > 0.85) c.holdLook(0.5, 0.8, 0.3);
  }

  onOffer(f: FoodModel, c: CreatureModel): 'eat' | 'refuse' {
    if (this.state !== 'want') return 'refuse';
    if (f.kind === this.wanted) return 'eat';
    // Wrong snack: a silly "nope" head shake. The snack glides back to the tray.
    this.refusals++;
    c.react('goofy', 1.3);
    c.wiggle(0.9, 0.22, 3.4);
    this.thought?.bump();
    this.ctx.fx.sound('nope');
    this.ctx.say('sayNope', c, 1100);
    this.coach = 'snackNope';
    return 'refuse';
  }

  onFeed(f: FoodModel, c: CreatureModel): void {
    if (this.state !== 'want' || f.kind !== this.wanted) return;
    this.state = 'effect';
    this.served++;
    this.thought?.pop();
    this.thought = null;
    this.ctx.fx.sound('pop');
    this.ctx.say('sayYum', c, 900);
    this.coach = 'snackYum';
    const effect = SNACK_EFFECT[f.kind];
    this.played.push(effect);
    // The effect starts after the delighted chewing.
    this.ctx.after(CONFIG.food.chewMs, () => this.playEffect(effect, c));
    this.ctx.after(CONFIG.food.chewMs + CONFIG.playground.snack.effectMs, () => {
      if (this.served >= this.requests.length) {
        this.state = 'done';
        this.coach = 'celebrate';
      } else {
        this.state = 'want';
        this.coach = 'snackWant';
        this.showWish(0);
      }
    });
  }

  private playEffect(effect: 'wiggle' | 'colour' | 'hiccups', c: CreatureModel): void {
    if (!c.alive) return;
    const fx = this.ctx.fx;
    switch (effect) {
      case 'wiggle':
        // A happy wiggle with two little hops and hearts.
        c.react('happy', 2.2);
        c.wiggle(2, 0.24, 2.6);
        this.ctx.game.hopInPlace(c, 0.3);
        this.ctx.after(700, () => this.ctx.game.hopInPlace(c, 0.3));
        fx.burst(c.x, c.centerY + c.size, 'heart', '#ff5fa8', 6);
        fx.sound('giggle');
        break;
      case 'colour':
        // A quick, smooth colour change to sunny yellow that fades back (no flashing).
        c.setTint(hexToRgb(COLOUR_SHIFT), 0.95, 2.2);
        c.react('excited', 1.4);
        c.kick(6);
        fx.burst(c.x, c.centerY, 'sparkle', COLOUR_SHIFT, 8);
        fx.sound('sparkle');
        break;
      case 'hiccups':
        // Three hiccups: a little jump, a surprised blink and a tiny bubble each time.
        for (let i = 0; i < 3; i++) {
          this.ctx.after(i * 650, () => {
            if (!c.alive) return;
            c.kick(7);
            c.surpriseBlink();
            fx.sound('hiccup');
            fx.burst(c.x, c.mouthY, 'bubble', '#9fd8ff', 2);
            this.ctx.say('sayHic', c, 450);
          });
        }
        break;
    }
  }

  private showWish(delayMs: number): void {
    const want = this.wanted;
    if (!want) return;
    const make = () => {
      if (this.state !== 'want' || this.wanted !== want) return;
      const b = new Bubble(0, 0, 1, want, '#ffffff', 'thought');
      this.thought = b;
      this.placeThought(this.ctx.game.bounds, true);
      this.bubbles.push(b);
    };
    if (delayMs > 0) this.ctx.after(delayMs, make);
    else make();
  }

  /** Above Squishy's head, a little to the side, always inside the safe area. */
  private placeThought(b: StageBounds, snap = false): void {
    const bub = this.thought;
    const c = mainCreature(this.ctx.game);
    if (!bub || !c) return;
    bub.r = Math.max(b.mainRadius * 0.5, b.minHitRadius * 0.8);
    const side = c.x > (b.left + b.right) / 2 ? -1 : 1;
    const p = clampInside(b, c.x + side * c.size * 0.9, c.centerY + c.size * 1.75, bub.r);
    if (snap) {
      bub.moveTo(p.x, p.y);
    } else {
      // Follow smoothly so the bubble stays readable while Squishy moves.
      bub.moveTo(bub.homeX + (p.x - bub.homeX) * 0.15, bub.homeY + (p.y - bub.homeY) * 0.15);
    }
  }
}
