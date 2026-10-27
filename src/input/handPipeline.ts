import { CursorMapper } from './cursorMapper';
import { HandSelector, toCandidate } from './handSelection';
import type { InputHub } from './inputHub';
import { LM, PinchDetector, pinchRatio, type Point3 } from './pinch';

export interface PipelineDebug {
  tracking: boolean;
  ratio: number | null;
  pinching: boolean;
  armed: boolean;
  hands: number;
}

/**
 * Turns raw hand landmark results into cursor and pinch state on the InputHub.
 * Contains no browser or MediaPipe dependencies, so it can be tested with plain landmark arrays.
 */
export class HandPipeline {
  readonly selector = new HandSelector();
  readonly pinch = new PinchDetector();
  readonly mapper = new CursorMapper();
  debug: PipelineDebug = { tracking: false, ratio: null, pinching: false, armed: false, hands: 0 };
  /** Landmarks of the selected hand (for the setup preview only). */
  selected: readonly Point3[] | null = null;

  constructor(private hub: InputHub) {}

  reset(): void {
    this.selector.reset();
    this.pinch.reset();
    this.mapper.reset();
    this.selected = null;
    this.hub.setPresent(false);
    this.debug = { tracking: false, ratio: null, pinching: false, armed: false, hands: 0 };
  }

  /**
   * @param hands landmarks for each detected hand (normalised image coordinates)
   * @param aspect video width / height
   */
  process(hands: readonly (readonly Point3[])[], tMs: number, aspect: number): void {
    const candidates = hands.filter((h) => h.length >= 21).map((h) => toCandidate(h, aspect));
    const sel = this.selector.update(candidates, tMs, aspect);
    this.debug.hands = candidates.length;

    if (sel.kind === 'holding') return;

    if (sel.kind === 'none') {
      if (sel.lost || this.hub.present) {
        this.pinch.reset();
        this.mapper.reset();
        this.hub.setPresent(false);
      }
      this.selected = null;
      this.debug = { ...this.debug, tracking: false, ratio: null, pinching: false, armed: false };
      return;
    }

    const lm = sel.hand.landmarks;
    if (sel.acquired) {
      // A new or returning hand must show an open hand before a pinch counts.
      this.pinch.reset();
      this.mapper.reset();
      this.hub.markAcquired();
    }
    this.selected = lm;

    const tip = lm[LM.INDEX_TIP];
    const { u, v } = this.mapper.map(tip.x, tip.y, tMs);
    this.hub.setPresent(true);
    this.hub.move(u, v, tMs);

    const ratio = pinchRatio(lm, aspect);
    const res = this.pinch.update(ratio, tMs);
    this.hub.setPinching(res.pinching);
    if (res.pinchStart) this.hub.pinchStart();

    this.debug = { ...this.debug, tracking: true, ratio, pinching: res.pinching, armed: res.armed };
  }
}
