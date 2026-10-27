import { describe, expect, it } from 'vitest';
import { estimateThrowVelocity, type ThrowSettings } from '../src/game/throw';

const S: ThrowSettings = { windowMs: 120, ignoreLastMs: 40, minSpeed: 9, maxSpeed: 20, spikeSpeed: 90, scale: 0.75 };

/** Cursor samples every `stepMs`, moving at (vx, vy) world units per second. */
function track(vx: number, vy: number, ms = 300, stepMs = 33) {
  const pts = [];
  for (let t = 0; t <= ms; t += stepMs) pts.push({ x: (vx * t) / 1000, y: (vy * t) / 1000, t });
  return pts;
}

describe('estimateThrowVelocity', () => {
  it('slow movement is a drop, not a throw', () => {
    expect(estimateThrowVelocity(track(5, 0), S)).toBeNull();
    expect(estimateThrowVelocity(track(0, 0), S)).toBeNull();
  });

  it('a fast flick gives a scaled velocity in the right direction', () => {
    const v = estimateThrowVelocity(track(16, -8), S)!;
    expect(v.x).toBeCloseTo(16 * 0.75, 3);
    expect(v.y).toBeCloseTo(-8 * 0.75, 3);
  });

  it('caps very fast throws', () => {
    const v = estimateThrowVelocity(track(80, 0), S)!;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(S.maxSpeed, 5);
  });

  it('ignores an isolated tracking jump', () => {
    const pts = track(0, 0);
    // One sample jumps far away and comes back.
    const i = pts.findIndex((p) => p.t >= 165);
    pts[i] = { ...pts[i], x: 6 };
    expect(estimateThrowVelocity(pts, S)).toBeNull();
  });

  it('ignores the finger-opening motion right before the release', () => {
    const pts = track(0, 0, 300);
    // Last 60 ms: the fingertip moves quickly as the pinch opens.
    for (const p of pts) if (p.t > 240) p.y = (p.t - 240) * 0.05;
    expect(estimateThrowVelocity(pts, S)).toBeNull();
  });

  it('works with sparse samples (30 Hz tracking) but not with stale ones', () => {
    // Samples every 60 ms: only two fall inside the normal window.
    expect(estimateThrowVelocity(track(20, 0, 300, 60), S)).not.toBeNull();
    // A fast move that ended long before the release is not a throw.
    const stale = [...track(20, 0, 150, 33)];
    stale.push({ x: stale.at(-1)!.x, y: 0, t: 600 });
    expect(estimateThrowVelocity(stale, S)).toBeNull();
  });

  it('needs enough samples', () => {
    expect(estimateThrowVelocity([{ x: 0, y: 0, t: 0 }, { x: 5, y: 0, t: 33 }], S)).toBeNull();
  });
});
