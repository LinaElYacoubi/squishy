import { CONFIG } from '../config';
import { LM, palmSize, type Point3 } from './pinch';

export interface HandCandidate {
  landmarks: readonly Point3[];
  /** Palm centre in normalised image coordinates. */
  cx: number;
  cy: number;
  /** Palm size (aspect-corrected), see palmSize(). */
  size: number;
}

export type SelectionResult =
  /** A hand is being followed. `acquired` is true on the first frame of a new track. */
  | { kind: 'tracking'; hand: HandCandidate; acquired: boolean }
  /** The tracked hand is briefly missing; keep the last state without new data. */
  | { kind: 'holding' }
  /** No hand is tracked. `lost` is true on the frame a track was dropped. */
  | { kind: 'none'; lost: boolean };

export interface SelectionConfig {
  acquireFrames: number;
  lostGraceMs: number;
  maxJumpPalms: number;
  maxJumpMin: number;
  ambiguityRatio: number;
}

export function toCandidate(landmarks: readonly Point3[], aspect: number): HandCandidate {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let cx = 0;
  let cy = 0;
  for (const i of ids) {
    cx += landmarks[i].x;
    cy += landmarks[i].y;
  }
  return { landmarks, cx: cx / ids.length, cy: cy / ids.length, size: palmSize(landmarks, aspect) };
}

/**
 * Follows a single hand across frames so the cursor never jumps between hands or people.
 * A new hand must be seen consistently before it is accepted. If two hands are equally
 * plausible continuations of the current one, the track is dropped and reacquired
 * rather than guessing.
 */
export class HandSelector {
  private track: { cx: number; cy: number; size: number; lastSeen: number } | null = null;
  private pending: { cx: number; cy: number; size: number; count: number } | null = null;

  constructor(private cfg: SelectionConfig = CONFIG.tracking) {}

  get isTracking(): boolean {
    return this.track !== null;
  }

  reset(): void {
    this.track = null;
    this.pending = null;
  }

  update(candidates: readonly HandCandidate[], tMs: number, aspect: number): SelectionResult {
    const d = (c: HandCandidate, p: { cx: number; cy: number }) =>
      Math.hypot((c.cx - p.cx) * aspect, c.cy - p.cy);
    const gate = (size: number) => Math.max(this.cfg.maxJumpMin, this.cfg.maxJumpPalms * size);

    if (this.track) {
      const track = this.track;
      const near = candidates
        .map((c) => ({ c, dist: d(c, track) }))
        .filter((e) => e.dist < gate(track.size))
        .sort((a, b) => a.dist - b.dist);

      if (near.length >= 2 && near[1].dist < Math.max(near[0].dist, 0.01) * this.cfg.ambiguityRatio) {
        // Two hands overlap the tracked position: do not guess, start over.
        this.reset();
        return { kind: 'none', lost: true };
      }
      if (near.length >= 1) {
        const c = near[0].c;
        this.track = { cx: c.cx, cy: c.cy, size: c.size, lastSeen: tMs };
        return { kind: 'tracking', hand: c, acquired: false };
      }
      if (tMs - track.lastSeen > this.cfg.lostGraceMs) {
        this.reset();
        return { kind: 'none', lost: true };
      }
      return { kind: 'holding' };
    }

    // Acquisition.
    if (candidates.length === 0) {
      this.pending = null;
      return { kind: 'none', lost: false };
    }

    let best: HandCandidate;
    const pending = this.pending;
    if (pending) {
      const nearest = [...candidates].sort((a, b) => d(a, pending) - d(b, pending))[0];
      if (d(nearest, pending) < gate(pending.size)) {
        best = nearest;
        pending.count++;
      } else {
        best = pickNewHand(candidates);
        this.pending = { cx: best.cx, cy: best.cy, size: best.size, count: 1 };
      }
    } else {
      best = pickNewHand(candidates);
      this.pending = { cx: best.cx, cy: best.cy, size: best.size, count: 1 };
    }
    this.pending!.cx = best.cx;
    this.pending!.cy = best.cy;
    this.pending!.size = best.size;

    if (this.pending!.count >= this.cfg.acquireFrames) {
      this.pending = null;
      this.track = { cx: best.cx, cy: best.cy, size: best.size, lastSeen: tMs };
      return { kind: 'tracking', hand: best, acquired: true };
    }
    return { kind: 'none', lost: false };
  }
}

/** Prefer the clearly closest hand (largest palm); if sizes are similar, prefer the most central. */
function pickNewHand(candidates: readonly HandCandidate[]): HandCandidate {
  const bySize = [...candidates].sort((a, b) => b.size - a.size);
  if (bySize.length === 1 || bySize[0].size > bySize[1].size * 1.2) return bySize[0];
  const central = (c: HandCandidate) => Math.hypot(c.cx - 0.5, c.cy - 0.5);
  return [...candidates].sort((a, b) => central(a) - central(b))[0];
}
