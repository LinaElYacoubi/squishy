export type InputSource = 'hand' | 'mouse';

export interface InputSample {
  u: number;
  v: number;
  t: number;
}

/** What the game sees each frame. Coordinates are normalised to the safe area (0..1, top-left origin). */
export interface InputSnapshot {
  present: boolean;
  u: number;
  v: number;
  pinching: boolean;
  /** A new pinch began since the last snapshot. Delivered exactly once. */
  pinchStart: boolean;
  /** A hand was (re)acquired since the last snapshot. */
  acquired: boolean;
  /** Recent cursor positions, newest last, for lenient pinch hit testing. */
  history: readonly InputSample[];
}

/**
 * The single place where hand tracking and mouse test mode write cursor state,
 * so both drive exactly the same gameplay logic.
 */
export class InputHub {
  present = false;
  u = 0.5;
  v = 0.5;
  pinching = false;
  private pendingPinch = false;
  private pendingAcquired = false;
  private history: InputSample[] = [];

  constructor(private historyMs: number) {}

  move(u: number, v: number, t: number): void {
    this.u = u;
    this.v = v;
    this.history.push({ u, v, t });
    this.prune(t);
  }

  setPresent(present: boolean): void {
    if (this.present === present) return;
    this.present = present;
    if (!present) {
      // Losing the cursor clears every pinch state, so tracking loss can never cause a catch.
      this.pinching = false;
      this.pendingPinch = false;
      this.history.length = 0;
    }
  }

  setPinching(pinching: boolean): void {
    this.pinching = this.present && pinching;
  }

  pinchStart(): void {
    if (this.present) this.pendingPinch = true;
  }

  markAcquired(): void {
    this.pendingAcquired = true;
  }

  take(t: number): InputSnapshot {
    this.prune(t);
    const snap: InputSnapshot = {
      present: this.present,
      u: this.u,
      v: this.v,
      pinching: this.pinching,
      pinchStart: this.present && this.pendingPinch,
      acquired: this.pendingAcquired,
      history: this.history.slice(),
    };
    this.pendingPinch = false;
    this.pendingAcquired = false;
    return snap;
  }

  reset(): void {
    this.setPresent(false);
    this.pendingPinch = false;
    this.pendingAcquired = false;
    this.history.length = 0;
  }

  private prune(t: number): void {
    const cutoff = t - this.historyMs;
    let i = 0;
    while (i < this.history.length && this.history[i].t < cutoff) i++;
    if (i > 0) this.history.splice(0, i);
  }
}
