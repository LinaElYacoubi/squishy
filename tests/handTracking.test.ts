/**
 * Gesture logic tests with representative (synthetic) landmark inputs.
 * These do not use a real camera or the MediaPipe model.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { HandPipeline } from '../src/input/handPipeline';
import { HandSelector, toCandidate } from '../src/input/handSelection';
import { InputHub } from '../src/input/inputHub';
import { makeHand } from './helpers';

const ASPECT = 4 / 3;
const FRAME = 33;

describe('HandSelector', () => {
  const cand = (cx: number, cy = 0.5, scale = 0.15) => toCandidate(makeHand({ cx, cy, scale }), ASPECT);

  it('acquires a hand only after it is seen consistently', () => {
    const s = new HandSelector();
    const kinds = [0, 1, 2].map((i) => s.update([cand(0.5)], i * FRAME, ASPECT));
    expect(kinds.map((k) => k.kind)).toEqual(['none', 'none', 'tracking']);
    expect(kinds[2].kind === 'tracking' && kinds[2].acquired).toBe(true);
  });

  it('keeps following the same hand when a second hand appears elsewhere', () => {
    const s = new HandSelector();
    let t = 0;
    for (let i = 0; i < 3; i++) s.update([cand(0.3)], (t += FRAME), ASPECT);
    // A bigger (closer) second hand appears far away; selection must not jump to it.
    for (let i = 0; i < 10; i++) {
      const r = s.update([cand(0.8, 0.5, 0.25), cand(0.3 + i * 0.005)], (t += FRAME), ASPECT);
      expect(r.kind).toBe('tracking');
      if (r.kind === 'tracking') expect(r.hand.cx).toBeLessThan(0.5);
    }
  });

  it('drops the track instead of guessing when two hands overlap the tracked position', () => {
    const s = new HandSelector();
    let t = 0;
    for (let i = 0; i < 3; i++) s.update([cand(0.5)], (t += FRAME), ASPECT);
    const r = s.update([cand(0.49), cand(0.51)], (t += FRAME), ASPECT);
    expect(r).toEqual({ kind: 'none', lost: true });
  });

  it('bridges short dropouts, then reports loss', () => {
    const s = new HandSelector();
    let t = 0;
    for (let i = 0; i < 3; i++) s.update([cand(0.5)], (t += FRAME), ASPECT);
    expect(s.update([], (t += FRAME), ASPECT).kind).toBe('holding');
    expect(s.update([], t + CONFIG.tracking.lostGraceMs + 10, ASPECT)).toEqual({ kind: 'none', lost: true });
  });

  it('treats an implausible jump as a different hand (loss, then reacquire)', () => {
    const s = new HandSelector();
    let t = 0;
    for (let i = 0; i < 3; i++) s.update([cand(0.2)], (t += FRAME), ASPECT);
    expect(s.update([cand(0.9)], (t += FRAME), ASPECT).kind).toBe('holding');
  });
});

describe('HandPipeline + InputHub', () => {
  function setup() {
    const hub = new InputHub(CONFIG.hit.pinchHistoryMs);
    const pipe = new HandPipeline(hub);
    let t = 1000;
    const feed = (hands: ReturnType<typeof makeHand>[], n = 1) => {
      let starts = 0;
      for (let i = 0; i < n; i++) {
        t += FRAME;
        pipe.process(hands, t, ASPECT);
        if (hub.take(t).pinchStart) starts++;
      }
      return starts;
    };
    return { hub, pipe, feed, now: () => t };
  }
  const open = (cx = 0.5) => makeHand({ cx, ratio: 1.05 });
  const pinched = (cx = 0.5) => makeHand({ cx, ratio: 0.08 });

  it('produces one pinch event for a held pinch', () => {
    const { feed, hub } = setup();
    expect(feed([open()], 6)).toBe(0);
    expect(hub.present).toBe(true);
    expect(feed([pinched()], 60)).toBe(1);
    expect(hub.pinching).toBe(true);
  });

  it('tracking loss clears pinch state and never creates a catch event', () => {
    const { feed, hub } = setup();
    feed([open()], 6);
    feed([pinched()], 1); // first closed frame, not yet stable
    // Hand disappears for longer than the grace period.
    const starts = feed([], 15);
    expect(starts).toBe(0);
    expect(hub.present).toBe(false);
    expect(hub.pinching).toBe(false);
  });

  it('a pending pinch event is discarded when tracking is lost before the game reads it', () => {
    const { pipe, hub, now } = setup();
    let t = now();
    for (let i = 0; i < 6; i++) pipe.process([open()], (t += FRAME), ASPECT);
    for (let i = 0; i < 3; i++) pipe.process([pinched()], (t += FRAME), ASPECT);
    hub.setPresent(false); // e.g. loss reported before the next render frame
    expect(hub.take(t).pinchStart).toBe(false);
  });

  it('on reacquisition an already-pinched hand must open before a pinch counts', () => {
    const { feed } = setup();
    feed([open()], 6);
    feed([], 15); // lost
    expect(feed([pinched()], 20)).toBe(0); // returns already pinched: no catch
    feed([open()], 4);
    expect(feed([pinched()], 4)).toBe(1);
  });

  it('mirrors horizontally by default, and can be reversed', () => {
    const { feed, hub, pipe } = setup();
    // Hand on the left of the camera image = visitor's right side when facing the camera.
    feed([open(0.3)], 10);
    expect(hub.u).toBeGreaterThan(0.5);
    pipe.mapper.mirror = false;
    pipe.reset();
    feed([open(0.3)], 10);
    expect(hub.u).toBeLessThan(0.5);
  });

  it('smoothing follows a moving hand without large lag', () => {
    const { feed, hub } = setup();
    feed([open(0.4)], 6);
    feed([open(0.6)], 6); // ~200 ms after a quick move
    const tip = open(0.6)[8];
    const raw = new HandPipeline(new InputHub(100)).mapper.mapRaw(tip.x, tip.y);
    expect(Math.abs(hub.u - raw.u)).toBeLessThan(0.03);
  });
});
