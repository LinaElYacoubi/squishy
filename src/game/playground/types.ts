import type { SoundName } from '../../audio/sound';
import type { TextKey } from '../../ui/i18n';
import { BODY_BOTTOM, type CreatureModel, type Launch } from '../creatureModel';
import type { FoodModel } from '../food';
import type { Game, GameInput, StageBounds } from '../game';
import type { Bubble } from './bubble';

/** Small particle shapes for bursts (kept small and few; never flashing). */
export type ParticleKind = 'sparkle' | 'star' | 'heart' | 'bubble' | 'dot';

/** Side effects the playground asks for. The app turns them into sound and particles. */
export interface PlaygroundFx {
  sound(name: SoundName, strength?: number, pitch?: number): void;
  /** A small burst at a creature-plane position. */
  burst(x: number, y: number, kind: ParticleKind, color: string, count?: number): void;
  /** A heart-shaped bubble floating up from (x, y). */
  heart(x: number, y: number): void;
}

export const NO_FX: PlaygroundFx = { sound() {}, burst() {}, heart() {} };

export type GameId = 'says' | 'snack' | 'bounce';
export const GAME_ORDER: readonly GameId[] = ['says', 'snack', 'bounce'];
export const GAME_TITLE: Record<GameId, TextKey> = { says: 'gameSays', snack: 'gameSnack', bounce: 'gameBounce' };

/** What a mini-game may use. */
export interface MiniGameContext {
  readonly game: Game;
  readonly fx: PlaygroundFx;
  readonly rng: () => number;
  /** Squishy says something short in a speech bubble (visual; works with sound off). */
  say(key: TextKey, c?: CreatureModel | null, ms?: number): void;
  /** Run `fn` after `ms` of game time (cancelled when the round ends). */
  after(ms: number, fn: () => void): void;
  readonly reduced: boolean;
}

/**
 * One Play Together mini-game. Lives in its own module and only talks to the game through the
 * shared Game API (grab locks, events) and the context, so the original sandbox stays intact.
 */
export interface MiniGame {
  readonly id: GameId;
  /** Bubbles this game shows. */
  readonly bubbles: Bubble[];
  /** The single instruction to show right now (or null). */
  coach: TextKey | null;
  /** The round was completed: the playground celebrates and offers the next choice. */
  readonly done: boolean;
  start(): void;
  update(dt: number, input: GameInput): void;
  /** Called every frame before springs advance: override looks and expressions. */
  animate?(dt: number, input: GameInput): void;
  /** A pinch began on a pinchable bubble of this game. */
  pressBubble?(b: Bubble): void;
  onOffer?(f: FoodModel, c: CreatureModel): 'eat' | 'refuse';
  onFeed?(f: FoodModel, c: CreatureModel): void;
  onRelease?(kind: 'drop' | 'throw' | 'lost', c: CreatureModel): void;
  onLand?(c: CreatureModel, launch: Launch): void;
  /** The stage changed size: move bubbles back inside the safe area. */
  layout(b: StageBounds): void;
}

/**
 * The band where bubbles float: above Squishy's head and below the instruction text at the top,
 * inside the safe area in every orientation.
 */
export function bubbleBand(b: StageBounds): { low: number; high: number; mid: number } {
  const headTop = b.floorY + 2 * BODY_BOTTOM * b.mainRadius * 1.05;
  const height = b.top - b.bottom;
  const high = b.top - height * 0.17;
  const low = Math.min(headTop + b.mainRadius * 0.35, high - b.mainRadius * 0.4);
  return { low, high, mid: (low + high) / 2 };
}

/** Keep a circle of radius r inside the safe bounds (below the instruction text). */
export function clampInside(b: StageBounds, x: number, y: number, r: number): { x: number; y: number } {
  const height = b.top - b.bottom;
  const top = b.top - height * 0.1 - r;
  return {
    x: Math.min(Math.max(x, b.left + r), b.right - r),
    y: Math.min(Math.max(y, b.floorY + r * 0.5), Math.max(b.floorY + r * 0.5, top)),
  };
}

/** The main creature: the only one alive during mini-games (they start with a single Squishy). */
export function mainCreature(game: Game): CreatureModel | null {
  const alive = game.alive;
  if (alive.length === 0) return null;
  return alive.reduce((a, c) => (c.radiusFactor > a.radiusFactor ? c : a), alive[0]);
}

/** Point the eyes toward a world position for a while (overrides following the hand). */
export function lookToward(c: CreatureModel, x: number, y: number, seconds: number): void {
  const dx = x - c.x;
  const dy = y - c.centerY;
  const len = Math.hypot(dx, dy) || 1;
  c.holdLook((dx / len) * 0.95, (dy / len) * 0.95, seconds);
}

/** Tiny game-time scheduler; cancel() drops everything pending (round end, reset). */
export class Scheduler {
  private t = 0;
  private items: { at: number; fn: () => void }[] = [];

  after(ms: number, fn: () => void): void {
    this.items.push({ at: this.t + ms / 1000, fn });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.items.length === 0) return;
    const due = this.items.filter((i) => i.at <= this.t);
    if (due.length === 0) return;
    this.items = this.items.filter((i) => i.at > this.t);
    for (const i of due) i.fn();
  }

  cancel(): void {
    this.items = [];
  }

  get pending(): number {
    return this.items.length;
  }
}

/** Fisher-Yates shuffle with an injectable RNG (tests are deterministic). */
export function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
