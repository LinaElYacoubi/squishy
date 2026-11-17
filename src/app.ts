import { SoundFx } from './audio/sound';
import { CONFIG } from './config';
import { CreatureAssets } from './creature/assets';
import { FoodLayer } from './creature/foodView';
import { JellyView } from './creature/jellyView';
import { ActivityMonitor } from './game/activity';
import { Game, MAX_PLAYERS, type GameInput } from './game/game';
import { IdleGreeting, REST_POSE } from './game/idleGreeting';
import { BODY_BOTTOM } from './game/creatureModel';
import { Playground } from './game/playground/playground';
import type { GameId } from './game/playground/types';
import { EffectsLayer } from './scene/effectsLayer';
import { HandPipeline } from './input/handPipeline';
import { ERROR_MESSAGES, HandTracker, TrackerError } from './input/handTracker';
import { InputHub, type InputSnapshot, type InputSource } from './input/inputHub';
import type { Point3 } from './input/pinch';
import { Stage } from './scene/stage';
import { loadSettings, sanitizeMargins, saveSettings, type OperatorSettings } from './settings';
import { OperatorPanel, type CameraStatus } from './ui/operatorPanel';
import type { Language } from './ui/i18n';
import { drawSetupPreview } from './ui/setupPreview';
import { VisitorControls } from './ui/visitorControls';
import { VisitorOverlay, type BubbleLabel, type CursorMode } from './ui/visitorOverlay';

/**
 * Wires everything together: one render loop (requestAnimationFrame), one independently
 * paced inference loop (inside HandTracker), shared input state, gameplay and UI.
 */
export class App {
  private stage: Stage;
  private assets: CreatureAssets;
  private views: JellyView[];
  private foodLayer: FoodLayer;
  readonly game: Game;
  /** Squishy's Playground: Free Play extras and the Play Together mini-games. */
  readonly playground: Playground;
  private effects: EffectsLayer;
  /** One input hub per player (index = player). */
  readonly hubs: InputHub[] = Array.from({ length: MAX_PLAYERS }, () => new InputHub(CONFIG.hit.historyMs));
  private pipeline = new HandPipeline(this.hubs);
  private tracker: HandTracker;
  private activity = this.hubs.map(() => new ActivityMonitor());
  /** Mouse test mode: the hub the mouse button is pinching (Shift = player 2). */
  private mouseHub: InputHub | null = null;
  private overlay = new VisitorOverlay();
  private controls: VisitorControls;
  private sound: SoundFx;
  private greeting = new IdleGreeting();
  private reduced = false;
  private panel: OperatorPanel;
  private settings: OperatorSettings;
  private source: InputSource = 'hand';
  private showPreview = false;
  private cameraState: CameraStatus['state'] = 'off';
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;
  private reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private safeFrame = document.getElementById('safe-frame') as HTMLElement;
  private lastHands: Point3[][] = [];

  private raf: number | null = null;
  private lastFrame = 0;
  /** Diagnostics: how many times a render loop was started (should only grow on tab switches). */
  loopStarts = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsStart = 0;
  private debugTextAt = 0;

  // Visitor prompt state.
  private instructionsDone = false;
  private interactMs = 0;
  private wasPresent = false;
  private lostAt: number | null = null;
  /** "Try giving me a snack." is shown once per visitor session, until food is picked up. */
  private snackStart: number | null = null;
  private snackDone = false;
  private snackVisible = false;
  /** Inactivity elapsed, but a round is in progress with someone there: reset once it is safe. */
  private resetPending = false;

  constructor(root: HTMLElement) {
    this.settings = loadSettings();
    const stageEl = root.querySelector('#stage') as HTMLElement;
    this.stage = new Stage(stageEl, this.settings.margins);
    this.stage.setDisplayMode(this.settings.displayMode);

    this.assets = new CreatureAssets();
    this.assets.setHologram(this.settings.displayMode === 'hologram');
    this.game = new Game(this.stage.bounds);
    this.game.startWithMinis = this.settings.startWithMinis;
    this.game.reset();
    this.views = [0, 1, 2, 3].map((i) => new JellyView(this.assets, i, this.stage.scene));
    this.foodLayer = new FoodLayer(this.stage.scene);
    this.foodLayer.setHologram(this.settings.displayMode === 'hologram');
    this.sound = new SoundFx(this.settings.sound);
    this.effects = new EffectsLayer(this.stage.scene);
    this.effects.setHologram(this.settings.displayMode === 'hologram');
    this.playground = new Playground(this.game);
    const pg = this.playground;
    pg.fx = {
      sound: (name, strength, pitch) => void this.sound.play(name, strength, pitch),
      burst: (x, y, kind, color, count) => this.effects.burst(x, y, kind, color, count),
      heart: (x, y) => this.effects.heart(x, y),
    };
    this.game.events = {
      onGrab: (kind, player) => {
        this.overlay.pulseCatch(player);
        if (kind === 'food') this.snackDone = true;
        this.sound.play('grab');
      },
      onRelease: (kind, c) => {
        // A lost hand is not a visitor action: stay quiet.
        if (kind === 'drop') this.sound.play('drop');
        else if (kind === 'throw') this.sound.play('throw');
        if (c) pg.onRelease(kind, c);
      },
      onBounce: (strength) => this.sound.play('bounce', 0.35 + 0.65 * strength),
      onOffer: (f, c) => pg.onOffer(f, c),
      onFeed: (f, c) => {
        this.overlay.pulseCatch(this.game.feedTargets.findIndex((t) => t === c));
        this.sound.play('feed');
        if (f && c) pg.onFeed(f, c);
      },
      onLand: (c, launch) => pg.onLand(c, launch),
      onMerge: (survivor, absorbed) => {
        this.sound.play('merge');
        if (survivor && absorbed) pg.onMerge(survivor, absorbed);
      },
      onSplit: () => pg.onSplit(),
      beforeAnimate: (dt) => pg.animate(dt),
    };

    this.controls = new VisitorControls({
      setLanguage: (lang) => this.setLanguage(lang),
      toggleSound: () => this.toggleSound(),
    });
    this.sound.onStateChange = (state) => this.controls.setSoundState(state);
    this.controls.setSoundState(this.sound.state);
    this.setLanguage(this.settings.language, false);

    this.tracker = new HandTracker();
    this.tracker.onHands = (hands, t, aspect) => {
      this.lastHands = hands;
      if (this.source === 'hand') this.pipeline.process(hands, t, aspect);
    };
    this.tracker.onCameraEnded = () => this.setCameraError(ERROR_MESSAGES.unavailable);
    this.pipeline.mapper.mirror = this.settings.mirror;
    this.pipeline.setPlayerCount(this.settings.twoPlayers ? MAX_PLAYERS : 1);

    this.panel = new OperatorPanel(root, {
      enableCamera: () => void this.startCamera(this.settings.cameraId ?? undefined),
      disableCamera: () => this.stopCamera(),
      selectCamera: (id) => {
        this.settings.cameraId = id;
        saveSettings(this.settings);
        void this.startCamera(id);
      },
      fullscreen: () => void this.toggleFullscreen(),
      reset: () => this.resetExperience(),
      setDisplayMode: (mode) => {
        this.settings.displayMode = mode;
        this.stage.setDisplayMode(mode);
        this.assets.setHologram(mode === 'hologram');
        this.foodLayer.setHologram(mode === 'hologram');
        this.effects.setHologram(mode === 'hologram');
        this.applyBounds();
        saveSettings(this.settings);
      },
      setMirror: (mirror) => {
        this.settings.mirror = mirror;
        this.pipeline.mapper.mirror = mirror;
        this.pipeline.reset();
        saveSettings(this.settings);
      },
      setReducedMotion: (value) => {
        this.settings.reducedMotion = value;
        this.applyReducedMotion();
        saveSettings(this.settings);
      },
      setMargins: (m) => {
        this.settings.margins = sanitizeMargins(m);
        this.stage.setMargins(this.settings.margins);
        this.applyBounds();
        saveSettings(this.settings);
      },
      setPreview: (show) => (this.showPreview = show),
      setMouseMode: (on) => this.setMouseMode(on),
      splitDemo: () => {
        if (!this.game.startSplit()) {
          this.panel.showMessage('Split works when exactly one Squishy is resting and nothing is being held. Press Reset first if needed.');
        }
      },
      setStartWithMinis: (on) => {
        this.settings.startWithMinis = on;
        this.game.startWithMinis = on;
        saveSettings(this.settings);
        this.resetExperience();
      },
      startGame: (id: GameId) => this.playground.startGame(id),
      setTwoPlayers: (on) => {
        this.settings.twoPlayers = on;
        this.pipeline.setPlayerCount(on ? MAX_PLAYERS : 1);
        for (let p = 1; p < this.hubs.length; p++) if (!on) this.hubs[p].reset();
        saveSettings(this.settings);
      },
    });
    this.panel.setValues(this.settings, false, false);
    this.panel.onToggle = () => this.updateSafeFrame();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(stageEl);

    this.applyReducedMotion();
    this.bindEvents();

    const unsupported = HandTracker.checkSupport();
    if (unsupported) this.setCameraError(unsupported.message);
    else this.setCameraStatus({ state: 'off' });
    // Start with the panel open so the operator can enable the camera.
    this.panel.setOpen(true);

    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as { __jelly: unknown }).__jelly = {
        app: this,
        game: this.game,
        hub: this.hubs[0],
        hubs: this.hubs,
        playground: this.playground,
        stage: this.stage,
      };
    }
  }

  start(): void {
    if (this.raf !== null || document.hidden) return;
    this.lastFrame = performance.now();
    this.loopStarts++;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  get isRunning(): boolean {
    return this.raf !== null;
  }

  dispose(): void {
    this.stop();
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.tracker.dispose();
    this.sound.dispose();
    this.panel.dispose();
    this.controls.dispose();
    this.overlay.dispose();
    for (const v of this.views) v.dispose();
    this.foodLayer.dispose();
    this.effects.dispose();
    this.assets.dispose();
    this.stage.dispose();
  }

  /** Operator Reset: back to the inviting idle state from any state. Creates no loops or listeners. */
  resetExperience(): void {
    this.playground.reset();
    this.playground.memory.reset();
    this.game.reset();
    for (const h of this.hubs) h.reset();
    this.pipeline.reset();
    for (const a of this.activity) a.reset();
    this.greeting.reset();
    this.resetGuidance();
    this.wasPresent = false;
    this.resetPending = false;
  }

  // ---------------------------------------------------------------- language and sound

  /** Switch visitor text immediately; the game and camera keep running. */
  setLanguage(lang: Language, save = true): void {
    this.settings.language = lang;
    this.overlay.setLanguage(lang);
    this.controls.setLanguage(lang);
    if (save) saveSettings(this.settings);
  }

  /** Only called from a click or key press, which is what allows the browser to start audio. */
  private toggleSound(): void {
    // Sound is on but still waiting for a user action: this click starts it rather than muting.
    if (this.sound.state === 'locked') {
      this.sound.unlock();
      return;
    }
    const on = !this.sound.isEnabled;
    this.settings.sound = on;
    this.sound.setEnabled(on, true);
    saveSettings(this.settings);
  }

  /** Show the instructions and snack hint again, as for a new visitor. */
  private resetGuidance(): void {
    this.instructionsDone = false;
    this.interactMs = 0;
    this.lostAt = null;
    this.snackStart = null;
    this.snackDone = false;
  }

  // ---------------------------------------------------------------- frame loop

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const maxFps = CONFIG.render.maxFps;
    if (maxFps > 0 && now - this.lastFrame < 1000 / maxFps - 2) return;
    const dt = Math.min(Math.max(0, (now - this.lastFrame) / 1000), CONFIG.render.maxDeltaSeconds);
    this.lastFrame = now;
    const t = performance.now();

    const snaps = this.hubs.map((h) => h.take(t));
    const acts = snaps.map((s, i) => this.activity[i].update(t, s));
    // Reset only once every player has been inactive for the full delay.
    const allIdle = acts.every((a) => a.idleMs >= CONFIG.activity.inactivityMs);
    if (acts.some((a) => a.timedOut) && allIdle) this.resetPending = true;
    if (!allIdle) this.resetPending = false;
    const anyPresent = snaps.some((s) => s.present);
    // Never reset in the middle of a round while someone is there (watching Squishy Says, say).
    if (this.resetPending && !(this.playground.inRound && anyPresent)) {
      this.resetPending = false;
      this.handleInactivity();
    }

    const inputs: GameInput[] = snaps.map((snap, i) => {
      const p = this.stage.safeToWorld(snap.u, snap.v);
      return {
        present: snap.present,
        active: acts[i].active,
        x: p.x,
        y: p.y,
        pinching: snap.pinching,
        pinchStart: snap.pinchStart,
        acquired: snap.acquired,
        recent: snap.history.map((s) => ({ ...this.stage.safeToWorld(s.u, s.v), t: s.t })),
      };
    });
    // Pinches on playground bubbles are consumed here, so they never also grab Squishy.
    const gameInputs = this.playground.preUpdate(dt, inputs);
    this.game.update(dt, gameInputs);
    this.updateGreeting(dt, anyPresent);

    const b = this.stage.bounds;
    const shadows = this.stage.mode === 'desktop';
    this.game.creatures.forEach((c, i) => this.views[i].update(c, this.game.time, dt, b.floorY, shadows));
    this.foodLayer.update(this.game.foods, b, this.game.time);
    this.effects.update(dt, this.playground.bubbles, this.game.creatures, b, this.game.time);
    this.updatePlaygroundUi();

    snaps.forEach((snap, i) => {
      const px = this.stage.safeToPixel(snap.u, snap.v);
      this.overlay.setCursor(i, snap.present, px.x, px.y, this.cursorMode(inputs[i], i), snap.pinching);
    });
    // Prompts treat everyone as one audience: someone is here, someone pinched.
    const primary = snaps.find((s) => s.present) ?? snaps[0];
    const together: InputSnapshot = { ...primary, present: anyPresent, pinchStart: snaps.some((s) => s.pinchStart) };
    this.updatePrompts(dt, t, together, acts.some((a) => a.active));

    this.stage.render();
    this.updateDiagnostics(now);
  };

  /**
   * Idle greeting: visual only, silent, and stopped the same frame a hand appears. It is applied
   * after the game update and never changes positions, sizes or hit areas.
   */
  private updateGreeting(dt: number, present: boolean): void {
    this.greeting.update(dt * 1000, present);
    this.game.creatures.forEach((c, i) => {
      const calm = c.alive && c.motion === 'free' && !c.isHopping && !c.chewing;
      c.greet = calm ? this.greeting.pose(this.reduced, i * 180) : REST_POSE;
    });
    this.overlay.setGreeting(this.greeting.greeting);
  }

  private cursorMode(input: GameInput, player: number): CursorMode {
    const g = this.game;
    if (g.heldFoodBy(player)) return g.feedTargets[player] ? 'feed' : 'holding';
    if (g.grabbedBy(player)) return 'holding';
    if (this.playground.hover(input)) return 'over';
    return g.hover(input, player) === 'none' ? 'idle' : 'over';
  }

  /** Bubble labels and Squishy's speech bubble, placed over the 3D scene and kept inside the safe area. */
  private updatePlaygroundUi(): void {
    const labels: BubbleLabel[] = [];
    for (const bub of this.playground.bubbles) {
      if (!bub.label || bub.leaving || bub.popping || bub.scale.value < 0.5) continue;
      const p = this.stage.worldToPixel(bub.x, bub.y - bub.drawRadius * 1.04);
      labels.push({ key: bub.label, x: p.x, y: p.y, primary: bub.attention });
    }
    this.overlay.setBubbleLabels(labels, this.stage.safeRect);

    const sp = this.playground.speech;
    const c = sp ? this.game.creatures[sp.slot] : null;
    if (sp && c?.alive) {
      const top = c.y + 2 * BODY_BOTTOM * c.size * c.deform().d + c.size * 0.3;
      const p = this.stage.worldToPixel(c.x, top);
      const r = this.stage.safeRect;
      const x = Math.min(Math.max(p.x, r.x + r.width * 0.15), r.x + r.width * 0.85);
      const y = Math.min(Math.max(p.y, r.y + r.height * 0.18), r.y + r.height);
      this.overlay.setSpeech(sp.key, x, y);
    } else {
      this.overlay.setSpeech(null);
    }
  }

  private updatePrompts(dt: number, t: number, snap: InputSnapshot, active: boolean): void {
    const pg = this.playground;
    // One instruction at a time: the snack hint waits while a playground instruction is up.
    this.updateSnackHint(t, snap.present && pg.mode === 'free' && !pg.coach);
    if (snap.present) {
      this.wasPresent = true;
      this.lostAt = null;
      if (active) this.interactMs += dt * 1000;
      if (snap.pinchStart || this.interactMs > CONFIG.ui.instructionFadeAfterMs || pg.inRound) this.instructionsDone = true;
      this.overlay.setHint(null);
      if (!this.instructionsDone) this.overlay.setPrompt('pinch');
      else if (pg.coach) this.overlay.setPrompt('coach', pg.coach);
      else this.overlay.setPrompt('none');
      pg.hintsBlocked = !this.instructionsDone || this.snackVisible;
      return;
    }
    pg.hintsBlocked = true;

    if (this.wasPresent) {
      this.wasPresent = false;
      this.lostAt = t;
    }
    if (this.source === 'hand' && this.cameraState !== 'on') {
      this.overlay.setHint(null);
      this.overlay.setPrompt(this.cameraState === 'error' ? 'unavailable' : 'waiting');
      return;
    }
    if (this.lostAt !== null && t - this.lostAt < CONFIG.activity.lostPromptMs) {
      this.overlay.setPrompt('none');
      this.overlay.setHint('lost');
      return;
    }
    // Gone for a while: probably a new visitor next time, so show the full instructions again.
    this.resetGuidance();
    this.overlay.setHint(null);
    this.overlay.setPrompt('show-hand');
  }

  /** Briefly suggest feeding, after the main instruction has faded, until food is picked up. */
  private updateSnackHint(t: number, present: boolean): void {
    let show = false;
    if (present && this.instructionsDone && !this.snackDone) {
      this.snackStart ??= t + CONFIG.ui.snackHintDelayMs;
      if (t >= this.snackStart + CONFIG.ui.snackHintMs) this.snackDone = true;
      else show = t >= this.snackStart && this.game.foods.some((f) => f.state === 'tray');
    }
    this.snackVisible = show;
    if (!show) {
      this.overlay.setSnackHint(false);
      return;
    }
    const b = this.stage.bounds;
    const p = this.stage.worldToPixel(b.trayX, b.trayY + b.foodRadius * 1.6);
    this.overlay.setSnackHint(true, p.x, p.y);
  }

  /** No meaningful activity for a while: restore the default arrangement for the next visitor. */
  private handleInactivity(): void {
    this.playground.reset();
    this.game.reset(true);
    this.pipeline.reset();
    this.resetGuidance();
  }

  private updateDiagnostics(now: number): void {
    this.fpsFrames++;
    if (now - this.fpsStart > 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsStart);
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
    if (!this.showPreview || !this.panel.isOpen) return;
    drawSetupPreview(
      this.panel.previewCanvas,
      this.tracker.running ? this.tracker.video : null,
      this.lastHands,
      this.pipeline.selectedAll,
      this.pipeline.mapper.mirror,
      this.pipeline.mapper.region,
      this.pipeline.debug.pinching,
    );
    if (now - this.debugTextAt > 200) {
      this.debugTextAt = now;
      const d = this.pipeline.debug;
      this.panel.setDebugText(
        [
          `state: ${this.game.phase}   input: ${this.source}   playground: ${this.playground.mode}${this.playground.current ? ` (${this.playground.current.id})` : ''}`,
          `hands seen: ${d.hands}   tracking: ${d.tracking ? 'yes' : 'no'}   players: ${d.players}/${this.pipeline.selector.activeSlots}`,
          `pinch ratio: ${d.ratio === null ? '-' : d.ratio.toFixed(2)}  (pinch < ${CONFIG.pinch.pinchThreshold}, release > ${CONFIG.pinch.releaseThreshold})`,
          `pinching: ${d.pinching ? 'yes' : 'no'}   armed: ${d.armed ? 'yes' : 'no'}`,
          `inference: ${this.tracker.inferenceRate.toFixed(0)} Hz (${this.tracker.backendKind})   render: ${this.fps.toFixed(0)} fps`,
          this.playground.memory.describe(),
          this.outputLine(),
        ].join('\n'),
      );
    }
  }

  // ---------------------------------------------------------------- camera

  private async startCamera(deviceId?: string): Promise<void> {
    this.setCameraStatus({ state: 'starting' });
    this.pipeline.reset();
    try {
      try {
        await this.tracker.start(deviceId);
      } catch (err) {
        // A remembered camera may have been unplugged; fall back to the default one.
        if (deviceId && err instanceof TrackerError && err.kind === 'unavailable') await this.tracker.start();
        else throw err;
      }
    } catch (err) {
      const message = err instanceof TrackerError ? err.message : ERROR_MESSAGES.unknown;
      if (!(err instanceof TrackerError)) console.error(err);
      this.setCameraError(message);
      return;
    }
    if (!this.tracker.running) return; // superseded by another start or a stop
    this.settings.cameraId = this.tracker.deviceId ?? null;
    saveSettings(this.settings);
    this.setCameraStatus({ state: 'on', label: this.tracker.label });
    await this.refreshCameraList();
  }

  private stopCamera(): void {
    this.tracker.stop();
    this.pipeline.reset();
    this.lastHands = [];
    this.setCameraStatus({ state: 'off' });
  }

  private async refreshCameraList(): Promise<void> {
    try {
      const cams = await this.tracker.listCameras();
      this.panel.setCameras(cams, this.tracker.deviceId);
    } catch {
      // Listing is optional.
    }
  }

  private setCameraError(message: string): void {
    this.pipeline.reset();
    this.setCameraStatus({ state: 'error', message });
    this.panel.setOpen(true);
  }

  private setCameraStatus(status: CameraStatus): void {
    this.cameraState = status.state;
    this.panel.setCameraStatus(status);
  }

  // ---------------------------------------------------------------- operator helpers

  private setMouseMode(on: boolean): void {
    this.source = on ? 'mouse' : 'hand';
    for (const h of this.hubs) h.reset();
    this.mouseHub = null;
    this.pipeline.reset();
    this.overlay.setMouseBadge(on);
  }

  private async toggleFullscreen(): Promise<void> {
    const el = document.documentElement;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled && el.requestFullscreen) await el.requestFullscreen();
      else this.panel.showMessage('Fullscreen is not available in this browser. Use the browser or kiosk settings instead.');
    } catch {
      this.panel.showMessage('Fullscreen was refused by the browser. Try again, or use F11.');
    }
  }

  private applyReducedMotion(): void {
    const s = this.settings.reducedMotion;
    const reduced = s === 'on' || (s === 'auto' && this.reducedMotionQuery.matches);
    this.reduced = reduced;
    this.game.setReducedMotion(reduced);
    this.effects.setReducedMotion(reduced);
    document.documentElement.classList.toggle('reduced-motion', reduced);
  }

  /** Rendered frame size, with a warning when hologram mode is not producing portrait UHD. */
  private outputLine(): string {
    const { width, height } = this.stage.renderSize;
    const line = `output: ${width} x ${height} px`;
    if (this.stage.mode !== 'hologram') return line;
    const h = CONFIG.hologram;
    if (width === h.width && height === h.height) return `${line} (UHD portrait)`;
    return `${line} (expected ${h.width} x ${h.height}: make the window fullscreen on the portrait display)`;
  }

  private handleResize(): void {
    this.stage.resize();
    this.applyBounds();
  }

  /** New stage size or margins: creatures, food and bubbles all move back inside the safe area. */
  private applyBounds(): void {
    this.game.setBounds(this.stage.bounds);
    this.playground.layout(this.stage.bounds);
    this.updateSafeFrame();
  }

  private updateSafeFrame(): void {
    const r = this.stage.safeRect;
    Object.assign(this.safeFrame.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    // Visitor buttons sit just inside the safe area.
    const root = document.documentElement;
    root.style.setProperty('--safe-right', `${Math.max(0, window.innerWidth - (r.x + r.width))}px`);
    root.style.setProperty('--safe-bottom', `${Math.max(0, window.innerHeight - (r.y + r.height))}px`);
    // Portrait: the tray is bottom-centre and would sit under the buttons. Raise them just above it.
    const b = this.stage.bounds;
    const portrait = r.height > r.width * 1.15;
    const trayTop = this.stage.worldToPixel(b.trayX, b.trayY + b.foodRadius * 1.6).y;
    root.style.setProperty('--controls-bottom', `${Math.max(0, window.innerHeight - trayTop + 8)}px`);
    document.getElementById('visitor-controls')?.classList.toggle('is-raised', portrait);
  }

  private bindEvents(): void {
    const opts = { signal: this.abort.signal };

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.stop();
          this.sound.setHidden(true);
          this.tracker.setPaused(true);
          // Coming back must not resume a half-finished pinch: reacquire with an open hand.
          for (const h of this.hubs) h.reset();
          this.mouseHub = null;
          this.pipeline.reset();
        } else {
          this.tracker.setPaused(false);
          this.sound.setHidden(false);
          this.start();
        }
      },
      opts,
    );

    this.reducedMotionQuery.addEventListener('change', () => this.applyReducedMotion(), opts);
    navigator.mediaDevices?.addEventListener?.(
      'devicechange',
      () => {
        if (this.tracker.running) void this.refreshCameraList();
      },
      opts,
    );

    // Pointer input: mouse test mode only. Touches are never used as input.
    // Holding Shift moves player 2's cursor instead (two players on), to test playing together.
    const insidePanel = (e: Event) =>
      e.target instanceof Element && !!e.target.closest('.op-panel, .op-toggle, .visitor-controls');
    const hubFor = (e: PointerEvent) =>
      this.mouseHub ?? (e.shiftKey && this.settings.twoPlayers && this.hubs.length > 1 ? this.hubs[1] : this.hubs[0]);
    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.source !== 'mouse' || e.pointerType === 'touch') return;
        const s = this.stage.pixelToSafe(e.clientX, e.clientY);
        const hub = hubFor(e);
        hub.setPresent(true);
        hub.move(s.u, s.v, performance.now());
      },
      opts,
    );
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          if (!insidePanel(e)) this.overlay.showTouchHint();
          return;
        }
        if (this.source !== 'mouse' || insidePanel(e) || e.button !== 0) return;
        const s = this.stage.pixelToSafe(e.clientX, e.clientY);
        const hub = hubFor(e);
        // The same player keeps the pinch until the button is released, even if Shift changes.
        this.mouseHub = hub;
        hub.setPresent(true);
        hub.move(s.u, s.v, performance.now());
        hub.setPinching(true);
        hub.pinchStart();
      },
      opts,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (this.source !== 'mouse' || e.pointerType === 'touch') return;
        this.mouseHub?.setPinching(false);
        this.mouseHub = null;
      },
      opts,
    );
    // Sound was left on by a previous session: the first click or key press anywhere starts it
    // (browsers block audio until then; webcam gestures do not count).
    const unlockOnce = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.visitor-controls')) return; // the button handles it
      if (this.sound.state === 'locked') this.sound.unlock();
    };
    window.addEventListener('pointerdown', unlockOnce, opts);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        if (e.key === 'm' || e.key === 'M') {
          if (e.repeat) return;
          this.toggleSound();
        } else {
          unlockOnce(e);
        }
      },
      opts,
    );

    document.documentElement.addEventListener(
      'mouseleave',
      () => {
        if (this.source === 'mouse') for (const h of this.hubs) h.setPresent(false);
      },
      opts,
    );
  }
}
