/**
 * Squishy's Playground: Free Play extras and the Play Together mini-games, with simulated
 * visitor input (no camera, no rendering). The playground is wired to the game exactly as in
 * the app: pinches go through preUpdate first, game events and beforeAnimate are forwarded.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createRng } from '../src/game/anim';
import type { CreatureModel } from '../src/game/creatureModel';
import { Game, NO_INPUT, type GameInput, type StageBounds } from '../src/game/game';
import type { Bubble } from '../src/game/playground/bubble';
import { BubbleBounce } from '../src/game/playground/bubbleBounce';
import { PetDetector } from '../src/game/playground/petting';
import { Playground } from '../src/game/playground/playground';
import { SecretReactions } from '../src/game/playground/secrets';
import { SNACK_EFFECT, SnackSurprise } from '../src/game/playground/snackSurprise';
import { SAYS_BUBBLES, SquishySays } from '../src/game/playground/squishySays';
import { BOUNDS } from './helpers';

const DT = 1 / 60;
const R = BOUNDS.mainRadius;

/** A narrow portrait safe area like the INNOVA capsule (2160 x 3840 with default margins). */
const PORTRAIT: StageBounds = {
  left: -3,
  right: 3,
  bottom: -5.6,
  top: 5.6,
  floorY: -5.6 + 11.2 * 0.27,
  mainRadius: 1.2,
  miniMinRadius: 0.57,
  minHitRadius: 0.6,
  trayX: 0,
  trayY: -5.1,
  foodRadius: 0.38,
  foodSpacing: 0.99,
};

class Visitor {
  x = 5;
  y = 2.5;
  pinching = false;
  present = true;
  t = 0;
  private history: { x: number; y: number; t: number }[] = [];
  private pinchStart = false;
  private acquired = false;

  constructor(
    readonly g: Game,
    readonly pg: Playground,
  ) {}

  frame(): void {
    this.t += DT * 1000;
    if (this.present) this.history.push({ x: this.x, y: this.y, t: this.t });
    this.history = this.history.filter((p) => p.t >= this.t - CONFIG.hit.historyMs);
    const input: GameInput = this.present
      ? {
          present: true,
          active: true,
          x: this.x,
          y: this.y,
          pinching: this.pinching,
          pinchStart: this.pinchStart,
          acquired: this.acquired,
          recent: this.history.slice(),
        }
      : { ...NO_INPUT };
    this.pinchStart = false;
    this.acquired = false;
    this.g.update(DT, this.pg.preUpdate(DT, input));
  }

  wait(seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.frame();
  }

  moveTo(x: number, y: number, seconds: number): void {
    const n = Math.max(1, Math.round(seconds / DT));
    const x0 = this.x;
    const y0 = this.y;
    for (let i = 1; i <= n; i++) {
      this.x = x0 + ((x - x0) * i) / n;
      this.y = y0 + ((y - y0) * i) / n;
      this.frame();
    }
  }

  jump(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  pinch(): void {
    this.pinching = true;
    this.pinchStart = true;
    this.frame();
  }

  release(): void {
    this.pinching = false;
    this.frame();
  }

  /** Pinch and release on a bubble. */
  tap(b: Bubble): void {
    this.jump(b.x, b.y);
    this.frame();
    this.pinch();
    this.wait(0.1);
    this.release();
  }

  lose(): void {
    this.present = false;
    this.pinching = false;
    this.history = [];
    this.frame();
  }

  arrive(): void {
    this.present = true;
    this.acquired = true;
    this.frame();
  }
}

function wire(g: Game, pg: Playground): void {
  g.events = {
    onRelease: (k, c) => c && pg.onRelease(k, c),
    onOffer: (f, c) => pg.onOffer(f, c),
    onFeed: (f, c) => f && c && pg.onFeed(f, c),
    onLand: (c, l) => pg.onLand(c, l),
    onMerge: (s, a) => s && a && pg.onMerge(s, a),
    onSplit: () => pg.onSplit(),
    beforeAnimate: (dt) => pg.animate(dt),
  };
}

function setup(bounds: StageBounds = BOUNDS, rng: () => number = () => 0.99) {
  const g = new Game(bounds, rng);
  const pg = new Playground(g, createRng(7));
  wire(g, pg);
  const v = new Visitor(g, pg);
  v.jump(bounds.right - 0.3, bounds.bottom + 0.3); // out of the way
  v.wait(0.1);
  return { g, pg, v };
}

const main = (g: Game) => g.alive[0];
const invite = (pg: Playground) => pg.uiBubbles.find((b) => b.symbol === 'play' && !b.leaving);
const uiBubble = (pg: Playground, symbol: Bubble['symbol']) => pg.uiBubbles.find((b) => b.symbol === symbol && !b.leaving);

/** Wait until Squishy Says expects input, then answer the whole sequence. */
function answer(v: Visitor, says: SquishySays, correct = true): void {
  for (let i = 0; i < 600 && says.state !== 'input'; i++) v.frame();
  expect(says.state).toBe('input');
  const seq = says.sequence.slice();
  for (const k of seq) {
    const pick = correct ? k : (k + 1) % SAYS_BUBBLES.length;
    v.tap(says.bubbles[pick]);
    if (!correct) return;
  }
}

/** Grab Squishy and flick it toward (tx, ty). */
function toss(v: Visitor, c: CreatureModel, tx: number, ty: number): void {
  v.jump(c.x, c.centerY);
  v.pinch();
  v.moveTo(c.x - R * 0.4, c.centerY + R * 0.2, 0.35);
  v.moveTo(tx, ty, 0.1);
  v.release();
}

// ---------------------------------------------------------------- Free Play and invitation

describe('Free Play and the "Play with me" invitation', () => {
  it('Free Play is the default and the invitation appears after a short while', () => {
    const { pg, v } = setup();
    expect(pg.mode).toBe('free');
    expect(invite(pg)).toBeUndefined();
    v.wait(CONFIG.playground.inviteAfterMs / 1000 + 0.3);
    const b = invite(pg)!;
    expect(b).toBeDefined();
    expect(b.attention).toBe(true);
    expect(b.label).toBe('playWithMe');
  });

  it('Squishy notices a new visitor: looks at the hand and says hi (once per visitor)', () => {
    const { g, pg, v } = setup();
    expect(pg.speech?.key).toBe('sayHi');
    expect(main(g).expression).toBe('happy');
    v.lose();
    v.wait(1);
    v.arrive();
    v.wait(0.2);
    // Back within a few seconds: same visitor, no second greeting.
    expect(pg.speech?.key).not.toBe('sayHi');
    v.lose();
    v.wait(CONFIG.activity.lostPromptMs / 1000 + 0.5);
    v.arrive();
    expect(pg.speech?.key).toBe('sayHi');
  });

  it('pinching a bubble never also grabs Squishy or food', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    v.tap(invite(pg)!);
    expect(g.grabbed).toBeNull();
    expect(g.heldFood).toBeNull();
    expect(pg.mode).toBe('play');
  });

  it('Free Play feeding, grabbing and throwing still work as before', () => {
    const { g, v } = setup();
    v.wait(4);
    const c = main(g);
    toss(v, c, c.x + 5, c.centerY + 2);
    expect(g.stats.throws).toBe(1);
    v.wait(4);
    const f = g.foods[0];
    v.jump(f.x, f.y);
    v.pinch();
    v.moveTo(c.x, c.mouthY, 0.4);
    v.release();
    expect(g.stats.feeds).toBe(1);
  });
});

// ---------------------------------------------------------------- Squishy Says (full round end to end)

describe('Squishy Says', () => {
  it('attract, explain, play three levels, celebrate and return to Free Play', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    v.tap(invite(pg)!);
    const says = pg.current as SquishySays;
    expect(says.id).toBe('says');
    expect(pg.coach).toBe('gameSays');
    // Squishy cannot be grabbed while showing the sequence (pinches are for the bubbles).
    expect(g.allow.creatures).toBe(false);

    const lengths: number[] = [];
    for (let level = 0; level < 3; level++) {
      for (let i = 0; i < 600 && says.state !== 'input'; i++) {
        v.frame();
        if (says.state === 'show') expect(pg.coach).toBe('saysWatch');
      }
      lengths.push(says.sequence.length);
      expect(pg.coach).toMatch(/saysYourTurn/);
      answer(v, says);
      v.wait(1.5);
    }
    expect(lengths).toEqual([1, 2, 3]);
    expect(pg.mode).toBe('celebrate');
    expect(pg.coach).toBe('celebrate');
    v.wait(CONFIG.playground.celebrateMs / 1000 + 0.2);
    expect(pg.mode).toBe('between');
    expect(pg.rounds.says).toBe(1);
    // Rules restored between rounds: Free Play grabbing works again.
    expect(g.allow).toEqual({ creatures: true, food: true });
    const home = uiBubble(pg, 'home')!;
    expect(uiBubble(pg, 'next')!.label).toBe('gameSnack');
    v.tap(home);
    expect(pg.mode).toBe('free');
  });

  it('every step: Squishy looks at the bubble first, then it lights up', () => {
    const { g, pg, v } = setup();
    pg.startGame('says');
    const says = pg.current as SquishySays;
    for (let i = 0; i < 300 && says.state !== 'show'; i++) v.frame();
    const target = says.bubbles[says.sequence[0]];
    v.wait(0.3);
    expect(target.glowTarget).toBe(0);
    const c = main(g);
    // Eyes point toward the bubble before it lights.
    const dx = target.x - c.x;
    if (Math.abs(dx) > 0.5) expect(Math.sign(c.lookTargetX)).toBe(Math.sign(dx));
    expect(c.lookTargetY).toBeGreaterThan(0);
    v.wait(0.4);
    expect(target.glowTarget).toBe(1);
  });

  it('a wrong bubble gets a silly reaction and a replay, never a failure', () => {
    const { g, pg, v } = setup();
    pg.startGame('says');
    const says = pg.current as SquishySays;
    answer(v, says, false);
    expect(says.state).toBe('wrong');
    expect(says.mistakes).toBe(1);
    expect(pg.coach).toBe('saysOops');
    expect(pg.speech?.key).toBe('sayOops');
    expect(main(g).expression).toBe('goofy');
    const seq = says.sequence.slice();
    v.wait(2);
    expect(says.state).toBe('show');
    expect(says.sequence).toEqual(seq); // same sequence replayed
    expect(pg.mode).toBe('play');
  });

  it('bubbles differ by shape as well as colour', () => {
    const shapes = new Set(SAYS_BUBBLES.map((b) => b.symbol));
    const colours = new Set(SAYS_BUBBLES.map((b) => b.color));
    expect(shapes.size).toBe(SAYS_BUBBLES.length);
    expect(colours.size).toBe(SAYS_BUBBLES.length);
  });

  it('the Stop bubble returns to Free Play mid-round', () => {
    const { pg, v } = setup();
    pg.startGame('says');
    v.wait(0.6);
    v.tap(uiBubble(pg, 'stop')!);
    expect(pg.mode).toBe('free');
    expect(pg.current).toBeNull();
  });
});

// ---------------------------------------------------------------- Snack Surprise

describe('Snack Surprise', () => {
  const feed = (v: Visitor, g: Game, kind: string) => {
    const f = g.foods.find((x) => x.kind === kind && x.state === 'tray')!;
    const c = main(g);
    v.jump(f.x, f.y);
    v.pinch();
    v.moveTo(c.x, c.mouthY, 0.4);
    v.release();
  };

  it('Squishy shows the snack it wants; the matching snack unlocks its effect', () => {
    const { g, pg, v } = setup();
    pg.startGame('snack');
    const snack = pg.current as SnackSurprise;
    v.wait(1.5);
    expect(pg.coach).toBe('snackWant');
    const thought = snack.bubbles.find((b) => b.role === 'thought')!;
    expect(thought.symbol).toBe(snack.wanted);
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 600 && snack.state !== 'want'; k++) v.frame();
      v.wait(0.2);
      feed(v, g, snack.wanted!);
      expect(pg.speech?.key).toBe('sayYum');
      v.wait(CONFIG.food.chewMs / 1000 + 0.3);
    }
    expect(new Set(snack.played).size).toBe(3);
    v.wait(4);
    expect(pg.mode).toBe('celebrate');
  });

  it('a wrong snack is turned down (not eaten) and glides back to the tray', () => {
    const { g, pg, v } = setup();
    pg.startGame('snack');
    const snack = pg.current as SnackSurprise;
    v.wait(1.5);
    const wrong = (['berry', 'fruit', 'blueberry'] as const).find((k) => k !== snack.wanted)!;
    feed(v, g, wrong);
    v.frame();
    expect(g.stats.feeds).toBe(0);
    expect(snack.refusals).toBe(1);
    expect(pg.coach).toBe('snackNope');
    expect(main(g).expression).toBe('goofy');
    expect(g.foods.find((f) => f.kind === wrong)!.state).toBe('returning');
    expect(snack.state).toBe('want');
  });

  it('three snacks have three different effects', () => {
    expect(new Set(Object.values(SNACK_EFFECT)).size).toBe(3);
  });

  it('regular feeding is unchanged in Free Play (any snack is eaten)', () => {
    const { g, v } = setup();
    v.wait(1);
    feed(v, g, 'blueberry');
    expect(g.stats.feeds).toBe(1);
  });
});

// ---------------------------------------------------------------- Bubble Bounce

describe('Bubble Bounce', () => {
  it('tossing Squishy through the bubble pops it, with a celebration after three', () => {
    const { g, pg, v } = setup();
    pg.startGame('bounce');
    const bb = pg.current as BubbleBounce;
    for (let n = 0; n < 3; n++) {
      for (let k = 0; k < 400 && (!bb.target || bb.target.scale.value < 0.9); k++) v.frame();
      const t = bb.target!;
      const c = main(g);
      for (let k = 0; k < 400 && c.motion !== 'free'; k++) v.frame();
      // Aim through the bubble.
      toss(v, c, t.x, t.y);
      for (let k = 0; k < 120 && bb.pops === n; k++) v.frame();
      expect(bb.pops).toBe(n + 1);
      expect(t.popping).toBe(true);
      v.wait(3);
    }
    expect(bb.misses).toBe(0);
    v.wait(1);
    expect(['celebrate', 'between']).toContain(pg.mode);
  });

  it('the first target is large and close to Squishy', () => {
    const b = new BubbleBounce({} as never).targetSpot(BOUNDS, 0);
    expect(b.r).toBeGreaterThanOrEqual(R * 1.2);
    expect(Math.hypot(b.x, b.y - BOUNDS.floorY)).toBeLessThan(R * 4.5);
  });

  it('a lost hand while carrying Squishy into the bubble releases it gently: no pop, no miss', () => {
    const { g, pg, v } = setup();
    pg.startGame('bounce');
    const bb = pg.current as BubbleBounce;
    v.wait(1.5);
    const t = bb.target!;
    const c = main(g);
    v.jump(c.x, c.centerY);
    v.pinch();
    v.moveTo(t.x, t.y, 0.6); // carried into the bubble...
    v.moveTo(t.x + R * 2, t.y + R, 0.08); // ...moving fast when tracking drops
    v.lose();
    expect(c.launch).toBe('lost');
    expect(c.vx).toBe(0);
    v.wait(3);
    expect(bb.pops).toBe(0);
    expect(bb.misses).toBe(0);
    expect(g.stats.throws).toBe(0);
  });

  it('a missed toss gets a goofy wobble and "So close!"', () => {
    const { g, pg, v } = setup();
    pg.startGame('bounce');
    const bb = pg.current as BubbleBounce;
    v.wait(1.5);
    const t = bb.target!;
    const c = main(g);
    // Toss away from the bubble.
    const away = t.x > c.x ? -1 : 1;
    toss(v, c, c.x + away * 5, c.centerY + 0.3);
    for (let k = 0; k < 600 && bb.misses === 0; k++) v.frame();
    v.frame();
    expect(bb.misses).toBe(1);
    expect(bb.pops).toBe(0);
    expect(pg.coach).toBe('bounceMiss');
    expect(c.expression).toBe('goofy');
    expect(c.wiggling).toBe(true);
  });

  it('a slow drop inside the bubble does not pop it', () => {
    const { g, pg, v } = setup();
    pg.startGame('bounce');
    const bb = pg.current as BubbleBounce;
    v.wait(1.5);
    const t = bb.target!;
    const c = main(g);
    v.jump(c.x, c.centerY);
    v.pinch();
    v.moveTo(t.x, t.y, 0.8);
    expect(pg.coach).toBe('bounceLetGo');
    v.wait(0.4);
    v.release();
    v.wait(3);
    expect(bb.pops).toBe(0);
  });
});

// ---------------------------------------------------------------- Petting

describe('Pet Squishy', () => {
  const overHead = (c: CreatureModel) => ({ x: c.x, y: c.centerY + c.size * 1.1 });

  it('slow back-and-forth above the head starts petting: eyes close, it leans and relaxes', () => {
    const { g, pg, v } = setup();
    v.wait(1);
    const c = main(g);
    const p = overHead(c);
    v.jump(p.x, p.y);
    v.wait(0.2);
    for (let i = 0; i < 4; i++) {
      v.moveTo(p.x + c.size * 0.5, p.y, 0.35);
      v.moveTo(p.x - c.size * 0.5, p.y, 0.35);
    }
    expect(pg.pet.active).toBe(true);
    expect(c.baseExpression).toBe('content');
    expect(c.relax).toBeGreaterThan(0.5);
    // Leans toward the hand (positive lean is to the left; the hand is on the left).
    expect(c.lean.target).toBeGreaterThan(0);
  });

  it('simply passing over the head does not count as petting', () => {
    const { g, pg, v } = setup();
    v.wait(1);
    const c = main(g);
    const p = overHead(c);
    v.jump(p.x - c.size * 3, p.y);
    v.frame();
    v.moveTo(p.x + c.size * 3, p.y, 1.5);
    expect(pg.pet.active).toBe(false);
    // A quick swipe back and forth is not petting either.
    v.moveTo(p.x - c.size * 3, p.y, 0.1);
    v.moveTo(p.x + c.size * 3, p.y, 0.1);
    v.moveTo(p.x - c.size * 3, p.y, 0.1);
    expect(pg.pet.active).toBe(false);
  });

  it('is paused while pinching and while carrying food', () => {
    const { g, pg, v } = setup();
    v.wait(1);
    const c = main(g);
    const p = overHead(c);
    v.jump(p.x, p.y);
    v.pinch();
    for (let i = 0; i < 4; i++) {
      v.moveTo(p.x + c.size * 0.5, p.y, 0.35);
      v.moveTo(p.x - c.size * 0.5, p.y, 0.35);
    }
    expect(pg.pet.active).toBe(false);
    v.release();
    const f = g.foods[1];
    v.jump(f.x, f.y);
    v.pinch();
    v.moveTo(p.x, p.y, 0.3);
    for (let i = 0; i < 4; i++) {
      v.moveTo(p.x + c.size * 0.5, p.y, 0.35);
      v.moveTo(p.x - c.size * 0.5, p.y, 0.35);
    }
    expect(g.heldFood).not.toBeNull();
    expect(pg.pet.active).toBe(false);
  });

  it('Squishy does not dodge a hand hovering above its head', () => {
    const { g, v } = setup(BOUNDS, () => 0); // rng 0: would always dodge when allowed
    v.wait(3);
    const c = main(g);
    const x0 = c.x;
    const p = overHead(c);
    // A hand coming down from above to pet.
    v.jump(p.x, BOUNDS.top - 0.2);
    v.frame();
    v.moveTo(p.x, p.y, 0.5);
    for (let i = 0; i < 3; i++) {
      v.moveTo(p.x + c.size * 0.5, p.y, 0.35);
      v.moveTo(p.x - c.size * 0.5, p.y, 0.35);
    }
    expect(Math.abs(c.x - x0)).toBeLessThan(0.01);
  });

  it('detector: needs a couple of direction changes, each a real stroke', () => {
    const d = new PetDetector();
    const zone = { cx: 0, cy: 0, size: 1 };
    const y = 1.1;
    // Tiny jitter in place: no petting.
    for (let i = 0; i < 120; i++) d.update(DT, { x: Math.sin(i) * 0.05, y }, zone);
    expect(d.active).toBe(false);
    for (let i = 0; i < 180; i++) d.update(DT, { x: 0.5 * Math.sin(i * DT * Math.PI * 1.4), y }, zone);
    expect(d.active).toBe(true);
    d.update(DT, null, zone);
    expect(d.active).toBe(false);
  });
});

// ---------------------------------------------------------------- Merge Magic and minis

describe('Merge Magic', () => {
  it('"Mini me!" brings back the minis; merging two reveals a temporary look', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    v.tap(uiBubble(pg, 'minis')!);
    v.wait(3);
    expect(g.alive.length).toBe(3);
    expect(uiBubble(pg, 'minis')).toBeUndefined();
    const [a, b] = [g.creatures[1], g.creatures[2]];
    v.jump(a.x, a.centerY);
    v.pinch();
    v.moveTo(b.x, b.centerY, 0.6);
    v.wait(0.2);
    v.release();
    v.wait(1);
    expect(g.stats.merges).toBe(1);
    const survivor = g.alive.find((c) => c.magic)!;
    expect(survivor.magic).toBe('star');
    expect(pg.speech?.key).toBe('lookStar');
    v.wait(CONFIG.playground.magicMs / 1000 + 0.5);
    expect(survivor.magic).toBeNull();
  });

  it('never more than three Squishies on screen', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    v.tap(uiBubble(pg, 'minis')!);
    v.wait(3);
    expect(g.startSplit()).toBe(false);
    expect(g.alive.length).toBeLessThanOrEqual(CONFIG.merge.maxCreatures);
  });
});

// ---------------------------------------------------------------- secret reactions

describe('Secret reactions', () => {
  it('dizzy after a big bounce, then cools down', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    const c = main(g);
    toss(v, c, c.x + 5, c.centerY + 2);
    v.wait(5);
    expect(pg.secrets.count.dizzy).toBe(1);
    expect(pg.speech?.key ?? null).not.toBe('sayHi');
    toss(v, c, c.x - 5, c.centerY + 2);
    v.wait(5);
    expect(pg.secrets.count.dizzy).toBe(1); // still cooling down
  });

  it('cooldowns keep each surprise special', () => {
    const s = new SecretReactions();
    expect(s.fire('heart')).toBe(true);
    expect(s.fire('heart')).toBe(false);
    s.update(CONFIG.playground.secrets.heartCooldownMs / 1000 + 0.1);
    expect(s.fire('heart')).toBe(true);
  });

  it('long petting blows a heart bubble', () => {
    const { g, pg, v } = setup();
    v.wait(1);
    const c = main(g);
    const p = { x: c.x, y: c.centerY + c.size * 1.1 };
    v.jump(p.x, p.y);
    for (let i = 0; i < 8; i++) {
      v.moveTo(p.x + c.size * 0.5, p.y, 0.35);
      v.moveTo(p.x - c.size * 0.5, p.y, 0.35);
    }
    expect(pg.secrets.count.heart).toBe(1);
  });

  it('giggles when held stretched for a while', () => {
    const { g, pg, v } = setup();
    v.wait(4);
    const c = main(g);
    v.jump(c.x, c.centerY);
    v.pinch();
    // Pulled down against the floor: it stays stretched.
    v.moveTo(c.x + R * 0.3, BOUNDS.bottom + 0.1, 0.3);
    v.wait(2);
    expect(c.stretch.value).toBeGreaterThan(CONFIG.playground.secrets.giggleStretch);
    expect(pg.secrets.count.giggle).toBe(1);
  });
});

// ---------------------------------------------------------------- round lifecycle

describe('Round lifecycle', () => {
  it('a round in progress counts as "in round" (the app defers the inactivity reset)', () => {
    const { pg } = setup();
    pg.startGame('says');
    expect(pg.inRound).toBe(true);
  });

  it('nobody there for a while: the round ends gently and Free Play resumes', () => {
    const { pg, v } = setup();
    pg.startGame('bounce');
    v.lose();
    v.wait(CONFIG.playground.abandonMs / 1000 + 0.2);
    expect(pg.mode).toBe('free');
  });

  it('reset returns to the welcome state from any round', () => {
    const { g, pg } = setup();
    pg.startGame('snack');
    pg.reset();
    expect(pg.mode).toBe('free');
    expect(pg.coach).toBeNull();
    expect(g.allow).toEqual({ creatures: true, food: true });
    expect(g.dodgeEnabled).toBe(true);
  });

  it('a mini-game starts with a single Squishy even after splitting', () => {
    const { g, pg } = setup();
    g.startSplit();
    for (let i = 0; i < 60; i++) g.update(DT, NO_INPUT);
    expect(g.alive.length).toBe(3);
    pg.startGame('says');
    expect(g.alive.length).toBe(1);
  });
});

// ---------------------------------------------------------------- layout on a narrow portrait screen

describe('Safe-area placement on a narrow portrait display', () => {
  const inside = (b: Bubble, s: StageBounds) => {
    expect(b.homeX - b.r).toBeGreaterThanOrEqual(s.left - 1e-6);
    expect(b.homeX + b.r).toBeLessThanOrEqual(s.right + 1e-6);
    expect(b.homeY - b.r).toBeGreaterThanOrEqual(s.bottom - 1e-6);
    expect(b.homeY + b.r).toBeLessThanOrEqual(s.top + 1e-6);
  };

  for (const [name, s] of [
    ['portrait capsule', PORTRAIT],
    ['landscape', BOUNDS],
  ] as const) {
    it(`every bubble stays inside the safe area (${name})`, () => {
      const { pg, v } = setup(s);
      v.wait(4);
      for (const b of pg.uiBubbles) inside(b, s);
      pg.startGame('says');
      for (const b of pg.current!.bubbles) inside(b, s);
      // Answer bubbles never overlap each other.
      const sb = pg.current!.bubbles;
      for (let i = 1; i < sb.length; i++) expect(sb[i].homeX - sb[i - 1].homeX).toBeGreaterThan(sb[i].r * 2);
      const bb = new BubbleBounce({} as never);
      for (let n = 0; n < 3; n++) {
        const t = bb.targetSpot(s, n);
        expect(t.x - t.r).toBeGreaterThanOrEqual(s.left - 1e-6);
        expect(t.x + t.r).toBeLessThanOrEqual(s.right + 1e-6);
        expect(t.y + t.r).toBeLessThanOrEqual(s.top + 1e-6);
      }
      // Hit areas stay comfortable for hand tracking.
      for (const b of sb) expect(Math.max(b.r * CONFIG.playground.bubbleHitScale, s.minHitRadius)).toBeGreaterThanOrEqual(s.minHitRadius);
    });
  }
});
