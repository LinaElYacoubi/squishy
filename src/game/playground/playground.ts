import { CONFIG } from '../../config';
import type { TextKey } from '../../ui/i18n';
import { clamp } from '../anim';
import type { CreatureModel, Launch } from '../creatureModel';
import type { FoodModel } from '../food';
import { NO_INPUT, type Game, type GameInput, type StageBounds } from '../game';
import { Bubble } from './bubble';
import { BubbleBounce } from './bubbleBounce';
import { SquishyMemory, type MemoryCue } from './memory';
import { MergeMagic } from './mergeMagic';
import { PetDetector, type PetZone } from './petting';
import { SecretReactions } from './secrets';
import { SnackSurprise } from './snackSurprise';
import { SquishySays } from './squishySays';
import {
  GAME_ORDER,
  GAME_TITLE,
  NO_FX,
  Scheduler,
  bubbleBand,
  lookToward,
  mainCreature,
  type GameId,
  type MiniGame,
  type MiniGameContext,
  type PlaygroundFx,
} from './types';

/**
 * free:      Free Play (the default): toss, stretch, feed, pet, merge
 * play:      a Play Together mini-game round
 * celebrate: short celebration after a completed round
 * between:   "Next game" or "Free play" (falls back to Free Play on its own)
 */
export type PlayMode = 'free' | 'play' | 'celebrate' | 'between';

/** Something Squishy says in a speech bubble. */
export interface Speech {
  key: TextKey;
  slot: number;
  until: number;
}

const INVITE_COLOR = '#ff7ad9';
const MINIS_COLOR = '#b98bff';
const HOME_COLOR = '#9fe8c8';

/**
 * Squishy's Playground. Sits on top of the original sandbox (Game) and only uses its public
 * API: grab locks, dodge switch, events and the beforeAnimate hook. The app calls
 * `preUpdate` before `game.update` (pinches on bubbles are consumed there) and wires
 * `animate` into `game.events.beforeAnimate`.
 */
export class Playground {
  mode: PlayMode = 'free';
  current: MiniGame | null = null;
  /** The next game "Play with me" starts (rotates through all three). */
  nextGame: GameId = GAME_ORDER[0];
  /** The one instruction to show (Free Play tips or the mini-game coach), or null. */
  coach: TextKey | null = null;
  speech: Speech | null = null;
  /** Free Play / between-round buttons. */
  readonly uiBubbles: Bubble[] = [];
  fx: PlaygroundFx = NO_FX;
  /** The app sets this while its own prompt or snack hint is on screen, so tips never overlap. */
  hintsBlocked = false;

  readonly pet = new PetDetector();
  readonly secrets = new SecretReactions();
  readonly magic = new MergeMagic();
  /** Squishy's moods: hunger, sleepiness, fondness and a favourite snack. */
  readonly memory = new SquishyMemory();
  /** Completed rounds per game (diagnostics). */
  readonly rounds: Record<GameId, number> = { says: 0, snack: 0, bounce: 0 };

  private time = 0;
  private modeT = 0;
  private absentFor = 0;
  private visitorT = 0;
  private visitorPinched = false;
  private greeted = false;
  private inviteBubble: Bubble | null = null;
  private minisBubble: Bubble | null = null;
  private stopBubble: Bubble | null = null;
  private nextBubble: Bubble | null = null;
  private homeBubble: Bubble | null = null;
  private lastGlance = 0;
  private tipsShown = new Set<TextKey>();
  private tipUntil = 0;
  private nextTipAt = 0;
  private did = { pet: false, split: false, merge: false };
  private sched = new Scheduler();
  /** This frame's input per player (index = player). */
  private inputs: readonly GameInput[] = [];
  private wasPetting = false;
  /** The hand currently petting (stays with it while petting continues). */
  private petPlayer = 0;
  /** The creature that fell asleep (for the wake-up reaction). */
  private sleepSlot: number | null = null;
  private presentCount = 0;
  private lastTwoAt = -Infinity;

  constructor(
    readonly game: Game,
    private rng: () => number = Math.random,
  ) {}

  get bubbles(): readonly Bubble[] {
    return this.current ? [...this.uiBubbles, ...this.current.bubbles] : this.uiBubbles;
  }

  /** A round (or its celebration / choice) is in progress. */
  get inRound(): boolean {
    return this.mode !== 'free';
  }

  get reduced(): boolean {
    return this.game.reducedMotion;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Back to the welcome state (Free Play, nothing pending, tips and greeting armed again). */
  reset(): void {
    this.endRound();
    this.uiBubbles.length = 0;
    this.inviteBubble = this.minisBubble = null;
    this.speech = null;
    this.coach = null;
    this.pet.reset();
    this.secrets.reset();
    this.resetVisitor();
    this.absentFor = 0;
    this.presentCount = 0;
    // A new visitor: friendship starts over. Hunger and the favourite snack are remembered.
    this.memory.newVisitor();
    this.sleepSlot = null;
  }

  /** Start a mini-game now (Play with me, Next game, or the operator panel). */
  startGame(id: GameId): void {
    this.endRound();
    const g = this.game;
    // Mini-games are played with one Squishy: bring a single one back (minis pop back together).
    if (g.alive.length !== 1 || !g.calm) g.reset(true, true);
    this.removeFreeBubbles();
    this.current = this.makeGame(id);
    this.current.start();
    this.setMode('play');
    this.stopBubble = this.addUi('stop', HOME_COLOR, 'stopGame', CONFIG.playground.smallBubbleRadii * 0.85);
    this.layout(g.bounds);
    this.nextGame = GAME_ORDER[(GAME_ORDER.indexOf(id) + 1) % GAME_ORDER.length];
    this.pet.reset();
    this.memory.wake();
    this.sleepSlot = null;
  }

  /** Leave any round and return to Free Play. */
  backToFree(): void {
    this.endRound();
    this.setMode('free');
    this.coach = null;
    this.tipUntil = 0;
    this.nextTipAt = this.time + 6;
  }

  layout(b: StageBounds): void {
    const band = bubbleBand(b);
    const R = b.mainRadius;
    const width = b.right - b.left;
    const place = (bub: Bubble | null, side: -1 | 1, dy: number) => {
      if (!bub) return;
      const x = side > 0 ? b.right - bub.r * 1.25 : b.left + bub.r * 1.25;
      bub.moveTo(x, clamp(band.mid + dy, band.low + bub.r * 0.4, band.high));
    };
    const big = Math.min(CONFIG.playground.playBubbleRadii * R, width * 0.2);
    const small = Math.min(CONFIG.playground.smallBubbleRadii * R, width * 0.15);
    if (this.inviteBubble) this.inviteBubble.r = big;
    if (this.minisBubble) this.minisBubble.r = small;
    place(this.inviteBubble, 1, 0);
    place(this.minisBubble, -1, -R * 0.3);
    if (this.nextBubble) this.nextBubble.r = big;
    if (this.homeBubble) this.homeBubble.r = big * 0.85;
    place(this.nextBubble, 1, 0);
    place(this.homeBubble, -1, 0);
    if (this.stopBubble) {
      this.stopBubble.r = small * 0.8;
      // Right edge at floor level: clear of the answer bubbles, the targets, the tray and the
      // instruction text in both orientations.
      this.stopBubble.moveTo(b.right - this.stopBubble.r * 1.2, b.floorY + this.stopBubble.r * 1.6);
    }
    this.current?.layout(b);
  }

  // ---------------------------------------------------------------- per frame

  /**
   * Before the game update. Takes one input per player (or a single input for player 1) and
   * returns the inputs the game should see: a pinch that lands on a playground bubble is
   * consumed here, so it never also grabs Squishy or a snack. One bubble press per frame.
   */
  preUpdate(dt: number, inputs: GameInput | readonly GameInput[]): GameInput[] {
    this.time += dt;
    this.modeT += dt;
    const list: GameInput[] = Array.isArray(inputs) ? inputs.slice() : [inputs as GameInput];
    this.inputs = list;
    this.sched.update(dt);
    this.secrets.update(dt);
    if (this.speech && this.time >= this.speech.until) this.speech = null;

    const present = list.some((i) => i.present);
    const primary = list.find((i) => i.present) ?? list[0] ?? NO_INPUT;
    this.trackVisitor(dt, list);

    let pressed = false;
    const out = list.map((input, player) => {
      if (input.pinchStart) this.visitorPinched = true;
      if (pressed || !input.pinchStart || !input.present || !this.game.calm) return input;
      // What is under the cursor right now wins. The lenient check (recent cursor history, for
      // fingertip drift while pinching) only applies when no snack or Squishy is under it.
      let b = this.bubbleAt({ ...input, recent: [] });
      if (!b && this.game.hover(input, player) === 'none') b = this.bubbleAt(input);
      if (!b) return input;
      pressed = true;
      this.press(b);
      return { ...input, pinchStart: false };
    });

    switch (this.mode) {
      case 'free':
        this.updateFree(present);
        this.updateMemory(dt, present);
        break;
      case 'play':
        this.current?.update(dt, primary);
        if (this.current) this.coach = this.current.coach;
        if (this.current?.done) this.celebrate();
        break;
      case 'celebrate':
        if (this.modeT * 1000 >= CONFIG.playground.celebrateMs) this.offerChoice();
        break;
      case 'between':
        if (this.modeT * 1000 >= CONFIG.playground.betweenMs) this.backToFree();
        break;
    }
    // Nobody there any more: end the round gently (the inactivity reset handles the rest).
    if (this.inRound && this.absentFor * 1000 >= CONFIG.playground.abandonMs) this.backToFree();

    for (const b of this.uiBubbles) b.update(dt, this.reduced);
    for (let i = this.uiBubbles.length - 1; i >= 0; i--) if (this.uiBubbles[i].dead) this.uiBubbles.splice(i, 1);
    return out;
  }

  /** Inside game.update, after gameplay set its targets and before the springs advance. */
  animate(dt: number): void {
    const input = this.inputs.find((i) => i.present) ?? this.inputs[0] ?? null;
    const g = this.game;

    // Anticipation before a toss: a fast-moving held Squishy gets a big excited face.
    const held = g.grabbed;
    if (held) {
      const speed = Math.hypot(held.vx, held.vy);
      if (speed > g.bounds.mainRadius * 3.5 && !held.reactionExpression) held.baseExpression = 'excited';
      if (this.mode === 'free' && this.secrets.checkGiggle(dt, held.stretch.value)) this.giggle(held);
    } else {
      this.secrets.checkGiggle(dt, null);
    }

    if (this.mode === 'play' && input) this.current?.animate?.(dt, input);
    if (this.mode === 'celebrate') {
      const c = mainCreature(g);
      if (c && !c.reactionExpression) c.baseExpression = 'happy';
    }
    if (this.mode === 'between') {
      const c = mainCreature(g);
      const b = this.nextBubble;
      if (c && b && c.motion === 'free' && Math.sin(this.modeT * 1.4) > 0.6) lookToward(c, b.x, b.y, 0.2);
    }

    this.updatePetting(dt, this.inputs);
    this.animateSleep();
    for (const c of g.creatures) if (!c.alive) c.relax = 0;
  }

  // ---------------------------------------------------------------- game events (wired by the app)

  onOffer(f: FoodModel, c: CreatureModel): 'eat' | 'refuse' {
    if (this.mode === 'play' && this.current?.onOffer) return this.current.onOffer(f, c);
    if (this.mode === 'free' && this.memory.wouldRefuse()) {
      // Remembers the last snacks: too full for another one right now.
      c.react('cheeky', 1.2);
      c.wiggle(0.5, 0.06, 3);
      this.say('sayFull', c, 1500);
      this.fx.sound('nope');
      return 'refuse';
    }
    return 'eat';
  }

  onFeed(f: FoodModel, c: CreatureModel): void {
    const result = this.memory.feed(f.kind);
    if (this.mode === 'play') {
      this.current?.onFeed?.(f, c);
      return;
    }
    if (this.mode !== 'free') return;
    if (result === 'favourite' || result === 'new-favourite') {
      this.say('sayFavourite', c, 1600);
      this.fx.heart(c.x, c.centerY + c.size * 1.1);
      this.fx.sound('sparkle');
    } else if (result === 'hungry') {
      this.say('sayYum', c, 1200);
    }
  }

  onRelease(kind: 'drop' | 'throw' | 'lost', c: CreatureModel): void {
    if (this.mode === 'play') this.current?.onRelease?.(kind, c);
    else if (kind === 'throw') this.memory.toss();
  }

  onLand(c: CreatureModel, launch: Launch): void {
    if (this.mode === 'play') {
      this.current?.onLand?.(c, launch);
      return;
    }
    // Secret: a big bounce makes Squishy dizzy (not after a lost hand: that was not a toss).
    if (launch === 'throw' && this.secrets.checkDizzy(c.bounces, c.hardestImpact)) this.dizzy(c);
  }

  onMerge(survivor: CreatureModel, absorbed: CreatureModel): void {
    this.did.merge = true;
    // The tip did its job: clear it so the look's name is the one thing to read.
    if (this.coach === 'tipMerge') this.tipUntil = 0;
    const look = this.magic.pick(survivor, absorbed);
    const style = this.magic.apply(survivor, look);
    this.fx.burst(survivor.x, survivor.centerY, style.particle, style.color);
    this.fx.sound('sparkle');
    this.say(style.name, survivor, 2400);
  }

  onSplit(): void {
    this.did.split = true;
    if (this.mode === 'free' && !this.tipsShown.has('tipMerge')) this.showTip('tipMerge', 4500);
  }

  // ---------------------------------------------------------------- free play

  private updateFree(present: boolean): void {
    const ready = present && (this.visitorPinched || this.visitorT * 1000 >= CONFIG.playground.inviteAfterMs);
    const g = this.game;

    // "Play with me": a big, clearly highlighted invitation.
    if (ready && !this.inviteBubble) {
      this.inviteBubble = this.addUi('play', INVITE_COLOR, 'playWithMe', CONFIG.playground.playBubbleRadii);
      this.inviteBubble.attention = true;
      this.inviteBubble.glowTarget = 0.5;
      this.layout(g.bounds);
      this.glanceAtInvite();
    }
    if (!present && this.inviteBubble && this.absentFor > 2) this.removeFreeBubbles();

    // "Mini me!": bring back the minis without the operator panel (only with one Squishy).
    const canSplit = ready && g.alive.length === 1 && g.calm && g.alive[0].motion === 'free' && g.maxCreatures >= 3;
    if (canSplit && !this.minisBubble) {
      this.minisBubble = this.addUi('minis', MINIS_COLOR, 'makeMinis', CONFIG.playground.smallBubbleRadii);
      this.layout(g.bounds);
    } else if (!canSplit && this.minisBubble && g.alive.length !== 1) {
      this.minisBubble.leave();
      this.minisBubble = null;
    }

    // Squishy now and then glances at the invitation.
    if (this.inviteBubble && (this.time - this.lastGlance) * 1000 >= CONFIG.playground.inviteGlanceMs) this.glanceAtInvite();

    this.updateTips(present);
  }

  private glanceAtInvite(): void {
    this.lastGlance = this.time;
    const c = mainCreature(this.game);
    const b = this.inviteBubble;
    if (!c || !b || c.motion !== 'free' || this.game.heldFood) return;
    lookToward(c, b.homeX, b.homeY, 0.9);
    b.bump();
  }

  /** Discovery tips, one at a time, each at most once per visitor. */
  private updateTips(present: boolean): void {
    if (this.time < this.tipUntil) return;
    this.coach = null;
    if (!present || this.hintsBlocked || this.time < this.nextTipAt || !this.inviteBubble) return;
    const g = this.game;
    let tip: TextKey | null = null;
    if (!this.tipsShown.has('inviteCoach')) tip = 'inviteCoach';
    else if (!this.did.pet && !this.tipsShown.has('tipPet') && g.alive.length >= 1) tip = 'tipPet';
    else if (!this.did.split && this.minisBubble && !this.tipsShown.has('tipMinis')) tip = 'tipMinis';
    else if (!this.did.merge && g.alive.length > 1 && !this.tipsShown.has('tipMerge')) tip = 'tipMerge';
    if (tip) this.showTip(tip, 4500);
    this.nextTipAt = this.time + 10;
  }

  private showTip(key: TextKey, ms: number): void {
    this.tipsShown.add(key);
    this.coach = key;
    this.tipUntil = this.time + ms / 1000;
    this.nextTipAt = this.tipUntil + 8;
  }

  private trackVisitor(dt: number, inputs: readonly GameInput[]): void {
    const here = inputs.filter((i) => i.present);
    const count = here.length;
    if (count > 0) {
      // A new visitor (or someone back after a while): Squishy notices and says hi.
      if (this.absentFor * 1000 >= CONFIG.activity.lostPromptMs) this.resetVisitor();
      this.absentFor = 0;
      this.visitorT += dt;
      if (!this.greeted && this.mode === 'free') this.greet(here[0]);
      // A second hand joins: Squishy is delighted to have two friends.
      else if (count >= 2 && this.presentCount < 2 && this.mode === 'free' && this.time - this.lastTwoAt > 20) {
        this.greetSecond(here[here.length - 1]);
      }
    } else {
      this.absentFor += dt;
    }
    this.presentCount = count;
  }

  private greetSecond(input: GameInput): void {
    const c = mainCreature(this.game);
    if (!c || c.motion !== 'free' || this.memory.asleep) return;
    this.lastTwoAt = this.time;
    lookToward(c, input.x, input.y, 0.8);
    c.react('excited', 1.2);
    this.game.hopInPlace(c, 0.35);
    this.say('sayTwoFriends', c, 1500);
    this.fx.sound('hello', 0.8, 1.2);
  }

  // ---------------------------------------------------------------- memory

  /** Moods advance in Free Play only; mini-games keep Squishy focused on the round. */
  private updateMemory(dt: number, present: boolean): void {
    const g = this.game;
    const mem = this.memory;
    const sleeper = mem.sleepingSlot !== null ? g.creatures[mem.sleepingSlot] : null;
    // Picked up, or a snack held to its mouth: wide awake at once.
    if (sleeper && (!sleeper.alive || sleeper.motion !== 'free' || g.feedTargets.includes(sleeper))) {
      mem.wake();
      this.sleepSlot = null;
      if (sleeper.alive) sleeper.react('surprised', 0.5);
    }
    const canNag = !this.hintsBlocked && this.coach === null && g.calm;
    for (const cue of mem.update(dt, present, canNag)) this.playCue(cue);
    // Asleep or with a friend, Squishy stays put instead of hopping away from the hand.
    g.dodgeEnabled = !mem.asleep && !mem.friend;
  }

  private playCue(cue: MemoryCue): void {
    const g = this.game;
    const main = mainCreature(g);
    switch (cue) {
      case 'hungry': {
        if (!main || main.motion !== 'free' || g.heldFood) return;
        const b = g.bounds;
        lookToward(main, b.trayX, b.trayY, 1.4);
        main.react('hungry', 1.4);
        main.wiggle(0.6, 0.05, 5);
        this.say('sayHungry', main, 1800);
        this.fx.sound('hello', 0.5, 0.8);
        return;
      }
      case 'fall-asleep': {
        const c = this.memory.sleepingSlot !== null ? g.creatures[this.memory.sleepingSlot] : null;
        if (!c) return;
        this.sleepSlot = c.slot;
        this.say('sayZzz', c, 1500);
        this.fx.sound('purr', 0.5, 0.7);
        return;
      }
      case 'snore': {
        const c = this.memory.sleepingSlot !== null ? g.creatures[this.memory.sleepingSlot] : null;
        if (c?.alive) this.fx.burst(c.x + c.size * 0.45, c.centerY + c.size * 0.9, 'bubble', '#bfe9ff', 2);
        return;
      }
      case 'wake-up': {
        const c = this.sleepSlot !== null ? g.creatures[this.sleepSlot] : null;
        this.sleepSlot = null;
        if (!c?.alive) return;
        c.react('surprised', 0.4);
        c.wiggle(0.8, 0.08, 2);
        g.hopInPlace(c, 0.25);
        this.say('sayYawn', c, 1600);
        return;
      }
      case 'friend': {
        const c = this.petTarget ?? main;
        if (!c) return;
        c.react('happy', 1.5);
        this.fx.heart(c.x, c.centerY + c.size * 1.1);
        this.fx.sound('sparkle');
        this.say('sayFriend', c, 1800);
        return;
      }
      case 'welcome-back': {
        if (!main || main.motion !== 'free') return;
        main.react('happy', 1.2);
        g.hopInPlace(main, 0.35);
        this.say('sayBack', main, 1500);
        this.fx.sound('hello');
        return;
      }
    }
  }

  /** A dozing Squishy keeps its eyes shut, sinks into a relaxed shape and sways a little. */
  private animateSleep(): void {
    const slot = this.memory.sleepingSlot;
    if (this.mode !== 'free' || slot === null) return;
    const c = this.game.creatures[slot];
    if (!c.alive || c.motion !== 'free') return;
    c.baseExpression = 'sleepy';
    c.relax = 1;
    c.nextIdleAt = c.clock + 2;
    c.lean.target = Math.sin(this.time * 1.2) * (this.reduced ? 0.02 : 0.05);
  }

  private greet(input: GameInput): void {
    const g = this.game;
    let c: CreatureModel | null = null;
    let best = Infinity;
    for (const o of g.alive) {
      const d = Math.hypot(o.x - input.x, o.centerY - input.y);
      if (o.motion === 'free' && d < best) {
        best = d;
        c = o;
      }
    }
    if (!c) return;
    this.greeted = true;
    lookToward(c, input.x, input.y, 0.8);
    c.react('happy', 1.1);
    g.hopInPlace(c, 0.3);
    this.say('sayHi', c, 1300);
    this.fx.sound('hello');
  }

  private resetVisitor(): void {
    this.greeted = false;
    this.visitorT = 0;
    this.visitorPinched = false;
    this.tipsShown.clear();
    this.tipUntil = 0;
    this.nextTipAt = 0;
    this.did = { pet: false, split: false, merge: false };
  }

  // ---------------------------------------------------------------- petting and secrets

  /** The resting creature whose petting zone this hand is in (closest first). */
  private petZoneAt(input: GameInput): { target: CreatureModel; zone: PetZone } | null {
    let found: { target: CreatureModel; zone: PetZone } | null = null;
    let best = Infinity;
    for (const c of this.game.alive) {
      if (c.motion !== 'free') continue;
      const z = { cx: c.x, cy: c.centerY, size: c.size };
      const d = Math.abs(input.x - c.x);
      if (this.pet.inZone(input.x, input.y, z) && d < best) {
        best = d;
        found = { target: c, zone: z };
      }
    }
    return found;
  }

  private updatePetting(dt: number, inputs: readonly GameInput[]): void {
    const g = this.game;
    // Paused during that hand's pinches, while that hand holds anything, during scripted
    // sequences and during mini-games.
    const eligible = (p: number) => {
      const i = inputs[p];
      return !!i && i.present && !i.pinching && g.isFree(p);
    };
    let player = -1;
    if (this.mode === 'free' && !g.busy) {
      // Stay with the hand that is petting; otherwise the first open hand above a Squishy.
      if (this.pet.active && eligible(this.petPlayer)) player = this.petPlayer;
      for (let p = 0; p < inputs.length && player < 0; p++) if (eligible(p) && this.petZoneAt(inputs[p])) player = p;
      for (let p = 0; p < inputs.length && player < 0; p++) if (eligible(p)) player = p;
    }
    if (player >= 0 && player !== this.petPlayer) {
      this.pet.reset();
      this.petPlayer = player;
    }
    const input = player >= 0 ? inputs[player] : null;
    const can = input !== null;
    let target: CreatureModel | null = null;
    let zone: PetZone | null = null;
    if (input) {
      const hit = this.petZoneAt(input);
      target = hit?.target ?? null;
      zone = hit?.zone ?? null;
      if (!zone && this.pet.active) {
        // Keep the current target while the hand briefly leaves the zone.
        const c = this.petTarget;
        if (c?.alive) zone = { cx: c.x, cy: c.centerY, size: c.size };
        target = c;
      }
    }
    const petting = this.pet.update(dt, can ? input : null, zone);
    if (petting && target) {
      this.petTarget = target;
      if (!this.wasPetting) {
        this.did.pet = true;
        this.fx.sound('purr');
      }
      // Leans into the hand, closes its eyes and relaxes.
      target.baseExpression = 'content';
      if (input) target.lean.target = -clamp((input.x - target.x) / (target.size * 1.6), -1, 1) * 0.2 * (this.reduced ? 0.5 : 1);
      target.relax = Math.min(1, target.relax + dt * 2.5);
      target.nextIdleAt = target.clock + 2;
      // Long petting makes Squishy fond of the visitor, then sleepy.
      this.memory.pet(dt, target.slot);
      if (this.secrets.checkHeart(this.pet.petSeconds)) {
        this.fx.heart(target.x, target.centerY + target.size * 1.1);
        this.fx.sound('sparkle');
      }
    }
    for (const c of g.alive) if (!(petting && c === target)) c.relax = Math.max(0, c.relax - dt * 2);
    if (!petting) this.petTarget = null;
    this.wasPetting = petting;
  }

  private petTarget: CreatureModel | null = null;

  private dizzy(c: CreatureModel): void {
    c.react('dizzy', 2.2);
    c.wiggle(2, 0.12, 1.2);
    this.say('sayWhoa', c, 1600);
    this.fx.sound('dizzy');
  }

  private giggle(c: CreatureModel): void {
    c.react('happy', 1.2);
    c.shiver = 0.04;
    this.say('sayHeehee', c, 1200);
    this.fx.sound('giggle');
  }

  // ---------------------------------------------------------------- rounds

  private makeGame(id: GameId): MiniGame {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const ctx: MiniGameContext = {
      game: this.game,
      fx: this.fx,
      rng: this.rng,
      say: (key, c, ms) => this.say(key, c ?? mainCreature(this.game), ms),
      after: (ms, fn) => this.sched.after(ms, fn),
      get reduced() {
        return self.reduced;
      },
    };
    switch (id) {
      case 'says':
        return new SquishySays(ctx);
      case 'snack':
        return new SnackSurprise(ctx);
      case 'bounce':
        return new BubbleBounce(ctx);
    }
  }

  private celebrate(): void {
    const id = this.current?.id;
    if (id) this.rounds[id]++;
    this.setMode('celebrate');
    this.coach = 'celebrate';
    this.removeUi(this.stopBubble);
    this.stopBubble = null;
    const c = mainCreature(this.game);
    this.fx.sound('cheer');
    if (c) {
      this.say('sayYay', c, 1600);
      c.react('happy', 2);
      this.game.hopInPlace(c, 0.5);
      this.sched.after(800, () => this.game.hopInPlace(c, 0.35));
      this.fx.burst(c.x, c.centerY + c.size, 'star', '#ffd34d');
    }
  }

  private offerChoice(): void {
    // The finished game's bubbles drift away; the game's locks are released.
    this.releaseGame();
    this.setMode('between');
    this.coach = 'between';
    this.nextBubble = this.addUi('next', INVITE_COLOR, GAME_TITLE[this.nextGame], CONFIG.playground.playBubbleRadii);
    this.nextBubble.attention = true;
    this.nextBubble.glowTarget = 0.5;
    this.homeBubble = this.addUi('home', HOME_COLOR, 'freePlay', CONFIG.playground.playBubbleRadii);
    this.layout(this.game.bounds);
  }

  private press(b: Bubble): void {
    b.press();
    this.fx.sound('select');
    if (b === this.inviteBubble || b === this.nextBubble) {
      this.startGame(this.nextGame);
    } else if (b === this.minisBubble) {
      if (this.game.startSplit()) {
        this.fx.sound('pop');
        b.leave();
        this.minisBubble = null;
      }
    } else if (b === this.homeBubble || b === this.stopBubble) {
      this.backToFree();
    } else if (this.mode === 'play') {
      this.current?.pressBubble?.(b);
    }
  }

  private bubbleAt(input: GameInput): Bubble | null {
    const cutoff = (input.recent.at(-1)?.t ?? 0) - CONFIG.hit.pinchHistoryMs;
    const points = [input, ...input.recent.filter((p) => p.t >= cutoff)];
    const minHit = this.game.bounds.minHitRadius;
    let best: Bubble | null = null;
    let bestD = 1;
    for (const b of this.bubbles) {
      if (!b.pinchable) continue;
      const d = b.hit(points, CONFIG.playground.bubbleHitScale, minHit);
      if (d <= bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** The pinchable bubble under the cursor (cursor feedback). */
  hover(input: GameInput): Bubble | null {
    if (!input.present || !this.game.calm) return null;
    return this.bubbleAt({ ...input, recent: [] });
  }

  private say(key: TextKey, c: CreatureModel | null, ms = 1200): void {
    if (!c) return;
    this.speech = { key, slot: c.slot, until: this.time + ms / 1000 };
  }

  private setMode(mode: PlayMode): void {
    this.mode = mode;
    this.modeT = 0;
  }

  private addUi(symbol: Bubble['symbol'], color: string, label: TextKey, radii: number): Bubble {
    const R = this.game.bounds.mainRadius;
    const b = new Bubble(0, 0, radii * R, symbol, color, 'ui', label);
    this.uiBubbles.push(b);
    return b;
  }

  private removeUi(b: Bubble | null): void {
    b?.leave();
  }

  private removeFreeBubbles(): void {
    this.removeUi(this.inviteBubble);
    this.removeUi(this.minisBubble);
    this.inviteBubble = this.minisBubble = null;
  }

  /** Drop the mini-game and restore the sandbox rules (all grabs allowed, dodging back on). */
  private releaseGame(): void {
    // Hand the game's bubbles over so they can finish popping or drifting away on screen.
    if (this.current) {
      for (const b of this.current.bubbles) {
        if (!b.popping) b.leave();
        this.uiBubbles.push(b);
      }
    }
    this.current = null;
    this.game.allow = { creatures: true, food: true };
    this.game.dodgeEnabled = true;
    for (const c of this.game.creatures) if (c.lookHeld) c.holdLook(0, 0, 0);
  }

  private endRound(): void {
    this.sched.cancel();
    this.releaseGame();
    for (const b of [this.stopBubble, this.nextBubble, this.homeBubble]) this.removeUi(b);
    this.stopBubble = this.nextBubble = this.homeBubble = null;
    if (this.mode !== 'free') this.coach = null;
    this.mode = 'free';
    this.modeT = 0;
  }
}
