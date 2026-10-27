export type PromptKind = 'waiting' | 'unavailable' | 'show-hand' | 'pinch' | 'none';

const INSTRUCTION = 'Pinch to grab. Move. Let go.';

const PROMPTS: Record<Exclude<PromptKind, 'none'>, { title: string; sub: string; demo: boolean }> = {
  waiting: { title: INSTRUCTION, sub: 'Hand tracking is starting soon.', demo: true },
  unavailable: { title: INSTRUCTION, sub: 'Hand tracking is paused right now.', demo: false },
  'show-hand': { title: 'Show one hand to the camera.', sub: INSTRUCTION, demo: true },
  pinch: { title: INSTRUCTION, sub: '', demo: true },
};

/** Cursor appearance: over something grabbable, holding something, or holding food over a mouth. */
export type CursorMode = 'idle' | 'over' | 'holding' | 'feed';

/** Visitor-facing instructions, hints and the hand cursor. Contains no operator controls. */
export class VisitorOverlay {
  private prompt = el('prompt');
  private title = this.prompt.querySelector('.prompt-title') as HTMLElement;
  private sub = this.prompt.querySelector('.prompt-sub') as HTMLElement;
  private hint = el('hint');
  private touchHint = el('touch-hint');
  private cursor = el('cursor');
  private badge = el('mode-badge');
  private snack = el('snack-hint');
  private snackVisible = false;
  private current: PromptKind | null = null;
  private currentHint: string | null = null;
  private touchTimer: number | undefined;
  private catchTimer: number | undefined;
  private cursorState = { visible: false, over: false, pinching: false, feed: false };

  setPrompt(kind: PromptKind): void {
    if (kind === this.current) return;
    this.current = kind;
    if (kind === 'none') {
      this.prompt.classList.add('is-hidden');
      return;
    }
    const p = PROMPTS[kind];
    this.title.textContent = p.title;
    this.sub.textContent = p.sub;
    this.prompt.classList.toggle('show-demo', p.demo);
    this.prompt.classList.remove('is-hidden');
  }

  setHint(text: string | null): void {
    if (text === this.currentHint) return;
    this.currentHint = text;
    if (text) this.hint.textContent = text;
    this.hint.classList.toggle('is-visible', !!text);
  }

  /** Shown when someone touches a touchscreen: the experience is touch-free. */
  showTouchHint(): void {
    this.touchHint.classList.add('is-visible');
    window.clearTimeout(this.touchTimer);
    this.touchTimer = window.setTimeout(() => this.touchHint.classList.remove('is-visible'), 3500);
  }

  setMouseBadge(visible: boolean): void {
    this.badge.hidden = !visible;
  }

  setCursor(visible: boolean, x: number, y: number, mode: CursorMode, pinching: boolean): void {
    const s = this.cursorState;
    const over = mode !== 'idle';
    const feed = mode === 'feed';
    if (visible) this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (s.visible !== visible) this.cursor.classList.toggle('is-hidden', !visible);
    if (s.over !== over) this.cursor.classList.toggle('is-over', over);
    if (s.pinching !== pinching) this.cursor.classList.toggle('is-pinching', pinching);
    if (s.feed !== feed) this.cursor.classList.toggle('is-feed', feed);
    s.visible = visible;
    s.over = over;
    s.pinching = pinching;
    s.feed = feed;
  }

  /** "Try giving me a snack." above the food tray, at CSS pixel position (x, y). */
  setSnackHint(visible: boolean, x = 0, y = 0): void {
    if (visible) this.snack.style.transform = `translate(-50%, -100%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    if (visible !== this.snackVisible) this.snack.classList.toggle('is-visible', visible);
    this.snackVisible = visible;
  }

  pulseCatch(): void {
    this.cursor.classList.remove('is-catch');
    void this.cursor.offsetWidth; // restart the animation
    this.cursor.classList.add('is-catch');
    window.clearTimeout(this.catchTimer);
    this.catchTimer = window.setTimeout(() => this.cursor.classList.remove('is-catch'), 500);
  }

  dispose(): void {
    window.clearTimeout(this.touchTimer);
    window.clearTimeout(this.catchTimer);
  }
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e;
}
