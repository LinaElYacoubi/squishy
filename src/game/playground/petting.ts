import { CONFIG } from '../../config';

/** The petting zone above one creature's head, in world units. */
export interface PetZone {
  cx: number;
  /** Body centre height and visible radius. */
  cy: number;
  size: number;
}

export type PetSettings = typeof CONFIG.playground.pet;

/**
 * Detects petting: an open hand moving slowly back and forth above Squishy's head.
 *
 * It requires a little deliberate movement: the hand has to change direction a couple of times
 * (each stroke at least `minStrokeSizes` long) within a short window. A hand that simply passes
 * over the head, or sweeps by quickly, never starts petting. The caller passes `null` while the
 * visitor pinches or carries food, which pauses petting immediately.
 */
export class PetDetector {
  /** Petting is happening now. */
  active = false;
  /** Seconds of uninterrupted petting. */
  petSeconds = 0;

  private t = 0;
  private dir = 0;
  private anchor = 0;
  private extreme = 0;
  private reversals: number[] = [];
  private lastX: number | null = null;
  private lastStrokeAt = -Infinity;
  private lastInZoneAt = -Infinity;

  constructor(private s: PetSettings = CONFIG.playground.pet) {}

  /** Is (x, y) above the head, inside the petting zone? */
  inZone(x: number, y: number, z: PetZone): boolean {
    const s = this.s;
    return (
      Math.abs(x - z.cx) <= z.size * s.zoneHalfWidthSizes &&
      y >= z.cy + z.size * s.zoneLowSizes &&
      y <= z.cy + z.size * s.zoneHighSizes
    );
  }

  /**
   * Advance by dt seconds. `hand` is the open-hand cursor (null while absent, pinching or holding
   * food); `zone` is the nearest creature's head zone (null if it cannot be petted right now).
   */
  update(dt: number, hand: { x: number; y: number } | null, zone: PetZone | null): boolean {
    this.t += dt;
    const s = this.s;
    if (!hand || !zone) {
      this.stop();
      return false;
    }
    const inside = this.inZone(hand.x, hand.y, zone);
    if (!inside) {
      this.trackReset(hand.x);
      if (this.active && (this.t - this.lastInZoneAt) * 1000 > s.lingerMs) this.stop();
      if (this.active) this.petSeconds += dt;
      return this.active;
    }
    this.lastInZoneAt = this.t;

    const speed = this.lastX === null || dt <= 0 ? 0 : Math.abs(hand.x - this.lastX) / dt;
    this.lastX = hand.x;
    if (speed > s.maxSpeedSizes * zone.size) {
      // A quick swipe is someone passing by, not petting.
      this.trackReset(hand.x);
      if (!this.active) return false;
    }

    const minStroke = s.minStrokeSizes * zone.size;
    if (this.dir === 0) {
      if (Math.abs(hand.x - this.anchor) >= minStroke) {
        this.dir = Math.sign(hand.x - this.anchor);
        this.extreme = hand.x;
      }
    } else {
      if ((hand.x - this.extreme) * this.dir > 0) this.extreme = hand.x;
      // Turned back by at least a stroke length: one direction change.
      if ((this.extreme - hand.x) * this.dir >= minStroke) {
        this.reversals.push(this.t);
        this.lastStrokeAt = this.t;
        this.dir = -this.dir;
        this.extreme = hand.x;
      }
    }
    const windowS = s.strokeWindowMs / 1000;
    this.reversals = this.reversals.filter((r) => this.t - r <= windowS);
    if (!this.active && this.reversals.length >= s.reversalsToStart) this.active = true;
    // Stopped stroking for a while: petting ends.
    if (this.active && (this.t - this.lastStrokeAt) * 1000 > s.lingerMs + windowS * 500) this.stop();
    if (this.active) this.petSeconds += dt;
    return this.active;
  }

  reset(): void {
    this.stop();
    this.lastInZoneAt = -Infinity;
  }

  private stop(): void {
    this.active = false;
    this.petSeconds = 0;
    this.reversals = [];
    this.dir = 0;
    this.lastX = null;
  }

  private trackReset(x: number): void {
    this.dir = 0;
    this.anchor = x;
    this.extreme = x;
    this.reversals = [];
    this.lastX = x;
  }
}
