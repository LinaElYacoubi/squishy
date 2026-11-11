import { CursorMapper } from './cursorMapper';
import { MultiHandSelector, toCandidate } from './handSelection';
import type { InputHub } from './inputHub';
import { LM, PinchDetector, pinchRatio, type Point3 } from './pinch';

export interface PipelineDebug {
  tracking: boolean;
  ratio: number | null;
  pinching: boolean;
  armed: boolean;
  hands: number;
  /** Players currently followed. */
  players: number;
}

/** Per-player state: which hand is followed, its pinch and its smoothed cursor. */
interface PlayerSlot {
  hub: InputHub;
  pinch: PinchDetector;
  mapper: CursorMapper;
  selected: readonly Point3[] | null;
  ratio: number | null;
  armed: boolean;
}

/**
 * Turns raw hand landmark results into cursor and pinch state on one InputHub per player.
 * Contains no browser or MediaPipe dependencies, so it can be tested with plain landmark arrays.
 */
export class HandPipeline {
  readonly selector: MultiHandSelector;
  private players: PlayerSlot[];
  debug: PipelineDebug = emptyDebug();

  /** One hub per player (index = player). A single hub means a single player. */
  constructor(hubs: InputHub | readonly InputHub[]) {
    const list = Array.isArray(hubs) ? hubs : [hubs as InputHub];
    this.players = list.map((hub) => ({
      hub,
      pinch: new PinchDetector(),
      mapper: new CursorMapper(),
      selected: null,
      ratio: null,
      armed: false,
    }));
    this.selector = new MultiHandSelector(list.length);
  }

  /** Player 1's pinch detector. */
  get pinch(): PinchDetector {
    return this.players[0].pinch;
  }

  /** Mirror and input region are set here and shared by every player. */
  get mapper(): CursorMapper {
    return this.players[0].mapper;
  }

  /** Landmarks of player 1's hand (setup preview). */
  get selected(): readonly Point3[] | null {
    return this.players[0].selected;
  }

  /** Landmarks of each player's hand, by player (setup preview). */
  get selectedAll(): readonly (readonly Point3[] | null)[] {
    return this.players.map((p) => p.selected);
  }

  get maxPlayers(): number {
    return this.players.length;
  }

  /** Limit how many hands are followed (1 or 2). Players beyond it disappear. */
  setPlayerCount(n: number): void {
    this.selector.setActiveSlots(n);
    for (let i = this.selector.activeSlots; i < this.players.length; i++) this.clear(this.players[i]);
  }

  reset(): void {
    this.selector.reset();
    for (const p of this.players) this.clear(p);
    this.debug = emptyDebug();
  }

  /**
   * @param hands landmarks for each detected hand (normalised image coordinates)
   * @param aspect video width / height
   */
  process(hands: readonly (readonly Point3[])[], tMs: number, aspect: number): void {
    const candidates = hands.filter((h) => h.length >= 21).map((h) => toCandidate(h, aspect));
    const results = this.selector.update(candidates, tMs, aspect);
    const shared = this.players[0].mapper;

    results.forEach((sel, i) => {
      const p = this.players[i];
      if (sel.kind === 'holding') return;
      if (sel.kind === 'none') {
        if (sel.lost || p.hub.present) this.clear(p);
        p.selected = null;
        return;
      }

      const lm = sel.hand.landmarks;
      if (sel.acquired) {
        // A new or returning hand must show an open hand before a pinch counts.
        p.pinch.reset();
        p.mapper.reset();
        p.hub.markAcquired();
      }
      p.selected = lm;
      p.mapper.mirror = shared.mirror;
      p.mapper.region = shared.region;

      const tip = lm[LM.INDEX_TIP];
      const { u, v } = p.mapper.map(tip.x, tip.y, tMs);
      p.hub.setPresent(true);
      p.hub.move(u, v, tMs);

      p.ratio = pinchRatio(lm, aspect);
      const res = p.pinch.update(p.ratio, tMs);
      p.armed = res.armed;
      p.hub.setPinching(res.pinching);
      if (res.pinchStart) p.hub.pinchStart();
    });

    const first = this.players[0];
    this.debug = {
      tracking: first.selected !== null,
      ratio: first.selected ? first.ratio : null,
      pinching: first.selected ? first.pinch.pinching : false,
      armed: first.selected ? first.armed : false,
      hands: candidates.length,
      players: this.players.filter((p) => p.selected !== null).length,
    };
  }

  private clear(p: PlayerSlot): void {
    p.pinch.reset();
    p.mapper.reset();
    p.hub.setPresent(false);
    p.selected = null;
    p.ratio = null;
    p.armed = false;
  }
}

function emptyDebug(): PipelineDebug {
  return { tracking: false, ratio: null, pinching: false, armed: false, hands: 0, players: 0 };
}
