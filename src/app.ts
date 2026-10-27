import { CONFIG } from './config';
import { CreatureAssets } from './creature/assets';
import { FoodLayer } from './creature/foodView';
import { JellyView } from './creature/jellyView';
import { ActivityMonitor } from './game/activity';
import { Game, type GameInput } from './game/game';
import { HandPipeline } from './input/handPipeline';
import { ERROR_MESSAGES, HandTracker, TrackerError } from './input/handTracker';
import { InputHub, type InputSnapshot, type InputSource } from './input/inputHub';
import type { Point3 } from './input/pinch';
import { Stage } from './scene/stage';
import { loadSettings, sanitizeMargins, saveSettings, type OperatorSettings } from './settings';
import { OperatorPanel, type CameraStatus } from './ui/operatorPanel';
import { drawSetupPreview } from './ui/setupPreview';
import { VisitorOverlay, type CursorMode } from './ui/visitorOverlay';

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
  readonly hub = new InputHub(CONFIG.hit.historyMs);
  private pipeline = new HandPipeline(this.hub);
  private tracker: HandTracker;
  private activity = new ActivityMonitor();
  private overlay = new VisitorOverlay();
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

  constructor(root: HTMLElement) {
    this.settings = loadSettings();
    const stageEl = root.querySelector('#stage') as HTMLElement;
    this.stage = new Stage(stageEl, this.settings.margins);
    this.stage.setDisplayMode(this.settings.displayMode);

    this.assets = new CreatureAssets();
    this.game = new Game(this.stage.bounds);
    this.game.startWithMinis = this.settings.startWithMinis;
    this.game.reset();
    this.views = [0, 1, 2, 3].map((i) => new JellyView(this.assets, i, this.stage.scene));
    this.foodLayer = new FoodLayer(this.stage.scene);
    this.game.events = {
      onGrab: (kind) => {
        this.overlay.pulseCatch();
        if (kind === 'food') this.snackDone = true;
      },
      onFeed: () => this.overlay.pulseCatch(),
    };

    this.tracker = new HandTracker();
    this.tracker.onHands = (hands, t, aspect) => {
      this.lastHands = hands;
      if (this.source === 'hand') this.pipeline.process(hands, t, aspect);
    };
    this.tracker.onCameraEnded = () => this.setCameraError(ERROR_MESSAGES.unavailable);
    this.pipeline.mapper.mirror = this.settings.mirror;

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
        this.game.setBounds(this.stage.bounds);
        this.updateSafeFrame();
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
      (window as unknown as { __jelly: unknown }).__jelly = { app: this, game: this.game, hub: this.hub };
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
    this.panel.dispose();
    this.overlay.dispose();
    for (const v of this.views) v.dispose();
    this.foodLayer.dispose();
    this.assets.dispose();
    this.stage.dispose();
  }

  /** Operator Reset: back to the inviting idle state from any state. Creates no loops or listeners. */
  resetExperience(): void {
    this.game.reset();
    this.hub.reset();
    this.pipeline.reset();
    this.activity.reset();
    this.resetGuidance();
    this.wasPresent = false;
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

    const snap = this.hub.take(t);
    const act = this.activity.update(t, snap);
    if (act.timedOut) this.handleInactivity();

    const p = this.stage.safeToWorld(snap.u, snap.v);
    const input: GameInput = {
      present: snap.present,
      active: act.active,
      x: p.x,
      y: p.y,
      pinching: snap.pinching,
      pinchStart: snap.pinchStart,
      acquired: snap.acquired,
      recent: snap.history.map((s) => ({ ...this.stage.safeToWorld(s.u, s.v), t: s.t })),
    };
    this.game.update(dt, input);

    const b = this.stage.bounds;
    const shadows = this.stage.mode === 'desktop';
    this.game.creatures.forEach((c, i) => this.views[i].update(c, this.game.time, dt, b.floorY, shadows));
    this.foodLayer.update(this.game.foods, b, this.game.time);

    const px = this.stage.safeToPixel(snap.u, snap.v);
    this.overlay.setCursor(snap.present, px.x, px.y, this.cursorMode(input), snap.pinching);
    this.updatePrompts(dt, t, snap, act.active);

    this.stage.render();
    this.updateDiagnostics(now);
  };

  private cursorMode(input: GameInput): CursorMode {
    if (this.game.heldFood) return this.game.feedTarget ? 'feed' : 'holding';
    if (this.game.grabbed) return 'holding';
    return this.game.hover(input) === 'none' ? 'idle' : 'over';
  }

  private updatePrompts(dt: number, t: number, snap: InputSnapshot, active: boolean): void {
    this.updateSnackHint(t, snap.present);
    if (snap.present) {
      this.wasPresent = true;
      this.lostAt = null;
      if (active) this.interactMs += dt * 1000;
      if (snap.pinchStart || this.interactMs > CONFIG.ui.instructionFadeAfterMs) this.instructionsDone = true;
      this.overlay.setHint(null);
      this.overlay.setPrompt(this.instructionsDone ? 'none' : 'pinch');
      return;
    }

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
      this.overlay.setHint('Show your hand again');
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
      this.pipeline.selected,
      this.pipeline.mapper.mirror,
      this.pipeline.mapper.region,
      this.pipeline.debug.pinching,
    );
    if (now - this.debugTextAt > 200) {
      this.debugTextAt = now;
      const d = this.pipeline.debug;
      this.panel.setDebugText(
        [
          `state: ${this.game.phase}   input: ${this.source}`,
          `hands seen: ${d.hands}   tracking: ${d.tracking ? 'yes' : 'no'}`,
          `pinch ratio: ${d.ratio === null ? '-' : d.ratio.toFixed(2)}  (pinch < ${CONFIG.pinch.pinchThreshold}, release > ${CONFIG.pinch.releaseThreshold})`,
          `pinching: ${d.pinching ? 'yes' : 'no'}   armed: ${d.armed ? 'yes' : 'no'}`,
          `inference: ${this.tracker.inferenceRate.toFixed(0)} Hz (${this.tracker.backendKind})   render: ${this.fps.toFixed(0)} fps`,
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
    this.hub.reset();
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
    this.game.setReducedMotion(reduced);
    document.documentElement.classList.toggle('reduced-motion', reduced);
  }

  private handleResize(): void {
    this.stage.resize();
    this.game.setBounds(this.stage.bounds);
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
  }

  private bindEvents(): void {
    const opts = { signal: this.abort.signal };

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.stop();
          this.tracker.setPaused(true);
          // Coming back must not resume a half-finished pinch: reacquire with an open hand.
          this.hub.reset();
          this.pipeline.reset();
        } else {
          this.tracker.setPaused(false);
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
    const insidePanel = (e: Event) =>
      e.target instanceof Element && !!e.target.closest('.op-panel, .op-toggle');
    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.source !== 'mouse' || e.pointerType === 'touch') return;
        const s = this.stage.pixelToSafe(e.clientX, e.clientY);
        this.hub.setPresent(true);
        this.hub.move(s.u, s.v, performance.now());
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
        this.hub.setPresent(true);
        this.hub.move(s.u, s.v, performance.now());
        this.hub.setPinching(true);
        this.hub.pinchStart();
      },
      opts,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (this.source === 'mouse' && e.pointerType !== 'touch') this.hub.setPinching(false);
      },
      opts,
    );
    document.documentElement.addEventListener(
      'mouseleave',
      () => {
        if (this.source === 'mouse') this.hub.setPresent(false);
      },
      opts,
    );
  }
}
