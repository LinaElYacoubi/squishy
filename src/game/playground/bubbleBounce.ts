import { CONFIG } from '../../config';
import type { TextKey } from '../../ui/i18n';
import type { CreatureModel, Launch } from '../creatureModel';
import type { GameInput, StageBounds } from '../game';
import { Bubble } from './bubble';
import { clampInside, lookToward, mainCreature, type MiniGame, type MiniGameContext } from './types';

const TARGET_COLOR = '#8fe3ff';

/**
 * Toss Squishy through a big floating bubble to pop it. Only a real throw counts: a slow drop
 * or a release caused by losing the hand never pops the bubble and never counts as a miss.
 */
export class BubbleBounce implements MiniGame {
  readonly id = 'bounce' as const;
  readonly bubbles: Bubble[] = [];
  coach: TextKey | null = 'gameBounce';
  pops = 0;
  misses = 0;
  target: Bubble | null = null;

  private finished = false;
  /** Creatures that already popped a bubble during their current flight. */
  private scored = new Set<CreatureModel>();
  private nudged = false;

  constructor(private ctx: MiniGameContext) {}

  get done(): boolean {
    return this.finished;
  }

  start(): void {
    const g = this.ctx.game;
    g.allow = { creatures: true, food: false };
    g.dodgeEnabled = false;
    g.sendHome();
    this.pops = 0;
    this.misses = 0;
    this.finished = false;
    this.scored.clear();
    this.coach = 'gameBounce';
    this.ctx.after(700, () => this.spawnTarget());
    this.ctx.after(1300, () => {
      if (!this.finished) this.coach = 'bounceToss';
    });
  }

  /** Target position for the n-th bubble: close above Squishy first, then a little further away. */
  targetSpot(b: StageBounds, n: number): { x: number; y: number; r: number } {
    const radii = CONFIG.playground.bounce.targetRadii;
    const R = b.mainRadius;
    const width = b.right - b.left;
    // Never wider than most of the stage, so it fits a narrow portrait screen.
    const r = Math.min(radii[Math.min(n, radii.length - 1)] * R, width * 0.36);
    const side = n % 2 === 0 ? 1 : -1;
    const x = (b.left + b.right) / 2 + side * R * (0.8 + 0.6 * n);
    const y = b.floorY + R * (2.9 + 0.35 * n);
    const p = clampInside(b, x, y, r);
    return { x: p.x, y: p.y, r };
  }

  layout(b: StageBounds): void {
    if (!this.target) return;
    const s = this.targetSpot(b, this.pops);
    this.target.r = s.r;
    this.target.moveTo(s.x, s.y);
  }

  update(dt: number, _input: GameInput): void {
    for (const b of this.bubbles) b.update(dt, this.ctx.reduced);
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i].dead) this.bubbles.splice(i, 1);
    const t = this.target;
    if (!t || t.popping || t.scale.value < 0.5) return;
    const pad = CONFIG.playground.bounce.hitPadSizes;
    for (const c of this.ctx.game.alive) {
      const d = Math.hypot(c.x - t.x, c.centerY - t.y);
      const inside = d < t.r + c.size * pad;
      if (c.motion === 'airborne' && c.launch === 'throw' && inside && !this.scored.has(c)) {
        this.hit(c, t);
        return;
      }
      // Dragged into the bubble: it wobbles, but only a toss pops it.
      if (c.motion === 'grabbed' && inside && !this.nudged) {
        this.nudged = true;
        t.bump();
        this.coach = 'bounceLetGo';
      }
      if (c.motion === 'grabbed' && !inside) this.nudged = false;
    }
  }

  animate(): void {
    const c = mainCreature(this.ctx.game);
    const t = this.target;
    if (!c || !t) return;
    // Anticipation: while held, Squishy eyes the bubble with a big excited face.
    if (c.motion === 'grabbed') {
      lookToward(c, t.x, t.y, 0.1);
      c.baseExpression = 'excited';
    } else if (c.motion === 'free' && !c.lookHeld && !c.reactionExpression) {
      c.baseExpression = 'curious';
    }
  }

  onRelease(kind: 'drop' | 'throw' | 'lost', c: CreatureModel): void {
    this.scored.delete(c);
    if (kind === 'throw') c.react('excited', 0.5);
  }

  onLand(c: CreatureModel, launch: Launch): void {
    const scored = this.scored.has(c);
    this.scored.delete(c);
    // Only a real throw that missed is a miss. A lost hand (gentle drop) is neither a hit nor a miss.
    if (launch !== 'throw' || scored || this.finished || !this.target) return;
    this.misses++;
    c.react('goofy', 1.4);
    c.wiggle(1.3, 0.2, 2.8);
    this.ctx.fx.sound('oops');
    this.ctx.say('sayOops', c, 1000);
    this.coach = 'bounceMiss';
    this.target.bump();
  }

  private hit(c: CreatureModel, t: Bubble): void {
    this.scored.add(c);
    t.pop();
    this.target = null;
    this.pops++;
    this.ctx.fx.sound('pop');
    this.ctx.fx.burst(t.x, t.y, 'bubble', TARGET_COLOR);
    this.ctx.say('sayPop', c, 900);
    c.react('happy', 1.6);
    const total = CONFIG.playground.bounce.targetRadii.length;
    if (this.pops >= total) {
      this.coach = 'celebrate';
      // Let it land before the celebration.
      this.ctx.after(1100, () => (this.finished = true));
    } else {
      this.coach = 'bounceNext';
      this.ctx.after(1200, () => this.spawnTarget());
      this.ctx.after(2600, () => {
        if (this.coach === 'bounceNext') this.coach = 'bounceToss';
      });
    }
  }

  private spawnTarget(): void {
    if (this.finished || this.target) return;
    const s = this.targetSpot(this.ctx.game.bounds, this.pops);
    const b = new Bubble(s.x, s.y, s.r, 'ring', TARGET_COLOR, 'target');
    this.target = b;
    this.bubbles.push(b);
    this.nudged = false;
  }
}
