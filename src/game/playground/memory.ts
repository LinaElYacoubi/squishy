import { CONFIG } from '../../config';
import type { FoodKind } from '../food';

/** Something Squishy's memory wants the playground to show this frame. */
export type MemoryCue =
  /** Hungry for a while: ask for a snack. */
  | 'hungry'
  /** Petted long enough to doze off. */
  | 'fall-asleep'
  /** Time to let out a snore bubble. */
  | 'snore'
  /** Slept long enough and wakes up by itself. */
  | 'wake-up'
  /** Fond enough of the visitors to call them friends (once per visitor). */
  | 'friend'
  /** A friend came back after a short absence. */
  | 'welcome-back';

/** How a snack went down. */
export type FeedResult = 'normal' | 'hungry' | 'favourite' | 'new-favourite';

/**
 * Squishy's memory: moods that build up during a session and change how it behaves.
 *
 *   hunger      rises while someone plays; snacks lower it. Hungry: asks for food. Full: says no.
 *   sleepiness  rises while being petted. At the top Squishy dozes off until woken or rested.
 *   fondness    per visitor: grows with snacks, petting and tosses. A friend is never dodged.
 *   favourite   the snack kind eaten most (kept until an operator reset, not per visitor).
 *
 * Pure timing and numbers; the playground turns cues into speech, looks and sounds.
 * Nothing here identifies or stores anything about visitors.
 */
export class SquishyMemory {
  hunger: number = CONFIG.playground.memory.startHunger;
  sleepiness = 0;
  /** Slot of the creature that is asleep, or null. */
  sleepingSlot: number | null = null;
  fondness = 0;
  friend = false;
  favourite: FoodKind | null = null;

  private fed: Record<FoodKind, number> = { berry: 0, fruit: 0, blueberry: 0 };
  private stuffed = false;
  private pendingSleep: number | null = null;
  private t = 0;
  private asleepFor = 0;
  private snoreAt = 0;
  private nagAt = 0;
  private pettedThisFrame = false;
  private absentFor = 0;
  private wasPresent = false;

  get asleep(): boolean {
    return this.sleepingSlot !== null;
  }

  get hungry(): boolean {
    return this.hunger >= CONFIG.playground.memory.hungryAt;
  }

  /** Just ate enough: refuses snacks until hunger has risen a little again. */
  get full(): boolean {
    return this.stuffed;
  }

  /** Operator reset: forget everything, including the favourite snack. */
  reset(): void {
    this.hunger = CONFIG.playground.memory.startHunger;
    this.favourite = null;
    this.stuffed = false;
    this.fed = { berry: 0, fruit: 0, blueberry: 0 };
    this.nagAt = this.t + CONFIG.playground.memory.hungerNagS;
    this.newVisitor();
  }

  /** A new visitor: friendship starts over and Squishy is awake. Hunger and favourite stay. */
  newVisitor(): void {
    this.fondness = 0;
    this.friend = false;
    this.absentFor = 0;
    this.wasPresent = false;
    this.wake();
  }

  wake(): void {
    this.sleepingSlot = null;
    this.sleepiness = 0;
    this.asleepFor = 0;
  }

  /** Being petted this frame (call before update). */
  pet(dt: number, slot: number): void {
    const m = CONFIG.playground.memory;
    this.pettedThisFrame = true;
    this.fondness = Math.min(1, this.fondness + m.fondPetPerS * dt);
    if (!this.asleep) {
      this.sleepiness = Math.min(1, this.sleepiness + dt / m.petToSleepS);
      if (this.sleepiness >= 1) this.pendingSleep = slot;
    }
  }

  /** Squishy was tossed (a real throw, not a drop or lost hand). */
  toss(): void {
    this.fondness = Math.min(1, this.fondness + CONFIG.playground.memory.fondToss);
  }

  /** Should a snack offered now be refused? */
  wouldRefuse(): boolean {
    return this.full;
  }

  /** A snack was eaten. */
  feed(kind: FoodKind): FeedResult {
    const m = CONFIG.playground.memory;
    const wasHungry = this.hungry;
    const wasFavourite = this.favourite === kind;
    this.fed[kind]++;
    let result: FeedResult = wasFavourite ? 'favourite' : wasHungry ? 'hungry' : 'normal';
    if (!wasFavourite && this.fed[kind] >= m.favouriteAfter && this.fed[kind] > this.mostFedOther(kind)) {
      this.favourite = kind;
      result = 'new-favourite';
    }
    this.hunger = Math.max(0, this.hunger - m.feedSatisfies - (wasFavourite ? m.favouriteBonus : 0));
    if (this.hunger <= m.fullAt) this.stuffed = true;
    this.fondness = Math.min(1, this.fondness + m.fondFeed);
    this.nagAt = this.t + m.hungerNagS;
    return result;
  }

  /**
   * Advance the moods. `present`: someone is playing. `canNag`: nothing else is being shown or
   * held, so a hunger reminder would not get in the way. Returns what to show this frame.
   */
  update(dt: number, present: boolean, canNag: boolean): MemoryCue[] {
    const m = CONFIG.playground.memory;
    const cues: MemoryCue[] = [];
    this.t += dt;

    // Presence: friendship lasts through short absences, and a friend gets welcomed back.
    if (present) {
      if (!this.wasPresent && this.friend && this.absentFor >= 3 && this.absentFor * 1000 < m.welcomeBackMs) {
        cues.push('welcome-back');
      }
      this.absentFor = 0;
    } else {
      this.absentFor += dt;
      if (this.absentFor * 1000 >= m.welcomeBackMs && (this.fondness > 0 || this.friend)) {
        this.fondness = 0;
        this.friend = false;
      }
    }
    this.wasPresent = present;

    // Hunger grows while someone is around to notice.
    if (present) this.hunger = Math.min(1, this.hunger + dt / m.hungerRiseS);
    if (this.stuffed && this.hunger >= m.fullUntil) this.stuffed = false;
    if (this.hungry && !this.asleep && canNag && present && this.t >= this.nagAt) {
      this.nagAt = this.t + m.hungerNagS;
      cues.push('hungry');
    }

    // Sleep.
    if (this.pendingSleep !== null && !this.asleep) {
      this.sleepingSlot = this.pendingSleep;
      this.asleepFor = 0;
      this.snoreAt = this.t + m.snoreEveryS * 0.6;
      cues.push('fall-asleep');
    }
    this.pendingSleep = null;
    if (this.asleep) {
      this.asleepFor += dt;
      if (this.asleepFor >= m.sleepMaxS) {
        this.wake();
        cues.push('wake-up');
      } else if (this.t >= this.snoreAt) {
        this.snoreAt = this.t + m.snoreEveryS;
        cues.push('snore');
      }
    } else if (!this.pettedThisFrame) {
      this.sleepiness = Math.max(0, this.sleepiness - m.sleepDecayPerS * dt);
    }
    this.pettedThisFrame = false;

    if (!this.friend && this.fondness >= m.friendAt) {
      this.friend = true;
      cues.push('friend');
    }
    return cues;
  }

  /** One line for the operator diagnostics. */
  describe(): string {
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const mood = this.asleep ? 'asleep' : this.full ? 'full' : this.hungry ? 'hungry' : 'ok';
    return `memory: ${mood}  hunger ${pct(this.hunger)}  sleepy ${pct(this.sleepiness)}  fond ${pct(this.fondness)}${this.friend ? ' (friend)' : ''}  favourite ${this.favourite ?? '-'}`;
  }

  private mostFedOther(kind: FoodKind): number {
    let best = 0;
    for (const k of Object.keys(this.fed) as FoodKind[]) if (k !== kind) best = Math.max(best, this.fed[k]);
    return best;
  }
}
