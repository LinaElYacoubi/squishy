import { CONFIG } from '../config';
import { approach, clamp, easeInOut, lerp } from './anim';
import { BODY_BOTTOM, CreatureModel, hexToRgb, type RGB } from './creatureModel';
import { FOOD_KINDS, FoodModel } from './food';
import { estimateThrowVelocity, type ThrowSettings, type TimedPoint } from './throw';

/** Stage limits on the creature plane, in world units. Recomputed on every resize. */
export interface StageBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
  floorY: number;
  mainRadius: number;
  /** Smallest allowed mini radius. */
  miniMinRadius: number;
  /** Smallest allowed hit radius, so targets stay comfortable for hand tracking. */
  minHitRadius: number;
  /** Food tray centre (food rests at trayY) and food layout. */
  trayX: number;
  trayY: number;
  foodRadius: number;
  foodSpacing: number;
}

/** Input for one game update, already converted to world units. */
export interface GameInput {
  /** A cursor exists (hand tracked, or mouse over the page in mouse test mode). */
  present: boolean;
  /** The visitor is actively interacting (not a stationary, ignored hand). */
  active: boolean;
  x: number;
  y: number;
  pinching: boolean;
  /** A new pinch began this frame. */
  pinchStart: boolean;
  /** A hand was (re)acquired this frame. */
  acquired: boolean;
  /** Recent cursor positions with timestamps (ms), oldest first, newest = current. */
  recent: readonly TimedPoint[];
}

export const NO_INPUT: GameInput = {
  present: false,
  active: false,
  x: 0,
  y: 0,
  pinching: false,
  pinchStart: false,
  acquired: false,
  recent: [],
};

export type GamePhase = 'idle' | 'attentive' | 'grabbing' | 'holding-food' | 'splitting' | 'merging';
export type HoverKind = 'none' | 'food' | 'creature';

export interface GameEvents {
  onGrab?: (kind: 'creature' | 'food') => void;
  onRelease?: (kind: 'drop' | 'throw' | 'lost') => void;
  onFeed?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
}

/** The single interaction a visitor can have at a time. A grabbed target is kept until release. */
type Interaction =
  | { kind: 'none' }
  | { kind: 'creature'; c: CreatureModel; gx: number; gy: number; startedAt: number }
  | { kind: 'food'; f: FoodModel; startedAt: number };

/** Short scripted sequences. While one runs, nothing new can be grabbed. */
type Sequence =
  | { kind: 'split'; src: CreatureModel; t0: number; spawned: boolean }
  | {
      kind: 'merge';
      a: CreatureModel;
      b: CreatureModel;
      t0: number;
      ax: number;
      ay: number;
      bx: number;
      by: number;
      fx: number;
      fy: number;
    };

const NONE: Interaction = { kind: 'none' };
const SLOT_COLORS: RGB[] = [CONFIG.creature.mainColor, ...CONFIG.creature.miniColors].map(hexToRgb);
/** Three minis together have the volume of one main creature. */
const MINI_FACTOR = 1 / Math.cbrt(3);
const SPLIT_SQUASH_S = 0.42;
const SPLIT_END_S = 0.82;

/**
 * Gameplay. Everything is driven by one gesture: PINCH -> MOVE -> RELEASE.
 *   pinch over food      -> carry it; release near a mouth to feed, elsewhere it returns to the tray
 *   pinch over a creature -> grab and stretch; release slowly to drop, quickly to throw;
 *                           release a small one over another to merge them
 * Splitting is an operator demonstration (startSplit), never a visitor gesture.
 * Rendering-agnostic: it only updates CreatureModel and FoodModel data.
 */
export class Game {
  readonly creatures: CreatureModel[];
  readonly foods: FoodModel[];
  events: GameEvents = {};
  /** Operator option: the default arrangement is three small Squishies instead of one. */
  startWithMinis = false;
  /** Creature that would eat the held food if released now (for feedback). */
  feedTarget: CreatureModel | null = null;
  /** Seconds since start. */
  time = 0;
  /** Diagnostics counters. */
  stats = { grabs: 0, throws: 0, feeds: 0, merges: 0 };

  private b: StageBounds;
  private reduced = false;
  private interaction: Interaction = NONE;
  private sequence: Sequence | null = null;
  private lastActive = false;

  // Dodge bookkeeping (applies to the creature nearest to the cursor).
  private dodgeSlot = -1;
  private lastDodgeAt = -Infinity;
  private dodgeStreak = 0;
  private grabWindowUntil = 0;
  private cursorNear = false;
  private lastNearAt = -Infinity;
  private acquiredAt = -Infinity;

  constructor(
    bounds: StageBounds,
    private rng: () => number = Math.random,
  ) {
    this.b = bounds;
    this.creatures = [0, 1, 2, 3].map((slot) => new CreatureModel(slot, rng));
    this.foods = FOOD_KINDS.map((kind, i) => new FoodModel(kind, i));
    this.layoutFood();
    this.reset();
  }

  get bounds(): StageBounds {
    return this.b;
  }

  get homeX(): number {
    return (this.b.left + this.b.right) / 2;
  }

  get alive(): CreatureModel[] {
    return this.creatures.filter((c) => c.alive);
  }

  get grabbed(): CreatureModel | null {
    return this.interaction.kind === 'creature' ? this.interaction.c : null;
  }

  get heldFood(): FoodModel | null {
    return this.interaction.kind === 'food' ? this.interaction.f : null;
  }

  get busy(): boolean {
    return this.sequence !== null;
  }

  get phase(): GamePhase {
    if (this.sequence) return this.sequence.kind === 'split' ? 'splitting' : 'merging';
    if (this.interaction.kind === 'creature') return 'grabbing';
    if (this.interaction.kind === 'food') return 'holding-food';
    return this.lastActive ? 'attentive' : 'idle';
  }

  get dodgeStreakCount(): number {
    return this.dodgeStreak;
  }

  get inGrabWindow(): boolean {
    return this.time < this.grabWindowUntil;
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    const wobble = reduced ? CONFIG.reducedMotion.wobbleScale : 1;
    const stretch = CONFIG.grab.maxStretch * (reduced ? CONFIG.reducedMotion.stretchScale : 1);
    for (const c of this.creatures) {
      c.setWobbleScale(wobble);
      c.setMaxStretch(stretch);
    }
  }

  /**
   * Restore the default arrangement, colours, sizes and food, with no interaction, sequence or
   * pending timer. `gentle` makes the creatures pop back in instead of appearing instantly.
   * Never creates loops or listeners.
   */
  reset(gentle = false): void {
    this.interaction = NONE;
    this.sequence = null;
    this.feedTarget = null;
    for (const c of this.creatures) {
      c.clearEffects();
      c.alive = false;
      c.grow.snap(0);
    }
    const spawn = (c: CreatureModel, factor: number, x: number) => {
      c.alive = true;
      c.radiusFactor = factor;
      this.applyRadius(c);
      c.color = [...SLOT_COLORS[c.slot]];
      c.x = clamp(x, this.b.left + c.radius, this.b.right - c.radius);
      c.y = this.b.floorY;
      c.grow.snap(gentle ? 0.4 : 1);
      c.grow.target = 1;
      c.nextIdleAt = c.clock + 3 + this.rng() * 3;
    };
    if (this.startWithMinis) {
      const f = this.miniFactor(1);
      const spacing = f * this.b.mainRadius * 2.5;
      for (let k = 0; k < 3; k++) spawn(this.creatures[k + 1], f, this.homeX + (k - 1) * spacing);
    } else {
      spawn(this.creatures[0], 1, this.homeX);
    }
    for (const f of this.foods) f.restore();
    this.resetDodge();
  }

  setBounds(bounds: StageBounds): void {
    this.b = bounds;
    for (const c of this.alive) {
      this.applyRadius(c);
      c.x = clamp(c.x, bounds.left + c.radius, bounds.right - c.radius);
      if (c.motion === 'free') {
        c.cancelHop();
        c.y = bounds.floorY;
      } else {
        c.y = clamp(c.y, bounds.floorY, Math.max(bounds.floorY, bounds.top - c.radius * 2 * BODY_BOTTOM));
      }
    }
    this.layoutFood();
    for (const f of this.foods) {
      if (f.state === 'tray') {
        f.x = f.homeX;
        f.y = f.homeY;
      }
    }
  }

  /** What a pinch at the cursor would pick up right now (cursor feedback). */
  hover(input: GameInput): HoverKind {
    if (!input.present || this.interaction.kind !== 'none' || this.sequence) return 'none';
    if (this.pickFood([input])) return 'food';
    if (this.pickCreature([input])) return 'creature';
    return 'none';
  }

  hitRadius(c: CreatureModel): number {
    return Math.max(c.size * CONFIG.hit.hitScale, this.b.minHitRadius);
  }

  foodHitRadius(): number {
    return Math.max(this.b.foodRadius * CONFIG.food.hitScale, this.b.minHitRadius * 0.8);
  }

  feedRadius(c: CreatureModel): number {
    return Math.max(c.size * CONFIG.food.feedRadiusRadii, this.b.minHitRadius) + this.b.foodRadius * 0.5;
  }

  /**
   * Operator demonstration: split a single resting creature into three small ones.
   * Returns false (and does nothing) if that is not possible right now.
   */
  startSplit(): boolean {
    if (this.sequence || this.interaction.kind !== 'none') return false;
    const alive = this.alive;
    if (alive.length !== 1 || alive[0].motion !== 'free') return false;
    const src = alive[0];
    src.cancelHop();
    src.motion = 'splitting';
    src.react('surprised', 1.2);
    src.squash.target = 0.66;
    src.kick(-6);
    src.shiver = 0.05;
    this.sequence = { kind: 'split', src, t0: this.time, spawned: false };
    return true;
  }

  update(rawDt: number, input: GameInput): void {
    const dt = clamp(rawDt, 0, CONFIG.render.maxDeltaSeconds);
    this.time += dt;
    const cursor = input.present && input.active ? input : null;
    this.lastActive = cursor !== null;
    if (input.acquired) this.acquiredAt = this.time;

    // 1. End the current interaction: hand lost, pinch released, or a new pinch already began.
    if (this.interaction.kind !== 'none') {
      if (!input.present) this.release(input, 'lost');
      else if (!input.pinching || input.pinchStart) this.release(input, 'release');
    }

    // 2. Start a new one. Priority: food, then creature, then nothing.
    if (input.pinchStart && input.present && this.interaction.kind === 'none' && !this.sequence) {
      this.tryGrab(input);
    }

    // 3. Continue the current interaction.
    this.feedTarget = null;
    if (this.interaction.kind === 'creature') this.updateGrab(dt, input);
    else if (this.interaction.kind === 'food') this.updateHeldFood(dt, input);

    // 4. Scripted sequences.
    if (this.sequence?.kind === 'split') this.updateSplit(dt);
    else if (this.sequence?.kind === 'merge') this.updateMerge();

    // 5. Autonomous behaviour and physics for everything not held.
    if (this.interaction.kind === 'none' && cursor && !input.pinching && !this.sequence) this.updateDodge(cursor);
    for (const c of this.alive) {
      if (c.motion === 'free') this.updateFree(dt, c, cursor);
      else if (c.motion === 'airborne') this.updatePhysics(dt, c);
    }
    this.separateGrounded(dt);
    for (const f of this.foods) this.updateFood(dt, f);

    for (const c of this.creatures) c.update(dt);
    for (const f of this.foods) f.update(dt);
  }

  // ---------------------------------------------------------------- grabbing

  private recentPoints(input: GameInput): { x: number; y: number }[] {
    const cutoff = (input.recent.at(-1)?.t ?? 0) - CONFIG.hit.pinchHistoryMs;
    return [input, ...input.recent.filter((p) => p.t >= cutoff)];
  }

  private pickFood(points: readonly { x: number; y: number }[]): FoodModel | null {
    const r = this.foodHitRadius();
    let best: FoodModel | null = null;
    let bestD = 1;
    for (const f of this.foods) {
      if (!f.pickable) continue;
      const d = minDistance(points, f.x, f.y) / r;
      if (d <= bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  private pickCreature(points: readonly { x: number; y: number }[]): CreatureModel | null {
    let best: CreatureModel | null = null;
    let bestD = 1;
    for (const c of this.alive) {
      if (c.motion !== 'free' && c.motion !== 'airborne') continue;
      const d = minDistance(points, c.x, c.centerY) / this.hitRadius(c);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  private tryGrab(input: GameInput): void {
    const points = this.recentPoints(input);
    const food = this.pickFood(points);
    if (food) {
      food.setState('held');
      this.interaction = { kind: 'food', f: food, startedAt: this.time };
      this.resetDodge();
      this.events.onGrab?.('food');
      return;
    }
    const c = this.pickCreature(points);
    if (!c) return;
    c.cancelHop();
    c.motion = 'grabbed';
    const s = c.size;
    let gx = (input.x - c.x) / s;
    let gy = (input.y - c.centerY) / s;
    const len = Math.hypot(gx, gy);
    const maxLen = CONFIG.grab.maxGrabOffsetRadii;
    if (len > maxLen) {
      gx *= maxLen / len;
      gy *= maxLen / len;
    }
    this.interaction = { kind: 'creature', c, gx, gy, startedAt: this.time };
    c.react('surprised', 0.3);
    c.kick(4);
    c.shiver = 0.025;
    this.resetDodge();
    this.stats.grabs++;
    this.events.onGrab?.('creature');
  }

  private updateGrab(dt: number, input: GameInput): void {
    if (this.interaction.kind !== 'creature') return;
    const { c, gx, gy } = this.interaction;
    const g = CONFIG.grab;
    const b = this.b;
    const s = c.size;

    // The body centre follows the hand (with a little sag) through a jelly-like spring.
    const minX = b.left + s * 0.95;
    const maxX = b.right - s * 0.95;
    const minY = b.floorY + s * BODY_BOTTOM * 0.9;
    const maxY = Math.max(minY, b.top - s * BODY_BOTTOM);
    const tx = clamp(input.x - gx * s, minX, maxX);
    const ty = clamp(input.y - gy * s - g.sagRadii * s, minY, maxY);
    const footOffset = c.centerY - c.y;
    let cx = c.x;
    let cy = c.centerY;
    const step = 1 / 120;
    for (let left = dt; left > 1e-6; left -= step) {
      const h = Math.min(step, left);
      c.vx += (g.followStiffness * (tx - cx) - g.followDamping * c.vx) * h;
      c.vy += (g.followStiffness * (ty - cy) - g.followDamping * c.vy) * h;
      cx += c.vx * h;
      cy += c.vy * h;
    }
    if (cx < minX || cx > maxX) c.vx = 0;
    if (cy < minY || cy > maxY) c.vy = 0;
    cx = clamp(cx, minX, maxX);
    cy = clamp(cy, minY, maxY);
    c.x = cx;
    c.y = cy - footOffset;

    // Stretch along the line from the body to where the hand holds it.
    const sx = (input.x - cx) / s - gx;
    const sy = (input.y - cy) / s - gy;
    const lag = Math.hypot(sx, sy);
    if (lag > 0.03) {
      c.stretchAxisX = sx / lag;
      c.stretchAxisY = sy / lag;
    }
    c.stretch.target = lag * g.stretchGain;

    // Personality: eyes follow the movement, or look at the stretched body when still.
    const R = b.mainRadius;
    const speed = Math.hypot(c.vx, c.vy);
    if (speed > R * 2) c.lookDirection(c.vx, c.vy);
    else if (c.stretch.value > 0.2) c.lookDirection(c.stretchAxisX, c.stretchAxisY);
    else c.lookAt(input.x, input.y);
    c.lean.target = clamp(-c.vx / (R * 20), -0.2, 0.2);
    c.baseExpression = c.stretch.value > 0.35 ? 'cheeky' : 'curious';
  }

  private release(input: GameInput, why: 'release' | 'lost'): void {
    const it = this.interaction;
    this.interaction = NONE;

    if (it.kind === 'food') {
      it.f.feedReady = false;
      const target = why === 'release' ? this.findFeedTarget(it.f) : null;
      if (target) this.feed(it.f, target);
      else this.returnFood(it.f);
      return;
    }
    if (it.kind !== 'creature') return;

    const c = it.c;
    c.stretch.target = 0;
    c.lean.target = 0;
    c.motion = 'airborne';
    c.baseExpression = 'neutral';
    if (why === 'lost') {
      // Hand lost: a gentle drop, never a throw.
      c.vx = c.vy = 0;
      this.events.onRelease?.('lost');
      return;
    }

    const v = estimateThrowVelocity(input.recent, this.throwSettings());
    if (v) {
      c.vx = v.x;
      c.vy = v.y;
      c.react('surprised', 0.3);
      this.stats.throws++;
      this.events.onRelease?.('throw');
      return;
    }

    // Slow release: merge if a small one was deliberately dropped onto another, else settle.
    if (this.isSmall(c) && this.time - it.startedAt >= CONFIG.merge.minHoldMs / 1000) {
      const target = this.findMergeTarget(c);
      if (target) {
        this.startMerge(c, target);
        return;
      }
    }
    const wasStretched = Math.abs(c.stretch.value) > 0.15;
    c.vx = c.vy = 0;
    if (wasStretched) {
      // It noticed being stretched: a blink, then a look along where it was pulled.
      c.surpriseBlink();
      c.holdLook(c.stretchAxisX * 0.7, c.stretchAxisY * 0.7, 0.9);
    }
    this.events.onRelease?.('drop');
  }

  private throwSettings(): ThrowSettings {
    const t = CONFIG.throw;
    const R = this.b.mainRadius;
    const k = this.reduced ? CONFIG.reducedMotion.throwSpeedScale : 1;
    return {
      windowMs: t.windowMs,
      ignoreLastMs: t.ignoreLastMs,
      minSpeed: t.minSpeedRadii * R,
      maxSpeed: t.maxSpeedRadii * R * k,
      spikeSpeed: t.spikeSpeedRadii * R,
      scale: t.scale * k,
    };
  }

  // ---------------------------------------------------------------- food

  private layoutFood(): void {
    for (const f of this.foods) {
      f.homeX = this.b.trayX + (f.index - 1) * this.b.foodSpacing;
      f.homeY = this.b.trayY;
    }
  }

  private updateHeldFood(dt: number, input: GameInput): void {
    if (this.interaction.kind !== 'food') return;
    const f = this.interaction.f;
    const r = this.b.foodRadius;
    f.x = approach(f.x, clamp(input.x, this.b.left + r, this.b.right - r), 28, dt);
    f.y = approach(f.y, clamp(input.y, this.b.bottom + r, this.b.top - r), 28, dt);
    this.feedTarget = this.findFeedTarget(f);
    f.feedReady = this.feedTarget !== null;
  }

  /** The eligible creature whose mouth is closest to the food, within its feeding zone. */
  private findFeedTarget(f: FoodModel): CreatureModel | null {
    let best: CreatureModel | null = null;
    let bestD = Infinity;
    for (const c of this.alive) {
      if ((c.motion !== 'free' && c.motion !== 'airborne') || c.chewing) continue;
      const d = Math.hypot(f.x - c.x, f.y - c.mouthY);
      if (d < this.feedRadius(c) && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  private feed(f: FoodModel, c: CreatureModel): void {
    const fc = CONFIG.food;
    // Consumed exactly once: the food is no longer pickable or feedable until it respawns.
    f.setState('eaten');
    f.fromX = f.x;
    f.fromY = f.y;
    f.mouthX = c.x;
    f.mouthY = c.mouthY;
    f.respawnAt = this.time + fc.respawnMs / 1000;
    f.scale.target = 0;

    c.cancelHop();
    c.chewUntil = c.clock + fc.chewMs / 1000;
    c.react('happy', fc.chewMs / 1000 + 1.1);
    c.kick(-6);
    c.setTint(f.color, fc.tintAmount, fc.tintFadeMs / 1000);
    c.puff.velocity += fc.puffKick * (this.reduced ? CONFIG.reducedMotion.wobbleScale : 1);
    this.stats.feeds++;
    this.events.onFeed?.();
  }

  private returnFood(f: FoodModel): void {
    f.setState('returning');
    f.fromX = f.x;
    f.fromY = f.y;
  }

  private updateFood(dt: number, f: FoodModel): void {
    switch (f.state) {
      case 'tray':
        f.x = approach(f.x, f.homeX, 10, dt);
        f.y = approach(f.y, f.homeY, 10, dt);
        break;
      case 'returning': {
        const p = clamp(f.stateTime / (CONFIG.food.returnMs / 1000), 0, 1);
        const e = easeInOut(p);
        f.x = lerp(f.fromX, f.homeX, e);
        f.y = lerp(f.fromY, f.homeY, e) + Math.sin(p * Math.PI) * this.b.foodRadius * 0.8;
        if (p >= 1) f.setState('tray');
        break;
      }
      case 'eaten': {
        const p = clamp(f.stateTime / 0.25, 0, 1);
        f.x = lerp(f.fromX, f.mouthX, p);
        f.y = lerp(f.fromY, f.mouthY, p);
        if (this.time >= f.respawnAt) {
          f.setState('tray');
          f.x = f.homeX;
          f.y = f.homeY;
          f.scale.snap(0);
          f.scale.target = 1;
        }
        break;
      }
      case 'held':
        break;
    }
  }

  // ---------------------------------------------------------------- free behaviour and physics

  private updateFree(dt: number, c: CreatureModel, cursor: { x: number; y: number } | null): void {
    if (!c.isHopping) c.y = approach(c.y, this.b.floorY, 12, dt);
    const food = this.heldFood;
    if (food) {
      // Watch the food. Open the mouth when it is close enough to eat.
      c.lookAt(food.x, food.y);
      c.baseExpression = this.feedTarget === c ? 'hungry' : 'curious';
      c.lean.target = -clamp((food.x - c.x) / (c.radius * 4), -1, 1) * 0.12;
      return;
    }
    if (cursor) {
      c.lookAt(cursor.x, cursor.y);
      c.lean.target = -clamp((cursor.x - c.x) / (c.radius * 4), -1, 1) * 0.12;
      c.baseExpression = this.inGrabWindow && c.slot === this.dodgeSlot ? 'cheeky' : 'curious';
      return;
    }
    c.lean.target = 0;
    c.baseExpression = 'neutral';
    if (c.clock >= c.nextLookAt) {
      const centre = this.rng() < 0.35;
      c.holdLook(centre ? 0 : (this.rng() * 2 - 1) * 0.8, centre ? 0 : this.rng() * 0.9 - 0.3, 0);
      c.nextLookAt = c.clock + 1.2 + this.rng() * 2.5;
    }
    if (c.isHopping || c.clock < c.nextIdleAt || c.chewing) return;
    // Occasional small hop; a lone creature drifts back home after being thrown.
    const r = c.radius;
    let toX = c.x + (this.rng() * 2 - 1) * r * 0.6;
    if (this.alive.length === 1 && Math.abs(this.homeX - c.x) > r * 0.3) {
      toX = c.x + Math.sign(this.homeX - c.x) * Math.min(Math.abs(this.homeX - c.x), r * 1.6);
    }
    toX = clamp(toX, this.b.left + r, this.b.right - r);
    c.startHop(toX, this.b.floorY, r * (this.reduced ? 0.25 : 0.45), this.hopDuration(), this.hopAnticipation());
    c.nextIdleAt = c.clock + (this.reduced ? 9 : 6) + this.rng() * 5;
  }

  private updatePhysics(dt: number, c: CreatureModel): void {
    const t = CONFIG.throw;
    const b = this.b;
    const R = b.mainRadius;
    const rest = this.reduced ? CONFIG.reducedMotion.restitutionScale : 1;
    const maxSpeed = t.maxSpeedRadii * R * 1.2;
    const speed = Math.hypot(c.vx, c.vy);
    if (speed > maxSpeed) {
      c.vx *= maxSpeed / speed;
      c.vy *= maxSpeed / speed;
    }

    c.vy -= t.gravityRadii * R * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;

    const s = c.size;
    const minX = b.left + s * 0.95;
    const maxX = b.right - s * 0.95;
    if (c.x < minX || c.x > maxX) {
      c.x = clamp(c.x, minX, maxX);
      const into = c.x === minX ? -c.vx : c.vx;
      if (into > 0) {
        this.impact(c, into, 'wall');
        c.vx = -c.vx * t.wallRestitution * rest;
      }
    }
    const headY = c.y + 2 * BODY_BOTTOM * s;
    if (headY > b.top && c.vy > 0) {
      c.y = b.top - 2 * BODY_BOTTOM * s;
      c.vy = -c.vy * t.wallRestitution * rest;
    }
    if (c.y <= b.floorY) {
      c.y = b.floorY;
      if (c.vy < 0) {
        const impact = -c.vy;
        c.vy = impact < t.settleSpeedRadii * R ? 0 : impact * t.floorRestitution * rest;
        c.vx *= t.floorFriction;
        this.impact(c, impact, 'floor');
      }
      if (c.vy === 0) {
        c.vx = approach(c.vx, 0, 6, dt);
        if (Math.abs(c.vx) < 0.3 * R) {
          c.vx = 0;
          c.motion = 'free';
          c.squash.target = 1;
          c.nextIdleAt = c.clock + 3;
        }
      }
    }

    if (Math.hypot(c.vx, c.vy) > R) c.lookDirection(c.vx, c.vy);
    c.lean.target = clamp(-c.vx / (R * 25), -0.25, 0.25);
    if (c.motion === 'airborne') c.squash.target = 1 + 0.08 * clamp(Math.abs(c.vy) / (R * 10), 0, 1);
  }

  private impact(c: CreatureModel, speed: number, where: 'floor' | 'wall'): void {
    const R = this.b.mainRadius;
    const k = clamp((speed / R) * 0.9, 0, 10);
    // Floor: vertical squash. Wall: horizontal squash (vertical stretch).
    c.kick(where === 'floor' ? -k : k * 0.8);
    if (speed > CONFIG.throw.surpriseImpactRadii * R) c.surpriseBlink();
  }

  /** Keep resting creatures from piling up on each other (they only merge on purpose). */
  private separateGrounded(dt: number): void {
    const list = this.alive.filter((c) => c.motion === 'free' && !c.isHopping);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const minD = (a.size + b.size) * 0.9;
        if (Math.abs(dx) >= minD) continue;
        const dir = dx >= 0 ? 1 : -1;
        const push = ((minD - Math.abs(dx)) / 2) * Math.min(1, dt * 5);
        a.x = clamp(a.x - dir * push, this.b.left + a.radius, this.b.right - a.radius);
        b.x = clamp(b.x + dir * push, this.b.left + b.radius, this.b.right - b.radius);
      }
    }
  }

  // ---------------------------------------------------------------- dodge

  private updateDodge(cursor: { x: number; y: number }): void {
    const d = CONFIG.dodge;
    let c: CreatureModel | null = null;
    let dist = Infinity;
    for (const o of this.alive) {
      if (o.motion !== 'free') continue;
      const od = Math.hypot(cursor.x - o.x, cursor.y - o.centerY);
      if (od < dist) {
        dist = od;
        c = o;
      }
    }
    if (!c) return;
    if (c.slot !== this.dodgeSlot) {
      this.dodgeSlot = c.slot;
      this.cursorNear = false;
    }

    const near = dist < d.triggerRadii * c.radius;
    if (near) this.lastNearAt = this.time;
    else if (this.time - this.lastNearAt > d.streakResetMs / 1000) this.dodgeStreak = 0;

    const entering = near && !this.cursorNear;
    this.cursorNear = near;
    if (!entering) return;

    const maxConsecutive = this.reduced ? CONFIG.reducedMotion.dodgeMaxConsecutive : d.maxConsecutive;
    const chance = this.reduced ? CONFIG.reducedMotion.dodgeChance : d.chance;
    const canDodge =
      !c.isHopping &&
      !c.chewing &&
      this.time - this.lastDodgeAt >= d.cooldownMs / 1000 &&
      this.time >= this.grabWindowUntil &&
      this.time - this.acquiredAt >= d.graceAfterAcquireMs / 1000 &&
      this.dodgeStreak < maxConsecutive;
    if (!canDodge || this.rng() >= chance) return;

    const r = c.radius;
    const distance = d.distanceRadii * r * (this.reduced ? CONFIG.reducedMotion.dodgeDistanceScale : 1);
    const minX = this.b.left + r * 1.05;
    const maxX = this.b.right - r * 1.05;
    const dir = cursor.x < c.x ? 1 : cursor.x > c.x ? -1 : this.rng() < 0.5 ? 1 : -1;
    let toX = c.x + dir * distance;
    if (toX < minX || toX > maxX) {
      const other = c.x - dir * distance;
      toX = other >= minX && other <= maxX ? other : clamp(toX, minX, maxX);
    }
    if (Math.abs(toX - c.x) < r * 0.4) return; // no room to dodge: stay grabbable

    const height = d.hopHeightRadii * r * (this.reduced ? CONFIG.reducedMotion.hopHeightScale : 1);
    c.startHop(toX, this.b.floorY, height, this.hopDuration(), this.hopAnticipation());
    c.react('cheeky', 1);
    this.lastDodgeAt = this.time;
    this.dodgeStreak++;
    if (this.dodgeStreak >= maxConsecutive) {
      // Clear chance to grab: stay put for a while.
      this.grabWindowUntil = this.time + this.hopAnticipation() + this.hopDuration() + d.catchWindowMs / 1000;
      this.dodgeStreak = 0;
    }
  }

  private resetDodge(): void {
    this.dodgeStreak = 0;
    this.grabWindowUntil = 0;
    this.cursorNear = false;
    this.lastNearAt = -Infinity;
  }

  private hopDuration(): number {
    return this.reduced ? 0.6 : 0.42;
  }

  private hopAnticipation(): number {
    return this.reduced ? 0.18 : 0.12;
  }

  // ---------------------------------------------------------------- split and merge

  private applyRadius(c: CreatureModel): void {
    c.radius = c.radiusFactor * this.b.mainRadius;
  }

  private miniFactor(sourceFactor: number): number {
    return Math.max(sourceFactor * MINI_FACTOR, this.b.miniMinRadius / this.b.mainRadius);
  }

  private isSmall(c: CreatureModel): boolean {
    return c.radiusFactor < CONFIG.merge.smallBelowRadii;
  }

  private updateSplit(dt: number): void {
    if (this.sequence?.kind !== 'split') return;
    const seq = this.sequence;
    const src = seq.src;
    const t = this.time - seq.t0;
    src.y = approach(src.y, this.b.floorY, 12, dt);
    if (t >= SPLIT_SQUASH_S && !seq.spawned) {
      seq.spawned = true;
      src.grow.target = 0;
      src.squash.target = 1;
      const R = this.b.mainRadius;
      const factor = this.miniFactor(src.radiusFactor);
      this.creatures
        .filter((m) => m !== src)
        .forEach((m, k) => {
          const dir = k - 1;
          m.clearEffects();
          m.alive = true;
          m.radiusFactor = factor;
          this.applyRadius(m);
          m.color = [...SLOT_COLORS[m.slot]];
          m.x = clamp(src.x + dir * src.size * 0.35, this.b.left + m.radius, this.b.right - m.radius);
          m.y = src.y + src.size * 0.3;
          m.grow.snap(0.3);
          m.grow.target = 1;
          m.motion = 'airborne';
          m.vx = dir !== 0 ? dir * R * 2.6 : R * 0.6 * (this.rng() < 0.5 ? -1 : 1);
          m.vy = R * (dir === 0 ? 8.5 : 7);
          m.react('surprised', 0.8);
        });
    }
    if (t >= SPLIT_END_S) {
      src.alive = false;
      src.clearEffects();
      src.grow.snap(0);
      this.sequence = null;
      this.events.onSplit?.();
    }
  }

  private findMergeTarget(a: CreatureModel): CreatureModel | null {
    let best: CreatureModel | null = null;
    let bestD = Infinity;
    for (const o of this.alive) {
      if (o === a || (o.motion !== 'free' && o.motion !== 'airborne')) continue;
      const d = Math.hypot(a.x - o.x, a.centerY - o.centerY);
      if (d < (a.size + o.size) * CONFIG.merge.overlapFactor && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private startMerge(a: CreatureModel, b: CreatureModel): void {
    a.motion = 'merging';
    b.motion = 'merging';
    b.cancelHop();
    a.vx = a.vy = b.vx = b.vy = 0;
    const wa = a.radiusFactor ** 3;
    const wb = b.radiusFactor ** 3;
    this.sequence = {
      kind: 'merge',
      a,
      b,
      t0: this.time,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      fx: (a.x * wa + b.x * wb) / (wa + wb),
      fy: Math.max(this.b.floorY, (a.y * wa + b.y * wb) / (wa + wb)),
    };
    a.react('surprised', 0.6);
    b.react('surprised', 0.6);
  }

  private updateMerge(): void {
    if (this.sequence?.kind !== 'merge') return;
    const s = this.sequence;
    const p = clamp((this.time - s.t0) / (CONFIG.merge.durationMs / 1000), 0, 1);
    const e = easeInOut(p);
    s.a.x = lerp(s.ax, s.fx, e);
    s.a.y = lerp(s.ay, s.fy, e);
    s.b.x = lerp(s.bx, s.fx, e);
    s.b.y = lerp(s.by, s.fy, e);
    s.a.grow.target = 0.7;
    s.a.lookAt(s.b.x, s.b.centerY);
    s.b.lookAt(s.a.x, s.a.centerY);
    if (p >= 1) this.finishMerge(s.a, s.b, s.fx, s.fy);
  }

  /** b survives with the combined volume (capped) and the volume-weighted colour; a is removed. */
  private finishMerge(a: CreatureModel, b: CreatureModel, x: number, y: number): void {
    const va = a.radiusFactor ** 3;
    const vb = b.radiusFactor ** 3;
    const w = va / (va + vb);
    const oldSize = b.size;
    b.color = [0, 1, 2].map((i) => a.color[i] * w + b.color[i] * (1 - w)) as RGB;
    b.radiusFactor = Math.min(Math.cbrt(va + vb), CONFIG.merge.maxRadii);
    this.applyRadius(b);
    b.grow.snap(oldSize / (b.radius * Math.max(0.5, b.puff.value)));
    b.grow.target = 1;
    b.x = clamp(x, this.b.left + b.radius, this.b.right - b.radius);
    b.y = y;
    b.motion = 'airborne';
    b.vx = b.vy = 0;
    b.tintAmount = 0;
    b.surpriseBlink();
    b.kick(7);

    a.alive = false;
    a.clearEffects();
    a.grow.snap(0);
    this.sequence = null;
    this.stats.merges++;
    this.events.onMerge?.();
  }
}

function minDistance(points: readonly { x: number; y: number }[], x: number, y: number): number {
  let best = Infinity;
  for (const p of points) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  return best;
}
