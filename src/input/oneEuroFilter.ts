/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when the hand is still,
 * little lag when it moves quickly. Times are in milliseconds.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff: number,
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.lastT = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1 / 240);
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx = lerp(this.dx, rawDx, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = lerp(this.x, value, alpha(cutoff, dt));
    return this.x;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
