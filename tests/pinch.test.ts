import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { PinchDetector, pinchRatio } from '../src/input/pinch';
import { makeHand } from './helpers';

const ASPECT = 4 / 3;

describe('pinchRatio', () => {
  it('separates open and pinched hands', () => {
    expect(pinchRatio(makeHand({ ratio: 1.05 }), ASPECT)).toBeGreaterThan(CONFIG.pinch.releaseThreshold);
    expect(pinchRatio(makeHand({ ratio: 0.1 }), ASPECT)).toBeLessThan(CONFIG.pinch.pinchThreshold);
  });

  it('does not depend on distance from the camera (hand size in the image)', () => {
    const near = pinchRatio(makeHand({ scale: 0.3, ratio: 0.4 }), ASPECT);
    const far = pinchRatio(makeHand({ scale: 0.06, ratio: 0.4 }), ASPECT);
    expect(near).toBeCloseTo(far, 5);
    expect(near).toBeCloseTo(0.4, 5);
  });

  it('is corrected for the video aspect ratio', () => {
    const wide = pinchRatio(makeHand({ ratio: 0.4, aspect: 16 / 9 }), 16 / 9);
    expect(wide).toBeCloseTo(0.4, 5);
  });
});

describe('PinchDetector', () => {
  const OPEN = 1.0;
  const CLOSED = 0.1;
  const run = (d: PinchDetector, ratios: number[], t0 = 0, step = 33) =>
    ratios.map((r, i) => d.update(r, t0 + i * step));

  it('needs an open hand before the first pinch counts', () => {
    const d = new PinchDetector();
    const res = run(d, [CLOSED, CLOSED, CLOSED, CLOSED]);
    expect(res.some((r) => r.pinchStart)).toBe(false);
    expect(res.at(-1)!.pinching).toBe(true); // visual state still shows the pinch
  });

  it('fires exactly once on the open-to-pinched transition, after the stability frames', () => {
    const d = new PinchDetector();
    const res = run(d, [OPEN, OPEN, OPEN, CLOSED, CLOSED, CLOSED]);
    const starts = res.map((r) => r.pinchStart);
    expect(starts).toEqual([false, false, false, false, true, false]);
  });

  it('holding a pinch never repeats the event', () => {
    const d = new PinchDetector();
    const res = run(d, [OPEN, OPEN, ...Array(200).fill(CLOSED)]);
    expect(res.filter((r) => r.pinchStart)).toHaveLength(1);
  });

  it('rejects a single noisy frame', () => {
    const d = new PinchDetector();
    const res = run(d, [OPEN, OPEN, CLOSED, OPEN, OPEN, CLOSED, OPEN]);
    expect(res.some((r) => r.pinchStart)).toBe(false);
  });

  it('requires a release before the next pinch', () => {
    const d = new PinchDetector();
    // Pinch, wobble inside the hysteresis band (not a release), pinch "again".
    const res = run(d, [OPEN, OPEN, CLOSED, CLOSED, 0.4, 0.4, CLOSED, CLOSED, CLOSED]);
    expect(res.filter((r) => r.pinchStart)).toHaveLength(1);
  });

  it('allows a second catch after release, respecting the cooldown', () => {
    const d = new PinchDetector();
    // 33 ms frames: second pinch completes ~200 ms after the first, inside the 350 ms cooldown.
    const fast = run(d, [OPEN, OPEN, CLOSED, CLOSED, OPEN, OPEN, CLOSED, CLOSED]);
    expect(fast.filter((r) => r.pinchStart)).toHaveLength(1);

    const d2 = new PinchDetector();
    const slow = run(d2, [OPEN, OPEN, CLOSED, CLOSED, ...Array(10).fill(OPEN), CLOSED, CLOSED]);
    expect(slow.filter((r) => r.pinchStart)).toHaveLength(2);
  });

  it('reset() requires an open hand again (reacquisition)', () => {
    const d = new PinchDetector();
    run(d, [OPEN, OPEN]);
    d.reset();
    const res = run(d, [CLOSED, CLOSED, CLOSED], 1000);
    expect(res.some((r) => r.pinchStart)).toBe(false);
    const after = run(d, [OPEN, OPEN, CLOSED, CLOSED], 2000);
    expect(after.filter((r) => r.pinchStart)).toHaveLength(1);
  });
});
