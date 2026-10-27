import type { Point3 } from '../src/input/pinch';
import type { StageBounds } from '../src/game/game';

export interface HandOptions {
  /** Palm centre in normalised image coordinates. */
  cx?: number;
  cy?: number;
  /** Palm length in normalised image height units (bigger = closer to the camera). */
  scale?: number;
  /** Desired thumb-index distance in palm lengths (about 1.05 is open, 0.1 is pinched). */
  ratio?: number;
  aspect?: number;
}

/**
 * Representative 21-point MediaPipe-style hand landmarks (not real camera data).
 * Palm length (wrist to middle knuckle) is exactly `scale` in aspect-corrected units.
 */
export function makeHand({ cx = 0.5, cy = 0.5, scale = 0.15, ratio = 1.05, aspect = 4 / 3 }: HandOptions = {}): Point3[] {
  // Canonical hand in palm-length units, y down, palm centre near the origin.
  const wrist = [0, 0.5];
  const mcp = { index: [-0.3, -0.45], middle: [0, -0.5], ring: [0.25, -0.45], pinky: [0.45, -0.35] };
  const indexTip = [-0.35, -1.2];
  // Thumb tip placed at the requested distance from the index tip, toward the thumb side.
  const dir = [-0.55, 0.9];
  const len = Math.hypot(dir[0], dir[1]);
  const thumbTip = [indexTip[0] + (dir[0] / len) * ratio, indexTip[1] + (dir[1] / len) * ratio];

  const pts: number[][] = new Array(21);
  pts[0] = wrist;
  pts[1] = mix(wrist, thumbTip, 0.25);
  pts[2] = mix(wrist, thumbTip, 0.5);
  pts[3] = mix(wrist, thumbTip, 0.75);
  pts[4] = thumbTip;
  pts[5] = mcp.index;
  pts[6] = mix(mcp.index, indexTip, 0.4);
  pts[7] = mix(mcp.index, indexTip, 0.7);
  pts[8] = indexTip;
  const finger = (base: number, m: number[], tip: number[]) => {
    pts[base] = m;
    pts[base + 1] = mix(m, tip, 0.4);
    pts[base + 2] = mix(m, tip, 0.7);
    pts[base + 3] = tip;
  };
  finger(9, mcp.middle, [0, -1.25]);
  finger(13, mcp.ring, [0.3, -1.15]);
  finger(17, mcp.pinky, [0.55, -0.95]);

  // Centre on the palm (average of wrist and knuckles) and convert to image coordinates.
  const ids = [0, 5, 9, 13, 17];
  const ox = ids.reduce((s, i) => s + pts[i][0], 0) / ids.length;
  const oy = ids.reduce((s, i) => s + pts[i][1], 0) / ids.length;
  return pts.map(([x, y]) => ({ x: cx + ((x - ox) * scale) / aspect, y: cy + (y - oy) * scale, z: 0 }));
}

function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export const BOUNDS: StageBounds = {
  left: -6,
  right: 6,
  bottom: -3.4,
  top: 3.4,
  floorY: -2.7,
  mainRadius: 1.3,
  miniMinRadius: 0.65,
  minHitRadius: 0.68,
  trayX: -4.3,
  trayY: -2.83,
  foodRadius: 0.42,
  foodSpacing: 1.09,
};
