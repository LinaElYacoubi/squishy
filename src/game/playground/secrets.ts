import { CONFIG } from '../../config';

export type SecretName = 'dizzy' | 'heart' | 'giggle';

/**
 * Small surprises tied to things visitors already do:
 *   dizzy:  spiral eyes after a big bounce (many bounces or a hard impact)
 *   heart:  a heart-shaped bubble after being petted for a moment
 *   giggle: giggles after being held stretched out for a while
 * Each has a cooldown so it stays special. Timing only; the playground plays the reaction.
 */
export class SecretReactions {
  private t = 0;
  private lastAt: Record<SecretName, number> = { dizzy: -Infinity, heart: -Infinity, giggle: -Infinity };
  private stretchHeld = 0;
  /** How many times each secret has fired (diagnostics and tests). */
  readonly count: Record<SecretName, number> = { dizzy: 0, heart: 0, giggle: 0 };

  update(dt: number): void {
    this.t += dt;
  }

  private cooldownMs(name: SecretName): number {
    const s = CONFIG.playground.secrets;
    return name === 'dizzy' ? s.dizzyCooldownMs : name === 'heart' ? s.heartCooldownMs : s.giggleCooldownMs;
  }

  ready(name: SecretName): boolean {
    return (this.t - this.lastAt[name]) * 1000 >= this.cooldownMs(name);
  }

  /** Mark a secret as played (starts its cooldown). Returns false if it was cooling down. */
  fire(name: SecretName): boolean {
    if (!this.ready(name)) return false;
    this.lastAt[name] = this.t;
    this.count[name]++;
    return true;
  }

  /** A creature landed after this many bounces with this hardest impact (0..1). */
  checkDizzy(bounces: number, hardestImpact: number): boolean {
    const s = CONFIG.playground.secrets;
    if (bounces < s.dizzyMinBounces && hardestImpact < s.dizzyMinImpact) return false;
    return this.fire('dizzy');
  }

  /** Petting has lasted `petSeconds`. */
  checkHeart(petSeconds: number): boolean {
    if (petSeconds * 1000 < CONFIG.playground.secrets.heartAfterPetMs) return false;
    return this.fire('heart');
  }

  /** Called every frame with the held creature's stretch (or null when nothing is held). */
  checkGiggle(dt: number, stretch: number | null): boolean {
    const s = CONFIG.playground.secrets;
    if (stretch === null || stretch < s.giggleStretch) {
      this.stretchHeld = 0;
      return false;
    }
    this.stretchHeld += dt;
    if (this.stretchHeld * 1000 < s.giggleHoldMs) return false;
    this.stretchHeld = 0;
    return this.fire('giggle');
  }

  reset(): void {
    this.stretchHeld = 0;
  }
}
