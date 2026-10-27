import { CONFIG } from '../config';
import type { InputSnapshot } from '../input/inputHub';

export interface ActivityState {
  /** The visitor is interacting (recent movement or gesture). */
  active: boolean;
  /** True once, when the inactivity delay has just elapsed. */
  timedOut: boolean;
  /** Milliseconds since the last meaningful activity. */
  idleMs: number;
}

/**
 * Tracks meaningful activity: cursor movement beyond a small threshold, pinches and
 * newly appearing hands. A detected but stationary hand does not count, so it cannot
 * keep the session alive forever.
 */
export class ActivityMonitor {
  private anchorU = 0.5;
  private anchorV = 0.5;
  private lastActiveAt = -Infinity;
  private timedOutFired = true;

  constructor(
    private inactivityMs: number = CONFIG.activity.inactivityMs,
    private moveThreshold: number = CONFIG.activity.moveThreshold,
  ) {}

  reset(): void {
    this.lastActiveAt = -Infinity;
    this.timedOutFired = true;
  }

  update(t: number, s: InputSnapshot): ActivityState {
    if (s.present) {
      const moved = Math.hypot(s.u - this.anchorU, s.v - this.anchorV) > this.moveThreshold;
      if (s.acquired || moved || s.pinchStart) {
        this.anchorU = s.u;
        this.anchorV = s.v;
        this.lastActiveAt = t;
        this.timedOutFired = false;
      }
    }
    const idleMs = t - this.lastActiveAt;
    let timedOut = false;
    if (idleMs >= this.inactivityMs && !this.timedOutFired) {
      this.timedOutFired = true;
      timedOut = true;
    }
    return { active: s.present && idleMs < this.inactivityMs, timedOut, idleMs };
  }
}
