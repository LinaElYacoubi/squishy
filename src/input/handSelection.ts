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

  /** Where the followed hand was last seen (null while not tracking). */
  get trackedAt(): { cx: number; cy: number; size: number } | null {
    return this.track;
  }

  /** Largest accepted frame-to-frame movement for a hand of this palm size. */
  gate(size: number): number {
    return Math.max(this.cfg.maxJumpMin, this.cfg.maxJumpPalms * size);
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

/**
 * Follows up to `slots` hands at once, one per player. Each slot is a HandSelector, so every
 * player gets the same safeguards as a single hand (consistent acquisition, grace period, and
 * dropping the track instead of guessing when hands overlap).
 *
 * Slots that already follow a hand update first and claim it. Only one empty slot acquires at a
 * time, from hands nobody follows and that are not near a briefly missing tracked hand, so two
 * players can never end up on the same hand.
 */
export class MultiHandSelector {
  readonly slots: HandSelector[];
  /** How many slots may follow a hand (1 = single player). */
  private active: number;

  constructor(count: number, cfg: SelectionConfig = CONFIG.tracking) {
    this.slots = Array.from({ length: count }, () => new HandSelector(cfg));
    this.active = count;
  }

  get activeSlots(): number {
    return this.active;
  }

  setActiveSlots(n: number): void {
    this.active = Math.max(1, Math.min(this.slots.length, Math.round(n)));
    for (let i = this.active; i < this.slots.length; i++) this.slots[i].reset();
  }

  reset(): void {
    for (const s of this.slots) s.reset();
  }

  update(candidates: readonly HandCandidate[], tMs: number, aspect: number): SelectionResult[] {
    const results: SelectionResult[] = this.slots.map(() => ({ kind: 'none', lost: false }));
    const claimed = new Set<HandCandidate>();
    const updated = new Set<number>();

    // 1. Slots already following a hand keep it.
    for (let i = 0; i < this.active; i++) {
      const s = this.slots[i];
      if (!s.isTracking) continue;
      updated.add(i);
      const r = s.update(
        candidates.filter((c) => !claimed.has(c)),
        tMs,
        aspect,
      );
      if (r.kind === 'tracking') claimed.add(r.hand);
      results[i] = r;
    }

    // 2. Hands that might belong to a tracked hand that is briefly missing are off limits.
    const reserved = (c: HandCandidate) =>
      this.slots.some((s) => {
        const t = s.trackedAt;
        return t !== null && Math.hypot((c.cx - t.cx) * aspect, c.cy - t.cy) < s.gate(t.size);
      });
    const free = candidates.filter((c) => !claimed.has(c) && !reserved(c));

    // 3. The first empty slot acquires; later empty slots wait their turn.
    let acquiring = false;
    for (let i = 0; i < this.active; i++) {
      const s = this.slots[i];
      if (updated.has(i)) continue;
      results[i] = s.update(acquiring ? [] : free, tMs, aspect);
      acquiring = true;
    }
    return results;
  }
}

/** Prefer the clearly closest hand (largest palm); if sizes are similar, prefer the most central. */
function pickNewHand(candidates: readonly HandCandidate[]): HandCandidate {
  const bySize = [...candidates].sort((a, b) => b.size - a.size);
  if (bySize.length === 1 || bySize[0].size > bySize[1].size * 1.2) return bySize[0];
  const central = (c: HandCandidate) => Math.hypot(c.cx - 0.5, c.cy - 0.5);
  return [...candidates].sort((a, b) => central(a) - central(b))[0];
}
