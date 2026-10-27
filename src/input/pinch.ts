import { CONFIG } from '../config';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe hand landmark indices used here. */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  PINKY_MCP: 17,
} as const;

/**
 * Distance in image space with x (and z, which MediaPipe scales like x) corrected
 * for the video aspect ratio, so measurements are not skewed by a 4:3 or 16:9 frame.
 */
function dist(a: Point3, b: Point3, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * aspect;
  return Math.hypot(dx, dy, dz);
}

/**
 * A palm measurement that stays fairly stable while fingers move: the larger of palm
 * length (wrist to middle knuckle) and scaled palm width (index to pinky knuckle).
 * Using the larger one keeps it stable when the hand turns sideways or tilts.
 */
export function palmSize(lm: readonly Point3[], aspect: number): number {
  const length = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP], aspect);
  const width = dist(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP], aspect) * 1.25;
  return Math.max(length, width, 1e-6);
}

/** Thumb-tip to index-tip distance divided by palm size; independent of distance from the camera. */
export function pinchRatio(lm: readonly Point3[], aspect: number): number {
  return dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP], aspect) / palmSize(lm, aspect);
}

export interface PinchConfig {
  pinchThreshold: number;
  releaseThreshold: number;
  stableFrames: number;
  cooldownMs: number;
}

export interface PinchUpdate {
  /** The hand is currently held in a pinch (for cursor feedback). */
  pinching: boolean;
  /** True only on the frame where an armed, open hand becomes pinched. */
  pinchStart: boolean;
  /** True once an open hand has been seen, so the next pinch can count. */
  armed: boolean;
}

/**
 * Pinch state machine with hysteresis, a stability requirement, edge triggering,
 * a release requirement and a cooldown.
 *
 * After construction or reset() the detector is unarmed: it needs a stable open hand
 * before any pinch can count. This is what makes reacquisition safe.
 */
export class PinchDetector {
  private state: 'unknown' | 'open' | 'pinched' = 'unknown';
  private armed = false;
  private closedFrames = 0;
  private openFrames = 0;
  private lastPinchAt = -Infinity;

  constructor(private cfg: PinchConfig = CONFIG.pinch) {}

  setConfig(cfg: PinchConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.state = 'unknown';
    this.armed = false;
    this.closedFrames = 0;
    this.openFrames = 0;
  }

  get pinching(): boolean {
    return this.state === 'pinched';
  }

  update(ratio: number, tMs: number): PinchUpdate {
    let pinchStart = false;
    const { pinchThreshold, releaseThreshold, stableFrames, cooldownMs } = this.cfg;

    if (ratio < pinchThreshold) {
      this.closedFrames++;
      this.openFrames = 0;
      if (this.closedFrames >= stableFrames && this.state !== 'pinched') {
        this.state = 'pinched';
        if (this.armed && tMs - this.lastPinchAt >= cooldownMs) {
          pinchStart = true;
          this.lastPinchAt = tMs;
        }
        // Whether or not it counted, the hand must open again before the next pinch.
        this.armed = false;
      }
    } else if (ratio > releaseThreshold) {
      this.openFrames++;
      this.closedFrames = 0;
      if (this.openFrames >= stableFrames) {
        this.state = 'open';
        this.armed = true;
      }
    } else {
      // Between thresholds: hysteresis band, keep the current state.
      this.closedFrames = 0;
      this.openFrames = 0;
    }

    return { pinching: this.state === 'pinched', pinchStart, armed: this.armed };
  }
}
