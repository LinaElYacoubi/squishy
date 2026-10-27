/** Frame-rate-independent animation helpers. All times are in seconds. */

/** Damped spring integrated in small fixed substeps, so it behaves the same at any frame rate. */
export class Spring {
  velocity = 0;

  constructor(
    public value: number,
    public target: number,
    public stiffness: number,
    public damping: number,
  ) {}

  update(dt: number): number {
    const step = 1 / 120;
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(step, remaining);
      const accel = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    return this.value;
  }

  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }
}

/** Exponential approach that is independent of frame rate. `rate` is in 1/seconds. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Small deterministic RNG (mulberry32), so gameplay tests are reproducible. */
export function createRng(seed = Date.now()): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
