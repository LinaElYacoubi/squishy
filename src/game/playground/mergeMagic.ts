import { CONFIG } from '../../config';
import type { TextKey } from '../../ui/i18n';
import type { CreatureModel, MagicLook } from '../creatureModel';
import type { ParticleKind } from './types';

export interface LookStyle {
  color: string;
  name: TextKey;
  particle: ParticleKind;
}

/** The temporary looks revealed when two mini Squishies merge. */
export const LOOKS: Record<MagicLook, LookStyle> = {
  star: { color: '#ffd34d', name: 'lookStar', particle: 'star' },
  ocean: { color: '#3fc8ff', name: 'lookOcean', particle: 'bubble' },
  galaxy: { color: '#9b6bff', name: 'lookGalaxy', particle: 'sparkle' },
};

const ORDER: readonly MagicLook[] = ['star', 'ocean', 'galaxy'];

/**
 * Merge Magic: picks a look for a merge. The same pair of minis always makes the same look, so
 * visitors can discover all three; merging a merged Squishy again cycles to the next look.
 */
export class MergeMagic {
  private cycle = 0;

  pick(survivor: CreatureModel, absorbed: CreatureModel): MagicLook {
    const pair = [survivor.slot, absorbed.slot].sort().join('-');
    switch (pair) {
      case '1-2':
        return 'star';
      case '1-3':
        return 'ocean';
      case '2-3':
        return 'galaxy';
    }
    // Merging into an already-merged Squishy: a look it did not have yet.
    const next = ORDER[this.cycle++ % ORDER.length];
    return next === survivor.magic ? ORDER[this.cycle++ % ORDER.length] : next;
  }

  /** Two small Squishies combined: reveal the look on the survivor. */
  apply(survivor: CreatureModel, look: MagicLook): LookStyle {
    survivor.setMagic(look, CONFIG.playground.magicMs / 1000);
    survivor.react('excited', 0.9);
    return LOOKS[look];
  }
}
