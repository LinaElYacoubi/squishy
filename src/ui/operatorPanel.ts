import type { SafeMargins } from '../config';
import type { DisplayMode } from '../scene/stage';
import type { OperatorSettings, ReducedMotionSetting } from '../settings';

export interface OperatorActions {
  enableCamera(): void;
  disableCamera(): void;
  selectCamera(deviceId: string): void;
  fullscreen(): void;
  reset(): void;
  setDisplayMode(mode: DisplayMode): void;
  setMirror(mirror: boolean): void;
  setReducedMotion(value: ReducedMotionSetting): void;
  setMargins(margins: SafeMargins): void;
  setPreview(show: boolean): void;
  setMouseMode(on: boolean): void;
  splitDemo(): void;
  setStartWithMinis(on: boolean): void;
}

export type CameraStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'on'; label: string }
  | { state: 'error'; message: string };

export const PRIVACY_TEXT =
  'Your camera is used for hand tracking. Video is processed in this browser and is not recorded or uploaded by this app.';

const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const;

const TEMPLATE = `
  <div class="op-row" style="justify-content:space-between">
    <h2 id="op-title">Operator setup</h2>
    <button type="button" data-id="close" aria-label="Close operator panel">Close</button>
  </div>

  <h3>Camera</h3>
  <p class="op-status" data-id="status" role="status"></p>
  <div class="op-row">
    <button type="button" class="primary" data-id="enable">Enable camera</button>
    <button type="button" data-id="retry" hidden>Retry</button>
    <button type="button" data-id="disable">Disable camera</button>
  </div>
  <div class="op-row">
    <label for="op-camera" class="op-small">Camera</label>
    <select id="op-camera" data-id="camera" disabled><option>Available after permission</option></select>
  </div>
  <p class="op-privacy">${PRIVACY_TEXT}</p>
  <p class="op-small">The hand tracking model and runtime load from this app's own files. No camera frames,
  images or landmarks leave this browser.</p>

  <h3>Display</h3>
  <div class="op-row">
    <button type="button" data-id="fullscreen">Fullscreen</button>
    <button type="button" data-id="reset">Reset</button>
  </div>
  <div class="op-row">
    <label for="op-display" class="op-small">Mode</label>
    <select id="op-display" data-id="display">
      <option value="desktop">Desktop preview (dark scene, shadow)</option>
      <option value="black">Black background (no floor)</option>
    </select>
  </div>
  <label class="check"><input type="checkbox" data-id="mirror" /> Mirror tracking (natural for visitors facing the camera)</label>
  <div class="op-row">
    <label for="op-motion" class="op-small">Reduced motion</label>
    <select id="op-motion" data-id="motion">
      <option value="auto">Follow system setting</option>
      <option value="on">On (gentler, less dodging)</option>
      <option value="off">Off</option>
    </select>
  </div>
  <p class="op-small" data-id="message" role="status"></p>

  <h3>Demonstration</h3>
  <div class="op-row">
    <button type="button" data-id="split">Split demo (one Squishy into three)</button>
  </div>
  <label class="check"><input type="checkbox" data-id="minis" /> Start with three small Squishies (to test merging)</label>

  <h3>Safe margins</h3>
  <div class="op-margins" data-id="margins"></div>

  <h3>Setup and testing</h3>
  <label class="check"><input type="checkbox" data-id="preview" /> Show setup preview (camera and landmarks)</label>
  <canvas class="op-preview" data-id="canvas" width="320" height="240" hidden></canvas>
  <p class="op-debug" data-id="debug" hidden></p>
  <label class="check"><input type="checkbox" data-id="mouse" /> Mouse test mode (click = pinch)</label>
  <p class="op-small">Press O to show or hide this panel.</p>
`;

const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>`;

/** Small collapsible operator panel, kept out of the visitor experience. */
export class OperatorPanel {
  readonly previewCanvas: HTMLCanvasElement;
  private toggleBtn: HTMLButtonElement;
  private panel: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private marginInputs = new Map<keyof SafeMargins, { input: HTMLInputElement; out: HTMLOutputElement }>();
  private messageTimer: number | undefined;
  private abort = new AbortController();
  onToggle: (open: boolean) => void = () => {};

  constructor(
    host: HTMLElement,
    private actions: OperatorActions,
  ) {
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'op-toggle';
    this.toggleBtn.setAttribute('aria-label', 'Operator settings');
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.toggleBtn.innerHTML = GEAR_SVG;

    this.panel = document.createElement('aside');
    this.panel.className = 'op-panel';
    this.panel.setAttribute('aria-labelledby', 'op-title');
    this.panel.hidden = true;
    this.panel.innerHTML = TEMPLATE;
    this.panel.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.els[e.dataset.id!] = e));
    this.previewCanvas = this.els.canvas as HTMLCanvasElement;

    const marginsHost = this.els.margins;
    for (const side of MARGIN_SIDES) {
      const label = document.createElement('label');
      label.textContent = side[0].toUpperCase() + side.slice(1);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '30';
      input.step = '1';
      input.id = `op-margin-${side}`;
      label.htmlFor = input.id;
      const out = document.createElement('output');
      marginsHost.append(label, input, out);
      this.marginInputs.set(side, { input, out });
    }

    host.append(this.toggleBtn, this.panel);
    this.bind();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggleBtn.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('operator-open', open);
    this.onToggle(open);
  }

  setValues(s: OperatorSettings, mouseMode: boolean, preview: boolean): void {
    (this.els.display as HTMLSelectElement).value = s.displayMode;
    (this.els.mirror as HTMLInputElement).checked = s.mirror;
    (this.els.motion as HTMLSelectElement).value = s.reducedMotion;
    (this.els.mouse as HTMLInputElement).checked = mouseMode;
    (this.els.minis as HTMLInputElement).checked = s.startWithMinis;
    (this.els.preview as HTMLInputElement).checked = preview;
    this.els.canvas.hidden = !preview;
    this.els.debug.hidden = !preview;
    for (const side of MARGIN_SIDES) {
      const { input, out } = this.marginInputs.get(side)!;
      input.value = String(Math.round(s.margins[side] * 100));
      out.value = `${input.value}%`;
    }
  }

  setCameraStatus(status: CameraStatus): void {
    const statusEl = this.els.status;
    const enable = this.els.enable as HTMLButtonElement;
    const disable = this.els.disable as HTMLButtonElement;
    const retry = this.els.retry as HTMLButtonElement;
    statusEl.classList.toggle('is-error', status.state === 'error');
    switch (status.state) {
      case 'off':
        statusEl.textContent = 'Camera is off. Press "Enable camera" to ask for permission.';
        break;
      case 'starting':
        statusEl.textContent = 'Starting camera and loading the hand tracking model...';
        break;
      case 'on':
        statusEl.textContent = `Camera on: ${status.label}`;
        break;
      case 'error':
        statusEl.textContent = status.message;
        break;
    }
    enable.hidden = status.state === 'error';
    enable.disabled = status.state === 'starting' || status.state === 'on';
    disable.disabled = status.state === 'off';
    retry.hidden = status.state !== 'error';
  }

  setCameras(devices: MediaDeviceInfo[], selectedId: string | undefined): void {
    const select = this.els.camera as HTMLSelectElement;
    select.replaceChildren();
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      select.append(opt);
    });
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'Available after permission';
      select.append(opt);
    }
    if (selectedId) select.value = selectedId;
    select.disabled = devices.length < 2;
  }

  showMessage(text: string): void {
    this.els.message.textContent = text;
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => (this.els.message.textContent = ''), 6000);
  }

  setDebugText(text: string): void {
    if (!this.els.debug.hidden) this.els.debug.textContent = text;
  }

  dispose(): void {
    this.abort.abort();
    window.clearTimeout(this.messageTimer);
    this.toggleBtn.remove();
    this.panel.remove();
    document.documentElement.classList.remove('operator-open');
  }

  private bind(): void {
    const opts = { signal: this.abort.signal };
    const a = this.actions;
    const on = (id: string, type: string, fn: (e: Event) => void) => this.els[id].addEventListener(type, fn, opts);

    this.toggleBtn.addEventListener('click', () => this.setOpen(!this.isOpen), opts);
    on('close', 'click', () => this.setOpen(false));
    on('enable', 'click', () => a.enableCamera());
    on('retry', 'click', () => a.enableCamera());
    on('disable', 'click', () => a.disableCamera());
    on('camera', 'change', (e) => a.selectCamera((e.target as HTMLSelectElement).value));
    on('fullscreen', 'click', () => a.fullscreen());
    on('reset', 'click', () => a.reset());
    on('display', 'change', (e) => a.setDisplayMode((e.target as HTMLSelectElement).value as DisplayMode));
    on('mirror', 'change', (e) => a.setMirror((e.target as HTMLInputElement).checked));
    on('motion', 'change', (e) => a.setReducedMotion((e.target as HTMLSelectElement).value as ReducedMotionSetting));
    on('preview', 'change', (e) => {
      const show = (e.target as HTMLInputElement).checked;
      this.els.canvas.hidden = !show;
      this.els.debug.hidden = !show;
      a.setPreview(show);
    });
    on('mouse', 'change', (e) => a.setMouseMode((e.target as HTMLInputElement).checked));
    on('split', 'click', () => a.splitDemo());
    on('minis', 'change', (e) => a.setStartWithMinis((e.target as HTMLInputElement).checked));

    for (const { input, out } of this.marginInputs.values()) {
      input.addEventListener(
        'input',
        () => {
          out.value = `${input.value}%`;
          const m = {} as SafeMargins;
          for (const side of MARGIN_SIDES) m[side] = Number(this.marginInputs.get(side)!.input.value) / 100;
          a.setMargins(m);
        },
        opts,
      );
    }

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'o' && e.key !== 'O') return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        this.setOpen(!this.isOpen);
      },
      opts,
    );
  }
}
