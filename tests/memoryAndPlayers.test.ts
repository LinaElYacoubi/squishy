/**
 * Two players (two followed hands) and Squishy's memory (hunger, sleep, fondness, favourite
 * snack). Simulated input only: synthetic landmarks for tracking, plain cursor positions for
 * gameplay. No camera and no rendering.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createRng } from '../src/game/anim';
import type { CreatureModel } from '../src/game/creatureModel';
import { Game, NO_INPUT, type GameInput } from '../src/game/game';
import { SquishyMemory, type MemoryCue } from '../src/game/playground/memory';
import { Playground } from '../src/game/playground/playground';
import { HandPipeline } from '../src/input/handPipeline';
import { MultiHandSelector, toCandidate } from '../src/input/handSelection';
import { InputHub } from '../src/input/inputHub';
import { BOUNDS, makeHand } from './helpers';

const ASPECT = 4 / 3;
const FRAME = 33;
const DT = 1 / 60;
const M = CONFIG.playground.memory;

// ---------------------------------------------------------------- tracking two hands

describe('MultiHandSelector', () => {
  const cand = (cx: number, cy = 0.5) => toCandidate(makeHand({ cx, cy }), ASPECT);

  it('follows two hands, one per player, without ever sharing a hand', () => {
    const s = new MultiHandSelector(2);
    let t = 0;
    let r = s.update([cand(0.3), cand(0.7)], t, ASPECT);
    for (let i = 0; i < 10; i++) r = s.update([cand(0.3), cand(0.7)], (t += FRAME), ASPECT);
    expect(r.map((x) => x.kind)).toEqual(['tracking', 'tracking']);
    const xs = r.map((x) => (x.kind === 'tracking' ? x.hand.cx : -1));
    expect(new Set(xs).size).toBe(2);
  });

  it('a single hand is only ever followed by one player', () => {
    const s = new MultiHandSelector(2);
    let t = 0;
    let r = s.update([cand(0.5)], t, ASPECT);
    for (let i = 0; i < 10; i++) r = s.update([cand(0.5)], (t += FRAME), ASPECT);
    expect(r.filter((x) => x.kind === 'tracking')).toHaveLength(1);
  });

  it('players keep their own hands as they move, and a briefly missing hand is not stolen', () => {
    const s = new MultiHandSelector(2);
    let t = 0;
    for (let i = 0; i < 6; i++) s.update([cand(0.3), cand(0.7)], (t += FRAME), ASPECT);
    // Both hands drift a little: each player stays with theirs.
    let r = s.update([cand(0.33), cand(0.68)], (t += FRAME), ASPECT);
    const p1 = r[0].kind === 'tracking' ? r[0].hand.cx : -1;
    const p2 = r[1].kind === 'tracking' ? r[1].hand.cx : -1;
    // Player 2's hand drops out for a moment; player 1 must not take over its spot.
    r = s.update([cand(p1)], (t += FRAME), ASPECT);
    expect(r[1].kind).toBe('holding');
    r = s.update([cand(p1), cand(p2)], (t += FRAME), ASPECT);
    expect(r[0].kind === 'tracking' && r[0].hand.cx).toBeCloseTo(p1);
    expect(r[1].kind === 'tracking' && r[1].hand.cx).toBeCloseTo(p2);
  });

  it('with two players off, only one hand is followed', () => {
    const s = new MultiHandSelector(2);
    s.setActiveSlots(1);
    let t = 0;
    let r = s.update([cand(0.3), cand(0.7)], t, ASPECT);
    for (let i = 0; i < 10; i++) r = s.update([cand(0.3), cand(0.7)], (t += FRAME), ASPECT);
    expect(r[0].kind).toBe('tracking');
    expect(r[1].kind).toBe('none');
  });
});

describe('HandPipeline with two players', () => {
  it("each hand drives its own cursor, and one player's pinch is not the other's", () => {
    const hubs = [new InputHub(CONFIG.hit.historyMs), new InputHub(CONFIG.hit.historyMs)];
    const pipe = new HandPipeline(hubs);
    pipe.mapper.mirror = false;
    pipe.mapper.region = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    let t = 1000;
    const starts = [0, 0];
    const feed = (hands: ReturnType<typeof makeHand>[], n: number) => {
      for (let i = 0; i < n; i++) {
        pipe.process(hands, (t += FRAME), ASPECT);
        hubs.forEach((h, k) => (starts[k] += h.take(t).pinchStart ? 1 : 0));
      }
    };
    feed([makeHand({ cx: 0.25 }), makeHand({ cx: 0.75 })], 8);
    expect(hubs.map((h) => h.present)).toEqual([true, true]);
    expect(hubs[0].u).toBeLessThan(0.5);
    expect(hubs[1].u).toBeGreaterThan(0.5);
    expect(pipe.debug.players).toBe(2);

    // Only the right-hand player pinches.
    feed([makeHand({ cx: 0.25 }), makeHand({ cx: 0.75, ratio: 0.08 })], 10);
    expect(starts).toEqual([0, 1]);
    expect(hubs[1].pinching).toBe(true);
    expect(hubs[0].pinching).toBe(false);

    // Switching two players off removes player 2 right away.
    pipe.setPlayerCount(1);
    expect(hubs[1].present).toBe(false);
  });
});

// ---------------------------------------------------------------- two players in the game

/** One simulated hand, producing a GameInput each frame. */
class Hand {
  pinching = false;
  present = false;
  private start = false;
  private history: { x: number; y: number; t: number }[] = [];
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  at(x: number, y: number): this {
    this.x = x;
    this.y = y;
    this.present = true;
    return this;
  }
  pinch(): void {
    this.pinching = true;
    this.start = true;
  }
  release(): void {
    this.pinching = false;
  }
  input(t: number): GameInput {
    if (!this.present) return { ...NO_INPUT };
    this.history.push({ x: this.x, y: this.y, t });
    this.history = this.history.filter((p) => p.t >= t - CONFIG.hit.historyMs);
    const inp: GameInput = {
      present: true,
      active: true,
      x: this.x,
      y: this.y,
      pinching: this.pinching,
      pinchStart: this.start,
      acquired: false,
      recent: this.history.slice(),
    };
    this.start = false;
    return inp;
  }
}

function setup(minis = false) {
  const g = new Game(BOUNDS, () => 0.99);
  g.startWithMinis = minis;
  g.reset();
  const pg = new Playground(g, createRng(3));
  g.events = {
    onRelease: (k, c) => c && pg.onRelease(k, c),
    onOffer: (f, c) => pg.onOffer(f, c),
    onFeed: (f, c) => f && c && pg.onFeed(f, c),
    onLand: (c, l) => pg.onLand(c, l),
    onMerge: (s, a) => s && a && pg.onMerge(s, a),
    onSplit: () => pg.onSplit(),
    beforeAnimate: (dt) => pg.animate(dt),
  };
  const hands = [new Hand(), new Hand()];
  let t = 0;
  const step = (seconds = DT) => {
    for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
      t += DT * 1000;
      g.update(DT, pg.preUpdate(DT, hands.map((h) => h.input(t))));
    }
  };
  return { g, pg, hands, step };
}

/** Hold food i up to creature c's mouth and let go. */
function feed(h: Hand, g: Game, step: (s?: number) => void, c: CreatureModel, i = 0): void {
  const f = g.foods[i];
  h.at(f.x, f.y);
  step(0.05);
  h.pinch();
  step(0.05);
  h.at(c.x, c.mouthY);
  step(0.4);
  h.release();
  step(0.05);
}

describe('Two players in the game', () => {
  it('one player holds Squishy while the other carries a snack', () => {
    const { g, hands, step } = setup();
    const c = g.alive[0];
    const f = g.foods[0];
    hands[0].at(c.x, c.centerY);
    hands[1].at(f.x, f.y);
    step(0.1);
    hands[0].pinch();
    hands[1].pinch();
    step(0.1);
    expect(g.grabbedBy(0)).toBe(c);
    expect(g.heldFoodBy(1)).toBe(f);
    expect(g.calm).toBe(false);

    // Player 1 lets go; player 2 still carries the snack.
    hands[0].release();
    step(0.05);
    expect(g.grabbedBy(0)).toBeNull();
    expect(g.heldFoodBy(1)).toBe(f);
  });

  it('a Squishy held by one player cannot be taken by the other', () => {
    const { g, hands, step } = setup();
    const c = g.alive[0];
    hands[0].at(c.x, c.centerY);
    step(0.1);
    hands[0].pinch();
    step(0.1);
    hands[1].at(c.x, c.centerY);
    step(0.05);
    hands[1].pinch();
    step(0.05);
    expect(g.grabbedBy(0)).toBe(c);
    expect(g.grabbedBy(1)).toBeNull();
  });

  it('with three minis, each player can hold their own', () => {
    const { g, hands, step } = setup(true);
    const [a, b] = g.alive;
    hands[0].at(a.x, a.centerY);
    hands[1].at(b.x, b.centerY);
    step(0.1);
    hands[0].pinch();
    hands[1].pinch();
    step(0.1);
    expect(g.grabbedAll).toHaveLength(2);
    expect(g.grabbedBy(0)).toBe(a);
    expect(g.grabbedBy(1)).toBe(b);
  });

  it('a lost hand drops only what that player was holding', () => {
    const { g, hands, step } = setup(true);
    const [a, b] = g.alive;
    hands[0].at(a.x, a.centerY);
    hands[1].at(b.x, b.centerY);
    step(0.1);
    hands[0].pinch();
    hands[1].pinch();
    step(0.1);
    hands[1].present = false;
    step(0.05);
    expect(g.grabbedBy(0)).toBe(a);
    expect(g.grabbedBy(1)).toBeNull();
    expect(b.launch === 'lost' || b.motion === 'free').toBe(true);
  });

  it('a second hand joining makes Squishy say "Two friends!"', () => {
    const { g, pg, hands, step } = setup();
    hands[0].at(BOUNDS.right - 0.5, BOUNDS.bottom + 0.5);
    step(2);
    hands[1].at(BOUNDS.left + 0.5, BOUNDS.bottom + 0.5);
    step(0.1);
    expect(pg.speech?.key).toBe('sayTwoFriends');
    expect(g.alive[0].expression).toBe('excited');
  });
});

// ---------------------------------------------------------------- memory (pure logic)

describe('SquishyMemory', () => {
  const run = (m: SquishyMemory, seconds: number, present = true, canNag = true) => {
    const cues: MemoryCue[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) cues.push(...m.update(DT, present, canNag));
    return cues;
  };

  it('gets full after a couple of snacks, refuses for a while, then is peckish again', () => {
    const m = new SquishyMemory();
    m.feed('berry');
    expect(m.wouldRefuse()).toBe(false);
    m.feed('fruit');
    expect(m.full).toBe(true);
    expect(m.wouldRefuse()).toBe(true);
    run(m, 5);
    expect(m.wouldRefuse()).toBe(true);
    run(m, M.fullUntil * M.hungerRiseS + 1);
    expect(m.wouldRefuse()).toBe(false);
  });

  it('gets hungry while someone plays and asks for a snack now and then, not constantly', () => {
    const m = new SquishyMemory();
    const cues = run(m, (M.hungryAt - M.startHunger) * M.hungerRiseS + M.hungerNagS * 2 + 1);
    const asks = cues.filter((c) => c === 'hungry').length;
    expect(m.hungry).toBe(true);
    expect(asks).toBeGreaterThanOrEqual(1);
    expect(asks).toBeLessThanOrEqual(3);
  });

  it('does not get hungrier while nobody is there, and never nags when it would get in the way', () => {
    const m = new SquishyMemory();
    run(m, 60, false);
    expect(m.hunger).toBeCloseTo(M.startHunger);
    m.hunger = 0.9;
    expect(run(m, 30, true, false)).not.toContain('hungry');
  });

  it('remembers a favourite snack', () => {
    const m = new SquishyMemory();
    expect(m.feed('blueberry')).not.toBe('new-favourite');
    expect(m.feed('blueberry')).toBe('new-favourite');
    expect(m.favourite).toBe('blueberry');
    m.hunger = 0.8;
    expect(m.feed('blueberry')).toBe('favourite');
    // A new visitor does not erase it; an operator reset does.
    m.newVisitor();
    expect(m.favourite).toBe('blueberry');
    m.reset();
    expect(m.favourite).toBeNull();
  });

  it('dozes off after a long pet, snores, and wakes up by itself', () => {
    const m = new SquishyMemory();
    const cues: MemoryCue[] = [];
    for (let i = 0; i < Math.round((M.petToSleepS + 0.5) / DT); i++) {
      m.pet(DT, 0);
      cues.push(...m.update(DT, true, true));
    }
    expect(cues).toContain('fall-asleep');
    expect(m.asleep).toBe(true);
    const later = run(m, M.sleepMaxS + 0.5);
    expect(later).toContain('snore');
    expect(later).toContain('wake-up');
    expect(m.asleep).toBe(false);
  });

  it('a short pet only makes it a little sleepy, and that wears off', () => {
    const m = new SquishyMemory();
    for (let i = 0; i < Math.round(2 / DT); i++) {
      m.pet(DT, 0);
      m.update(DT, true, true);
    }
    expect(m.asleep).toBe(false);
    expect(m.sleepiness).toBeGreaterThan(0.2);
    run(m, 20);
    expect(m.sleepiness).toBe(0);
  });

  it('becomes friends with a kind visitor, welcomes them back, and forgets after a long absence', () => {
    const m = new SquishyMemory();
    m.feed('berry');
    m.feed('fruit');
    const cues: MemoryCue[] = [];
    for (let i = 0; i < Math.round(4 / DT); i++) {
      m.pet(DT, 0);
      cues.push(...m.update(DT, true, true));
    }
    expect(cues).toContain('friend');
    expect(m.friend).toBe(true);

    run(m, 4, false);
    expect(run(m, 0.1, true)).toContain('welcome-back');

    run(m, M.welcomeBackMs / 1000 + 1, false);
    expect(m.friend).toBe(false);
    expect(run(m, 0.1, true)).not.toContain('welcome-back');
  });
});

// ---------------------------------------------------------------- memory in Free Play

describe("Squishy's memory in Free Play", () => {
  it('a full Squishy turns a snack down and the snack goes back to the tray', () => {
    const { g, pg, hands, step } = setup();
    const c = g.alive[0];
    pg.memory.feed('berry');
    pg.memory.feed('fruit');
    expect(pg.memory.full).toBe(true);
    const before = g.stats.feeds;
    feed(hands[0], g, step, c, 2);
    expect(g.stats.feeds).toBe(before);
    expect(pg.speech?.key).toBe('sayFull');
    step(1);
    expect(g.foods[2].state).toBe('tray');
  });

  it('the second snack of one kind becomes the favourite, with a heart', () => {
    const { g, pg, hands, step } = setup();
    const hearts: number[] = [];
    pg.fx = { ...pg.fx, heart: (x) => hearts.push(x) };
    const c = g.alive[0];
    feed(hands[0], g, step, c, 0);
    step(CONFIG.food.respawnMs / 1000 + 0.5);
    feed(hands[0], g, step, c, 0);
    expect(g.stats.feeds).toBe(2);
    expect(pg.memory.favourite).toBe(g.foods[0].kind);
    expect(pg.speech?.key).toBe('sayFavourite');
    expect(hearts.length).toBeGreaterThan(0);
  });

  it('a sleeping Squishy closes its eyes and stays put, and wakes when picked up', () => {
    const { g, pg, hands, step } = setup();
    const c = g.alive[0];
    pg.memory.pet(DT, c.slot);
    pg.memory.sleepiness = 1;
    pg.memory.pet(DT, c.slot);
    hands[0].at(c.x + c.size * 1.5, c.centerY);
    step(0.2);
    expect(pg.memory.asleep).toBe(true);
    // (A short greeting reaction may still play on top; the resting face is asleep.)
    expect(c.baseExpression).toBe('sleepy');
    expect(g.dodgeEnabled).toBe(false);

    hands[0].at(c.x, c.centerY);
    step(0.05);
    hands[0].pinch();
    step(0.1);
    expect(g.grabbedBy(0)).toBe(c);
    expect(pg.memory.asleep).toBe(false);
  });

  it('a friend is never dodged', () => {
    const { g, pg, hands, step } = setup();
    hands[0].at(BOUNDS.right - 0.5, BOUNDS.bottom + 0.5);
    step(0.2);
    expect(g.dodgeEnabled).toBe(true);
    pg.memory.fondness = 1;
    step(0.1);
    expect(pg.memory.friend).toBe(true);
    expect(g.dodgeEnabled).toBe(false);
  });

  it('mini-games pause the moods', () => {
    const { pg, hands, step } = setup();
    hands[0].at(BOUNDS.right - 0.5, BOUNDS.bottom + 0.5);
    pg.startGame('says');
    const h = pg.memory.hunger;
    step(10);
    expect(pg.memory.hunger).toBe(h);
  });
});
