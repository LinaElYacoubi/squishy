/**
 * Gameplay tests with simulated input (no camera, no rendering).
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ActivityMonitor } from '../src/game/activity';
import { Spring, createRng } from '../src/game/anim';
import type { CreatureModel } from '../src/game/creatureModel';
import type { FoodModel } from '../src/game/food';
import { Game, NO_INPUT, type GameInput } from '../src/game/game';
import { HandPipeline } from '../src/input/handPipeline';
import { InputHub, type InputSnapshot } from '../src/input/inputHub';
import { BOUNDS, makeHand } from './helpers';

const DT = 1 / 60;
const R = BOUNDS.mainRadius;

/**
 * Simulated visitor: moves a cursor and pinches. Keeps a timestamped cursor history like the
 * real InputHub, so release velocity estimation runs on realistic data.
 */
class Visitor {
  x = 5;
  y = 2.5;
  pinching = false;
  present = true;
  t = 0;
  private history: { x: number; y: number; t: number }[] = [];
  private pinchStart = false;
  private acquired = false;

  constructor(readonly g: Game) {}

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
    this.g.update(DT, input);
  }

  wait(seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.frame();
  }

  /** Move to (x, y) over `seconds`, evenly. */
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

  lose(): void {
    this.present = false;
    this.pinching = false;
    this.history = [];
    this.frame();
  }

  reacquire(): void {
    this.present = true;
    this.acquired = true;
    this.frame();
  }
}

function setup(opts: { minis?: boolean; seed?: number } = {}) {
  const g = new Game(BOUNDS, () => 0.99); // rng 0.99: never dodges, idle choices are stable
  if (opts.minis) {
    g.startWithMinis = true;
    g.reset();
  }
  const v = new Visitor(g);
  v.wait(0.1);
  return { g, v };
}

const main = (g: Game) => g.creatures[0];
const onBody = (v: Visitor, c: CreatureModel) => v.jump(c.x, c.centerY);
const onFood = (v: Visitor, f: FoodModel) => v.jump(f.x, f.y);
const settle = (v: Visitor, seconds = 4) => v.wait(seconds);

describe('Grab and stretch', () => {
  it('pinching the creature grabs it and never splits it', () => {
    const { g, v } = setup();
    onBody(v, main(g));
    v.pinch();
    expect(g.phase).toBe('grabbing');
    expect(g.grabbed).toBe(main(g));
    expect(main(g).motion).toBe('grabbed');
    v.wait(2);
    expect(g.alive).toHaveLength(1);
    expect(g.phase).toBe('grabbing');
  });

  it('the body follows the hand with lag and stretches toward it, in any direction', () => {
    for (const [dx, dy, axis] of [
      [4, 0, 'x'],
      [-4, 0, 'x'],
      [0, 2.5, 'y'],
    ] as const) {
      const { g, v } = setup();
      const c = main(g);
      onBody(v, c);
      v.pinch();
      const x0 = c.x;
      v.moveTo(v.x + dx, v.y + dy, 0.15);
      const along = axis === 'x' ? Math.abs(c.stretchAxisX) : Math.abs(c.stretchAxisY);
      expect(along).toBeGreaterThan(0.8);
      expect(c.stretch.value).toBeGreaterThan(0.15);
      // Lagging behind the hand, but following.
      if (dx !== 0) expect(Math.sign(c.x - x0)).toBe(Math.sign(dx));
      v.wait(1.5);
      expect(Math.abs(c.x - (v.x - 0))).toBeLessThan(R * 1.2);
    }
  });

  it('deformation stays within limits however hard it is pulled', () => {
    const { g, v } = setup();
    const c = main(g);
    onBody(v, c);
    v.pinch();
    for (let i = 0; i < 40; i++) {
      v.jump(i % 2 ? BOUNDS.left : BOUNDS.right, i % 3 ? BOUNDS.top : BOUNDS.bottom);
      v.wait(0.05);
      const d = c.deform();
      // Thinnest dimension never drops below ~0.65 of normal; longest never above ~1.75.
      const sx = Math.hypot(d.a, d.c);
      const sy = Math.hypot(d.b, d.d);
      expect(Math.min(sx, sy, d.z)).toBeGreaterThan(0.62);
      expect(Math.max(sx, sy)).toBeLessThan(1.8);
      // And the whole creature stays inside the stage.
      expect(c.x - c.size * 0.95).toBeGreaterThanOrEqual(BOUNDS.left - 1e-6);
      expect(c.x + c.size * 0.95).toBeLessThanOrEqual(BOUNDS.right + 1e-6);
    }
  });

  it('suspends dodging and idle movement while grabbed', () => {
    const g = new Game(BOUNDS, () => 0); // rng 0: would always dodge when allowed
    const v = new Visitor(g);
    const c = main(g);
    v.wait(0.2);
    onBody(v, c);
    v.pinch();
    for (let i = 0; i < 120; i++) {
      v.jump(c.x + R * 1.5 * (i % 2 ? 1 : -1), c.centerY);
      v.frame();
      expect(c.isHopping).toBe(false);
    }
  });
});

describe('Release and throw', () => {
  it('a slow release drops it gently, then it settles on the floor with a normal shape', () => {
    const { g, v } = setup();
    const c = main(g);
    onBody(v, c);
    v.pinch();
    v.moveTo(c.x + 2, c.centerY + 2, 1.2); // slow lift
    v.wait(0.5);
    v.release();
    expect(g.stats.throws).toBe(0);
    // No throw: only the first frame of gravity acts on it.
    expect(c.vx).toBe(0);
    expect(c.vy).toBeCloseTo(-CONFIG.throw.gravityRadii * R * DT, 6);
    settle(v);
    expect(c.motion).toBe('free');
    expect(c.y).toBeCloseTo(BOUNDS.floorY, 3);
    expect(Math.abs(c.stretch.value)).toBeLessThan(0.02);
  });

  it('a fast flick throws it, capped, and it bounces inside the stage before settling', () => {
    const { g, v } = setup();
    const c = main(g);
    onBody(v, c);
    v.pinch();
    v.moveTo(c.x - 1, c.centerY + 1, 0.4);
    v.moveTo(v.x + 5, v.y + 1.5, 0.12); // fast flick to the right
    v.release();
    expect(g.stats.throws).toBe(1);
    expect(c.vx).toBeGreaterThan(0);
    expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(CONFIG.throw.maxSpeedRadii * R + 1e-6);

    let wallHit = false;
    for (let i = 0; i < 60 * 8; i++) {
      v.frame();
      if (c.x + c.size * 0.95 >= BOUNDS.right - 1e-3) wallHit = true;
      expect(c.x - c.size * 0.95).toBeGreaterThanOrEqual(BOUNDS.left - 1e-6);
      expect(c.x + c.size * 0.95).toBeLessThanOrEqual(BOUNDS.right + 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(BOUNDS.floorY - 1e-6);
      expect(c.y + 2 * 0.86 * c.size).toBeLessThanOrEqual(BOUNDS.top + 0.05);
    }
    expect(wallHit).toBe(true);
    expect(c.motion).toBe('free');
  });

  it('losing the hand while holding releases with zero velocity (never a throw)', () => {
    const { g, v } = setup();
    const c = main(g);
    onBody(v, c);
    v.pinch();
    v.moveTo(c.x + 5, c.centerY + 1, 0.1); // moving fast when tracking drops
    v.lose();
    expect(g.phase).not.toBe('grabbing');
    expect(c.vx).toBe(0);
    expect(c.vy).toBeCloseTo(-CONFIG.throw.gravityRadii * R * DT, 6);
    expect(g.stats.throws).toBe(0);
    settle(v);
    expect(c.motion).toBe('free');
  });

  it('releasing it in mid-air and grabbing again while it falls works', () => {
    const { g, v } = setup();
    const c = main(g);
    onBody(v, c);
    v.pinch();
    v.moveTo(c.x, c.centerY + 2.5, 1);
    v.wait(0.4);
    v.release();
    v.wait(0.1);
    expect(c.motion).toBe('airborne');
    onBody(v, c);
    v.pinch();
    expect(g.grabbed).toBe(c);
  });
});

describe('Merge', () => {
  function dragOnto(v: Visitor, a: CreatureModel, b: CreatureModel, seconds = 0.8) {
    onBody(v, a);
    v.pinch();
    v.moveTo(b.x, b.centerY + 0.05, seconds);
    v.wait(0.6); // let the body catch up
  }

  it('dropping a dragged small Squishy onto another merges them by volume and colour', () => {
    const { g, v } = setup({ minis: true });
    const [a, b] = [g.creatures[1], g.creatures[2]];
    const ra = a.radiusFactor;
    const rb = b.radiusFactor;
    const colorA = [...a.color];
    const colorB = [...b.color];
    dragOnto(v, a, b);
    v.release();
    expect(g.phase).toBe('merging');
    v.wait(1);
    expect(g.alive).toHaveLength(2);
    const merged = g.alive.find((c) => c === a || c === b)!;
    expect(merged.radiusFactor).toBeCloseTo(Math.cbrt(ra ** 3 + rb ** 3), 5);
    for (let i = 0; i < 3; i++) expect(merged.color[i]).toBeCloseTo((colorA[i] + colorB[i]) / 2, 5);
    expect(g.stats.merges).toBe(1);
  });

  it('three minis merged together give back exactly one main-sized Squishy, and size is capped', () => {
    const { g, v } = setup({ minis: true });
    dragOnto(v, g.creatures[1], g.creatures[2]);
    v.release();
    v.wait(2);
    const [x, y] = g.alive;
    dragOnto(v, x.radiusFactor < y.radiusFactor ? x : y, x.radiusFactor < y.radiusFactor ? y : x);
    v.release();
    v.wait(2);
    expect(g.alive).toHaveLength(1);
    expect(g.alive[0].radiusFactor).toBeCloseTo(1, 5);
    expect(g.alive[0].radiusFactor).toBeLessThanOrEqual(CONFIG.merge.maxRadii);
  });

  it('does not merge when released away from others, on a quick tap, or on a throw past one', () => {
    const { g, v } = setup({ minis: true });
    const [a, b] = [g.creatures[1], g.creatures[2]];

    // Released away from the others.
    onBody(v, a);
    v.pinch();
    v.moveTo(a.x, a.centerY + 2, 0.8);
    v.release();
    settle(v);
    expect(g.alive).toHaveLength(3);

    // Thrown fast across another Squishy.
    onBody(v, a);
    v.pinch();
    v.wait(0.4);
    v.moveTo(b.x, b.centerY, 0.1);
    v.release();
    expect(g.phase).not.toBe('merging');
    settle(v, 6);
    expect(g.alive).toHaveLength(3);
    expect(g.stats.merges).toBe(0);
  });

  it('caps the merged size', () => {
    const { g, v } = setup({ minis: true });
    const [a, b] = [g.creatures[1], g.creatures[2]];
    a.radiusFactor = b.radiusFactor = 0.94; // cube-root of the combined volume would be ~1.18
    g.setBounds(BOUNDS);
    dragOnto(v, a, b);
    v.release();
    v.wait(1);
    expect(g.stats.merges).toBe(1);
    const merged = a.alive ? a : b;
    expect(merged.radiusFactor).toBeCloseTo(CONFIG.merge.maxRadii, 5);
    // The merged Squishy is not small any more, so it cannot be merged further.
    settle(v);
    expect(merged.radiusFactor).toBeGreaterThanOrEqual(CONFIG.merge.smallBelowRadii);
  });
});

describe('Split demo (operator only)', () => {
  it('splits one resting Squishy into three, which can then be grabbed', () => {
    const { g, v } = setup();
    expect(g.startSplit()).toBe(true);
    expect(g.phase).toBe('splitting');
    // No grabbing during the sequence.
    onBody(v, main(g));
    v.pinch();
    expect(g.grabbed).toBeNull();
    v.release();
    v.wait(1.5);
    settle(v);
    expect(g.alive).toHaveLength(3);
    expect(g.alive.every((c) => c.radiusFactor < 1)).toBe(true);
    onBody(v, g.alive[0]);
    v.pinch();
    expect(g.phase).toBe('grabbing');
  });

  it('refuses to split while something is held or when there is more than one Squishy', () => {
    const { g, v } = setup();
    onBody(v, main(g));
    v.pinch();
    expect(g.startSplit()).toBe(false);
    v.release();
    const m = setup({ minis: true });
    expect(m.g.startSplit()).toBe(false);
  });
});

describe('Feeding', () => {
  function carry(v: Visitor, f: FoodModel, x: number, y: number) {
    onFood(v, f);
    v.pinch();
    v.moveTo(x, y, 0.8);
    v.wait(0.3);
  }

  it('pick up, bring to the mouth, release: eaten once, chew, tint, puff, then respawn', () => {
    const { g, v } = setup();
    const c = main(g);
    const f = g.foods[0];
    carry(v, f, c.x, c.mouthY);
    expect(g.phase).toBe('holding-food');
    expect(g.feedTarget).toBe(c);
    expect(f.feedReady).toBe(true);
    expect(c.expression).toBe('hungry');
    v.release();
    expect(f.state).toBe('eaten');
    expect(g.stats.feeds).toBe(1);
    expect(c.chewing).toBe(true);
    expect(c.tintAmount).toBeGreaterThan(0.5);
    v.wait(0.15);
    expect(c.puff.value).toBeGreaterThan(1.03);
    v.wait(CONFIG.food.respawnMs / 1000 + 0.3);
    expect(f.state).toBe('tray');
    expect(f.x).toBeCloseTo(f.homeX, 3);
    v.wait(5);
    expect(c.puff.value).toBeCloseTo(1, 2);
    expect(c.tintAmount).toBe(0);
  });

  it('food released away from any mouth returns to the tray and is not eaten', () => {
    const { g, v } = setup();
    const f = g.foods[1];
    carry(v, f, BOUNDS.right - 1, BOUNDS.top - 1);
    expect(f.feedReady).toBe(false);
    v.release();
    expect(f.state).toBe('returning');
    v.wait(1);
    expect(f.state).toBe('tray');
    expect(f.x).toBeCloseTo(f.homeX, 3);
    expect(g.stats.feeds).toBe(0);
  });

  it('a held pinch cannot feed twice, and food lost with the hand returns to the tray', () => {
    const { g, v } = setup();
    const c = main(g);
    carry(v, g.foods[2], c.x, c.mouthY);
    v.release();
    expect(g.stats.feeds).toBe(1);
    // Keep "holding" without a new pinch: nothing else can be fed.
    v.pinching = true;
    v.wait(3);
    expect(g.stats.feeds).toBe(1);
    v.pinching = false;
    v.frame();

    carry(v, g.foods[0], c.x, c.mouthY);
    v.lose();
    expect(g.foods[0].state).toBe('returning');
    expect(g.stats.feeds).toBe(1);
  });

  it('food has priority over a creature under the same cursor, and the grab never switches targets', () => {
    const { g, v } = setup();
    const c = main(g);
    const f = g.foods[0];
    // Put the creature right behind the food.
    c.x = f.x;
    v.wait(0.05);
    onFood(v, f);
    v.pinch();
    expect(g.heldFood).toBe(f);
    v.moveTo(c.x + 3, c.centerY + 1, 0.5);
    expect(g.heldFood).toBe(f);
    expect(g.grabbed).toBeNull();
  });

  it('with several Squishies, only the one whose mouth is closest eats', () => {
    const { g, v } = setup({ minis: true });
    const [a, b] = [g.creatures[1], g.creatures[2]];
    carry(v, g.foods[0], b.x + (a.x - b.x) * 0.2, b.mouthY);
    expect(g.feedTarget).toBe(b);
    v.release();
    expect(b.chewing).toBe(true);
    expect(a.chewing).toBe(false);
  });

  it('creatures watch food as it approaches', () => {
    const { g, v } = setup();
    const c = main(g);
    const f = g.foods[0];
    onFood(v, f);
    v.pinch();
    v.moveTo(c.x + R * 2.5, c.centerY + R * 1.5, 0.5);
    v.wait(0.3);
    expect(c.lookX).toBeGreaterThan(0.3);
    expect(c.lookY).toBeGreaterThan(0.2);
  });
});

describe('Reset', () => {
  const scenarios: [string, (g: Game, v: Visitor) => void][] = [
    ['grabbing', (g, v) => {
      onBody(v, main(g));
      v.pinch();
      v.moveTo(v.x + 3, v.y + 1, 0.3);
    }],
    ['thrown', (g, v) => {
      onBody(v, main(g));
      v.pinch();
      v.wait(0.3);
      v.moveTo(v.x + 5, v.y, 0.1);
      v.release();
    }],
    ['holding food', (g, v) => {
      onFood(v, g.foods[1]);
      v.pinch();
      v.moveTo(0, 0, 0.3);
    }],
    ['eating', (g, v) => {
      onFood(v, g.foods[0]);
      v.pinch();
      v.moveTo(main(g).x, main(g).mouthY, 0.5);
      v.release();
    }],
    ['splitting', (g) => void g.startSplit()],
    ['split', (g, v) => {
      g.startSplit();
      v.wait(3);
    }],
    ['merging', (g, v) => {
      g.startSplit();
      v.wait(4);
      const [a, b] = g.alive;
      onBody(v, a);
      v.pinch();
      v.moveTo(b.x, b.centerY, 0.6);
      v.wait(0.6);
      v.release();
      expect(g.phase).toBe('merging');
    }],
  ];

  for (const [name, drive] of scenarios) {
    it(`restores the default arrangement from: ${name}`, () => {
      const { g, v } = setup();
      drive(g, v);
      g.reset();
      expect(g.phase).not.toMatch(/grabbing|holding-food|splitting|merging/);
      expect(g.grabbed).toBeNull();
      expect(g.heldFood).toBeNull();
      expect(g.alive).toHaveLength(1);
      const c = main(g);
      expect(c.radiusFactor).toBe(1);
      expect(c.color).toEqual([0xff / 255, 0x6f / 255, 0xcf / 255]);
      expect(c.tintAmount).toBe(0);
      expect(c.chewing).toBe(false);
      expect(c.motion).toBe('free');
      expect(c.x).toBeCloseTo(0);
      for (const f of g.foods) {
        expect(f.state).toBe('tray');
        expect(f.x).toBe(f.homeX);
      }
      // Still holding the pinch from before the reset: nothing is grabbed until a new pinch.
      v.wait(1);
      expect(g.grabbed).toBeNull();
      v.release();
      onBody(v, c);
      v.pinch();
      expect(g.phase).toBe('grabbing');
    });
  }

  it('with the operator option, reset gives three small Squishies', () => {
    const { g } = setup({ minis: true });
    expect(g.alive).toHaveLength(3);
    expect(g.alive.every((c) => c.radiusFactor < 1)).toBe(true);
  });
});

describe('Playful dodge', () => {
  function approachCycles(g: Game, v: Visitor, cycles: number): number {
    let dodges = 0;
    v.jump(5.5, 2.5);
    v.wait(0.2);
    for (let i = 0; i < cycles; i++) {
      const c = main(g);
      v.jump(c.x + c.radius * 1.5, c.centerY);
      v.frame();
      if (c.isHopping) dodges++;
      v.wait(0.8);
      v.jump(c.x > 0 ? BOUNDS.left + 0.3 : BOUNDS.right - 0.3, BOUNDS.top - 0.2);
      v.wait(0.8);
    }
    return dodges;
  }

  it('dodges at most maxConsecutive times, then offers a clear grab', () => {
    const g = new Game(BOUNDS, () => 0);
    const v = new Visitor(g);
    expect(approachCycles(g, v, 4)).toBe(CONFIG.dodge.maxConsecutive);
    expect(g.inGrabWindow).toBe(true);
    onBody(v, main(g));
    v.pinch();
    expect(g.phase).toBe('grabbing');
  });

  it('a pinch on arrival grabs before any dodge can start', () => {
    const g = new Game(BOUNDS, () => 0);
    const v = new Visitor(g);
    v.wait(0.2);
    onBody(v, main(g));
    v.pinch();
    expect(g.phase).toBe('grabbing');
    expect(main(g).isHopping).toBe(false);
  });

  it('reduced motion dodges less', () => {
    const g = new Game(BOUNDS, () => 0);
    g.setReducedMotion(true);
    expect(approachCycles(g, new Visitor(g), 4)).toBe(CONFIG.reducedMotion.dodgeMaxConsecutive);
  });
});

describe('End-to-end: landmarks -> pipeline -> hub -> game', () => {
  function handWithTipAt(u: number, v: number, ratio: number) {
    const probe = makeHand({ ratio });
    const dx = u - probe[8].x;
    const dy = v - probe[8].y;
    return probe.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  }
  const toUV = (x: number, y: number) => ({
    u: (x - BOUNDS.left) / (BOUNDS.right - BOUNDS.left),
    v: (BOUNDS.top - y) / (BOUNDS.top - BOUNDS.bottom),
  });
  const toInput = (s: InputSnapshot): GameInput => ({
    present: s.present,
    active: true,
    x: BOUNDS.left + s.u * (BOUNDS.right - BOUNDS.left),
    y: BOUNDS.top - s.v * (BOUNDS.top - BOUNDS.bottom),
    pinching: s.pinching,
    pinchStart: s.pinchStart,
    acquired: s.acquired,
    recent: s.history.map((h) => ({
      x: BOUNDS.left + h.u * (BOUNDS.right - BOUNDS.left),
      y: BOUNDS.top - h.v * (BOUNDS.top - BOUNDS.bottom),
      t: h.t,
    })),
  });

  function setupE2E() {
    const hub = new InputHub(CONFIG.hit.historyMs);
    const pipe = new HandPipeline(hub);
    pipe.mapper.mirror = false;
    pipe.mapper.region = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const g = new Game(BOUNDS, createRng(7));
    let t = 0;
    /** Two render frames per inference frame (60 fps render, 30 Hz inference). */
    const frame = (hands: ReturnType<typeof makeHand>[]) => {
      t += 33;
      pipe.process(hands, t, 4 / 3);
      g.update(DT, toInput(hub.take(t)));
      g.update(DT, toInput(hub.take(t + 16)));
    };
    return { g, frame };
  }

  it('a held pinch grabs once and holds; opening the hand releases', () => {
    const { g, frame } = setupE2E();
    const at = toUV(g.creatures[0].x, g.creatures[0].centerY);
    for (let i = 0; i < 6; i++) frame([handWithTipAt(at.u, at.v, 1.05)]);
    for (let i = 0; i < 90; i++) frame([handWithTipAt(at.u, at.v, 0.08)]);
    expect(g.stats.grabs).toBe(1);
    expect(g.phase).toBe('grabbing');
    expect(g.alive).toHaveLength(1);
    for (let i = 0; i < 4; i++) frame([handWithTipAt(at.u, at.v, 1.05)]);
    expect(g.phase).not.toBe('grabbing');
    expect(g.stats.throws).toBe(0);
  });

  it('pinch away, then slide onto the creature while pinched: no grab until release and re-pinch', () => {
    const { g, frame } = setupE2E();
    const far = toUV(BOUNDS.right - 0.5, BOUNDS.top - 0.5);
    const on = toUV(g.creatures[0].x, g.creatures[0].centerY);
    for (let i = 0; i < 6; i++) frame([handWithTipAt(far.u, far.v, 1.05)]);
    for (let i = 0; i < 4; i++) frame([handWithTipAt(far.u, far.v, 0.08)]);
    for (let k = 1; k <= 20; k++) {
      frame([handWithTipAt(far.u + ((on.u - far.u) * k) / 20, far.v + ((on.v - far.v) * k) / 20, 0.08)]);
    }
    for (let i = 0; i < 10; i++) frame([handWithTipAt(on.u, on.v, 0.08)]);
    expect(g.stats.grabs).toBe(0);
    for (let i = 0; i < 15; i++) frame([handWithTipAt(on.u, on.v, 1.05)]);
    for (let i = 0; i < 3; i++) frame([handWithTipAt(on.u, on.v, 0.08)]);
    expect(g.stats.grabs).toBe(1);
  });

  it('tracking loss during a grab drops gently; a closed hand returning cannot grab', () => {
    const { g, frame } = setupE2E();
    const on = toUV(g.creatures[0].x, g.creatures[0].centerY);
    for (let i = 0; i < 6; i++) frame([handWithTipAt(on.u, on.v, 1.05)]);
    for (let i = 0; i < 4; i++) frame([handWithTipAt(on.u, on.v, 0.08)]);
    expect(g.phase).toBe('grabbing');
    // Hand moves fast, then disappears.
    for (let k = 1; k <= 3; k++) frame([handWithTipAt(on.u + 0.06 * k, on.v, 0.08)]);
    for (let i = 0; i < 15; i++) frame([]);
    expect(g.phase).not.toBe('grabbing');
    expect(g.stats.throws).toBe(0);
    for (let i = 0; i < 30; i++) frame([handWithTipAt(on.u, on.v, 0.08)]);
    expect(g.stats.grabs).toBe(1);
  });
});

describe('ActivityMonitor', () => {
  const snap = (u: number, v: number, extra: Partial<InputSnapshot> = {}): InputSnapshot => ({
    present: true,
    u,
    v,
    pinching: false,
    pinchStart: false,
    acquired: false,
    history: [],
    ...extra,
  });

  it('a stationary hand times out once and stops counting as active', () => {
    const a = new ActivityMonitor(30000, 0.035);
    a.update(0, snap(0.5, 0.5, { acquired: true }));
    let fired = 0;
    let last = a.update(0, snap(0.5, 0.5));
    for (let t = 100; t <= 40000; t += 100) {
      last = a.update(t, snap(0.5 + Math.sin(t) * 0.005, 0.5));
      if (last.timedOut) fired++;
    }
    expect(fired).toBe(1);
    expect(last.active).toBe(false);
  });

  it('movement keeps an active player active (never interrupted)', () => {
    const a = new ActivityMonitor(30000, 0.035);
    let fired = 0;
    a.update(0, snap(0.5, 0.5, { acquired: true }));
    for (let t = 100; t <= 120000; t += 100) {
      const r = a.update(t, snap(0.5 + 0.3 * Math.sin(t / 2000), 0.5));
      if (r.timedOut) fired++;
      expect(r.active).toBe(true);
    }
    expect(fired).toBe(0);
  });

  it('times out when nobody is present', () => {
    const a = new ActivityMonitor(30000, 0.035);
    a.update(0, snap(0.5, 0.5, { acquired: true }));
    const r = a.update(31000, { ...snap(0.5, 0.5), present: false });
    expect(r.timedOut).toBe(true);
  });
});

describe('Frame-rate independence', () => {
  it('springs settle the same at 30 and 144 fps', () => {
    const a = new Spring(0.6, 1, 260, 9);
    const b = new Spring(0.6, 1, 260, 9);
    for (let i = 0; i < 15; i++) a.update(1 / 30);
    for (let i = 0; i < 72; i++) b.update(1 / 144);
    expect(a.value).toBeCloseTo(b.value, 2);
  });

  it('large frame gaps (tab switch) are clamped', () => {
    const g = new Game(BOUNDS, createRng(8));
    const before = g.time;
    g.update(5, NO_INPUT);
    expect(g.time - before).toBeCloseTo(CONFIG.render.maxDeltaSeconds);
  });
});
