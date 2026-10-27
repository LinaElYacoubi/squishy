export interface TimedPoint {
  x: number;
  y: number;
  /** Milliseconds. */
  t: number;
}

/** Never look further back than this for a release velocity. */
const MAX_LOOKBACK_MS = 250;

export interface ThrowSettings {
  windowMs: number;
  ignoreLastMs: number;
  /** Speeds in world units per second. */
  minSpeed: number;
  maxSpeed: number;
  spikeSpeed: number;
  scale: number;
}

/**
 * Estimates a throw velocity from recent cursor positions (oldest first).
 *
 * Uses the median of segment velocities inside a short window that ends slightly before the
 * release (so the finger opening is ignored), drops segments that are implausibly fast
 * (tracking jumps), and returns null for slow releases, which are gentle drops.
 */
export function estimateThrowVelocity(points: readonly TimedPoint[], s: ThrowSettings): { x: number; y: number } | null {
  if (points.length < 3) return null;
  const end = points[points.length - 1].t - s.ignoreLastMs;
  const usable = points.filter((p) => p.t <= end);
  let pts = usable.filter((p) => p.t >= end - s.windowMs);
  // Sparse samples (30 Hz tracking, coalesced pointer events): use the last three if they are recent.
  if (pts.length < 3) {
    pts = usable.slice(-3);
    if (pts.length < 3 || end - pts[0].t > MAX_LOOKBACK_MS) return null;
  }

  const vxs: number[] = [];
  const vys: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const vx = (pts[i].x - pts[i - 1].x) / dt;
    const vy = (pts[i].y - pts[i - 1].y) / dt;
    if (Math.hypot(vx, vy) > s.spikeSpeed) continue;
    vxs.push(vx);
    vys.push(vy);
  }
  if (vxs.length < 2) return null;

  const vx = median(vxs);
  const vy = median(vys);
  const speed = Math.hypot(vx, vy);
  if (speed < s.minSpeed) return null;
  // Scale the hand speed, but never exceed maxSpeed.
  const k = Math.min(s.scale, s.maxSpeed / speed);
  return { x: vx * k, y: vy * k };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
