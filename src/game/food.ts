import { CONFIG } from '../config';
import { Spring } from './anim';
import { hexToRgb, type RGB } from './creatureModel';

export type FoodKind = 'berry' | 'fruit' | 'blueberry';
export const FOOD_KINDS: readonly FoodKind[] = ['berry', 'fruit', 'blueberry'];

/**
 * tray:      resting on the tray, can be picked up
 * held:      following the visitor's hand
 * returning: gliding back to the tray after a miss
 * eaten:     consumed (shrinks into the mouth, then waits to respawn)
 */
export type FoodState = 'tray' | 'held' | 'returning' | 'eaten';

/** One food item. Position is in creature-plane coordinates (what the visitor sees on screen). */
export class FoodModel {
  state: FoodState = 'tray';
  x = 0;
  y = 0;
  homeX = 0;
  homeY = 0;
  fromX = 0;
  fromY = 0;
  stateTime = 0;
  respawnAt = 0;
  /** Set while held inside a creature's feeding zone: releasing now will feed it. */
  feedReady = false;
  /** Where an eaten item flies to (the eater's mouth). */
  mouthX = 0;
  mouthY = 0;
  readonly scale = new Spring(1, 1, 200, 14);
  readonly color: RGB;

  constructor(
    readonly kind: FoodKind,
    readonly index: number,
  ) {
    this.color = hexToRgb(CONFIG.food.colors[kind]);
  }

  get visible(): boolean {
    return this.scale.value > 0.01 && !(this.state === 'eaten' && this.stateTime > 0.3);
  }

  /** Can be picked up right now. */
  get pickable(): boolean {
    return this.state === 'tray' || this.state === 'returning';
  }

  setState(state: FoodState): void {
    this.state = state;
    this.stateTime = 0;
  }

  /** Back on the tray immediately (reset). */
  restore(): void {
    this.setState('tray');
    this.x = this.homeX;
    this.y = this.homeY;
    this.feedReady = false;
    this.scale.snap(1);
  }

  update(dt: number): void {
    this.stateTime += dt;
    this.scale.update(dt);
  }
}
