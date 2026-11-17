import { CONFIG } from '../../config';
import type { TextKey } from '../../ui/i18n';
import type { GameInput, StageBounds } from '../game';
import { Bubble, type BubbleSymbol } from './bubble';
import { bubbleBand, lookToward, mainCreature, type MiniGame, type MiniGameContext } from './types';

/** The three answer bubbles: each has its own shape, colour and note. */
export const SAYS_BUBBLES: readonly { symbol: BubbleSymbol; color: string; pitch: number }[] = [
  { symbol: 'star', color: '#ffd34d', pitch: 1 },
  { symbol: 'heart', color: '#ff5fa8', pitch: 1.26 },
  { symbol: 'triangle', color: '#3fd8ff', pitch: 1.5 },
];

/**
 * intro:  bubbles appear, "Watch my bubbles!"
 * show:   Squishy looks at a bubble, then lights it up (one step after another)
 * input:  the visitor pinches the bubbles in the same order
 * right:  short happy reaction, then the next (longer) sequence or the end of the round
 * wrong:  a silly reaction, then the same sequence is shown again (never a failure screen)
 */
export type SaysState = 'intro' | 'show' | 'input' | 'right' | 'wrong' | 'done';

export class SquishySays implements MiniGame {
  readonly id = 'says' as const;
  readonly bubbles: Bubble[] = [];
  coach: TextKey | null = 'gameSays';
  state: SaysState = 'intro';
  /** Index into CONFIG.playground.says.levels. */
  level = 0;
  /** Bubble indexes to repeat, in order. */
  sequence: number[] = [];
  /** How many of the sequence the visitor has already matched. */
  matched = 0;
  /** Wrong answers this round (diagnostics and tests). */
  mistakes = 0;

  private t = 0;
  /** Show phase: which step, and its sub-phase. */
  private step = 0;
  private phase: 'look' | 'lit' | 'gap' = 'look';
  private idle = 0;

  constructor(private ctx: MiniGameContext) {}

  get done(): boolean {
    return this.state === 'done';
  }

  start(): void {
    const g = this.ctx.game;
    g.allow = { creatures: false, food: false };
    g.dodgeEnabled = false;
    g.sendHome();
    this.bubbles.length = 0;
    for (const s of SAYS_BUBBLES) this.bubbles.push(new Bubble(0, 0, 1, s.symbol, s.color, 'says'));
    this.layout(g.bounds);
    this.level = 0;
    this.mistakes = 0;
    this.newSequence();
    this.enter('intro');
    this.coach = 'gameSays';
    this.ctx.after(1100, () => {
      if (this.state === 'intro') this.coach = 'saysWatch';
    });
  }

  layout(b: StageBounds): void {
    const band = bubbleBand(b);
    const width = b.right - b.left;
    const slot = width / SAYS_BUBBLES.length;
    const r = Math.min(b.mainRadius * 0.62, slot * 0.4, (band.high - band.low) * 0.5);
    this.bubbles.forEach((bub, i) => {
      bub.r = r;
      // A gentle arc: the middle bubble sits a little higher.
      const lift = i === 1 ? r * 0.35 : 0;
      bub.moveTo(b.left + slot * (i + 0.5), Math.min(band.mid + lift, band.high));
    });
  }

  update(dt: number, _input: GameInput): void {
    for (const b of this.bubbles) b.update(dt, this.ctx.reduced);
    this.t += dt;
    const s = CONFIG.playground.says;
    switch (this.state) {
      case 'intro':
        if (this.t >= 2.2) this.enter('show');
        break;
      case 'show':
        this.updateShow(s);
        break;
      case 'input':
        this.idle += dt;
        if (this.idle * 1000 >= s.replayAfterMs) this.enter('show'); // a gentle reminder, not a failure
        break;
      case 'right':
        if (this.t >= 1.3) {
          this.level++;
          if (this.level >= s.levels.length) {
            this.enter('done');
          } else {
            this.newSequence();
            this.coach = 'saysWatch';
            this.enter('show');
          }
        }
        break;
      case 'wrong':
        if (this.t >= 1.7) {
          this.coach = 'saysWatch';
          this.enter('show');
        }
        break;
      case 'done':
        break;
    }
  }

  animate(): void {
    const c = mainCreature(this.ctx.game);
    if (!c || c.motion !== 'free') return;
    if (this.state === 'show' && this.phase !== 'gap') {
      const b = this.bubbles[this.sequence[this.step]];
      lookToward(c, b.x, b.y, 0.2);
      c.lean.target = -Math.max(-1, Math.min(1, (b.x - c.x) / (c.radius * 3))) * 0.14;
      c.baseExpression = this.phase === 'lit' ? 'excited' : 'curious';
    } else if (this.state === 'input') {
      c.baseExpression = 'curious';
    }
  }

  pressBubble(b: Bubble): void {
    const i = this.bubbles.indexOf(b);
    if (i < 0) return;
    b.press();
    if (this.state !== 'input') return; // pinches while Squishy is showing are ignored, never wrong
    this.idle = 0;
    const fx = this.ctx.fx;
    const c = mainCreature(this.ctx.game);
    if (i === this.sequence[this.matched]) {
      fx.sound('chime', 1, SAYS_BUBBLES[i].pitch);
      this.blink(b);
      this.matched++;
      if (this.matched >= this.sequence.length) {
        fx.burst(b.x, b.y, 'sparkle', SAYS_BUBBLES[i].color);
        if (c) {
          c.react('happy', 1.2);
          this.ctx.game.hopInPlace(c, 0.35);
        }
        this.ctx.say('sayYes', c, 1100);
        this.coach = this.level + 1 < CONFIG.playground.says.levels.length ? 'saysNice' : 'celebrate';
        this.enter('right');
      }
    } else {
      // A silly reaction, then Squishy shows the same sequence again.
      this.mistakes++;
      fx.sound('oops');
      b.bump();
      if (c) {
        c.react('goofy', 1.5);
        c.wiggle(1.2, 0.2, 3);
      }
      this.ctx.say('sayOops', c, 1200);
      this.coach = 'saysOops';
      this.enter('wrong');
    }
  }

  private updateShow(s: typeof CONFIG.playground.says): void {
    const b = this.bubbles[this.sequence[this.step]];
    const ms = this.t * 1000;
    if (this.phase === 'look' && ms >= s.lookMs) {
      this.phase = 'lit';
      this.t = 0;
      b.glowTarget = 1;
      b.press();
      this.ctx.fx.sound('chime', 1, SAYS_BUBBLES[this.sequence[this.step]].pitch);
    } else if (this.phase === 'lit' && ms >= s.litMs) {
      this.phase = 'gap';
      this.t = 0;
      b.glowTarget = 0;
    } else if (this.phase === 'gap' && ms >= s.gapMs) {
      this.step++;
      this.phase = 'look';
      this.t = 0;
      if (this.step >= this.sequence.length) {
        this.coach = this.sequence.length > 1 ? 'saysYourTurnMany' : 'saysYourTurn';
        this.enter('input');
      }
    }
  }

  /** Light a bubble briefly as feedback for a right answer. */
  private blink(b: Bubble): void {
    b.glowTarget = 1;
    this.ctx.after(380, () => (b.glowTarget = 0));
  }

  private enter(state: SaysState): void {
    this.state = state;
    this.t = 0;
    if (state === 'show') {
      this.step = 0;
      this.phase = 'look';
      for (const b of this.bubbles) b.glowTarget = 0;
    }
    if (state === 'input') {
      this.matched = 0;
      this.idle = 0;
    }
  }

  private newSequence(): void {
    const len = CONFIG.playground.says.levels[this.level];
    const seq: number[] = [];
    for (let i = 0; i < len; i++) {
      let k = Math.floor(this.ctx.rng() * SAYS_BUBBLES.length) % SAYS_BUBBLES.length;
      // No immediate repeats: each step lights a different bubble from the one before.
      if (seq.length > 0 && k === seq[seq.length - 1]) k = (k + 1) % SAYS_BUBBLES.length;
      seq.push(k);
    }
    this.sequence = seq;
  }
}
