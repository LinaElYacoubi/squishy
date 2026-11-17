import { STRINGS, type Language, type TextKey, type VisitorStrings } from './i18n';

/** 'coach' shows one playground instruction (Free Play tip or mini-game step) in the same place. */
export type PromptKind = 'waiting' | 'unavailable' | 'show-hand' | 'pinch' | 'coach' | 'none';

/** A text label under a bubble, at CSS pixel position (x, y). */
export interface BubbleLabel {
  key: TextKey;
  x: number;
  y: number;
  /** The big invitation style. */
  primary: boolean;
}
export type HintKind = 'lost';

function promptText(
  kind: Exclude<PromptKind, 'none'>,
  t: VisitorStrings,
  coach: TextKey | null,
): { title: string; sub: string; demo: boolean } {
  switch (kind) {
    case 'coach':
      return { title: coach ? t[coach] : '', sub: '', demo: false };
    case 'waiting':
      return { title: t.instruction, sub: t.waitingSub, demo: true };
    case 'unavailable':
      return { title: t.instruction, sub: t.unavailableSub, demo: false };
    case 'show-hand':
      return { title: t.welcome, sub: t.instruction, demo: true };
    case 'pinch':
      // The pinch demonstration is for passers-by; it stops as soon as someone is playing.
      return { title: t.instruction, sub: '', demo: false };
  }
}

/** Cursor appearance: over something grabbable, holding something, or holding food over a mouth. */
export type CursorMode = 'idle' | 'over' | 'holding' | 'feed';

/** Visitor-facing instructions, hints and the hand cursor. Contains no operator controls. */
export class VisitorOverlay {
  private prompt = el('prompt');
  private title = this.prompt.querySelector('.prompt-title') as HTMLElement;
  private sub = this.prompt.querySelector('.prompt-sub') as HTMLElement;
  private demo = this.prompt.querySelector('.pinch-demo') as HTMLElement;
  private demoCaption = this.prompt.querySelector('.pinch-demo figcaption') as HTMLElement;
  private hint = el('hint');
  private touchHint = el('touch-hint');
  private privacy = el('privacy-note');
  /** One cursor per player (index = player). */
  private cursors = [el('cursor'), el('cursor-2')];
  private badge = el('mode-badge');
  private snack = el('snack-hint');
  private snackVisible = false;
  private speech = el('speech');
  private speechKey: TextKey | null = null;
  private labelRoot = el('bubble-labels');
  private labels: { el: HTMLElement; key: TextKey | null; primary: boolean; width: number; height: number }[] = [];
  private coachKey: TextKey | null = null;
  private current: PromptKind | null = null;
  private currentHint: HintKind | null = null;
  private lang: Language = 'en';
  private touchTimer: number | undefined;
  private catchTimers: (number | undefined)[] = this.cursors.map(() => undefined);
  private cursorStates = this.cursors.map(() => ({ visible: false, over: false, pinching: false, feed: false }));

  get language(): Language {
    return this.lang;
  }

  /** Switch every visitor-facing text immediately, including whatever is on screen right now. */
  setLanguage(lang: Language): void {
    this.lang = lang;
    const t = STRINGS[lang];
    document.documentElement.lang = lang;
    this.demo.setAttribute('aria-label', t.demoLabel);
    this.demoCaption.textContent = t.demoCaption;
    this.snack.textContent = t.snackHint;
    this.touchHint.textContent = t.touchHint;
    this.privacy.textContent = t.privacy;
    if (this.current && this.current !== 'none') this.renderPrompt(this.current);
    if (this.currentHint) this.hint.textContent = t.lostHint;
    if (this.speechKey) this.speech.textContent = t[this.speechKey];
    for (const l of this.labels) {
      if (!l.key) continue;
      l.el.textContent = t[l.key];
      l.width = l.el.offsetWidth; // French text is often longer: re-measure for clamping.
      l.height = l.el.offsetHeight;
    }
  }

  /** Show a prompt. For 'coach', `coach` is the instruction to show. */
  setPrompt(kind: PromptKind, coach: TextKey | null = null): void {
    if (kind === 'coach' && coach !== this.coachKey) {
      this.coachKey = coach;
      if (this.current === 'coach') {
        this.renderPrompt('coach');
        this.prompt.classList.remove('is-hidden');
        // A soft nudge when the instruction changes (skipped with reduced motion by CSS).
        this.prompt.classList.remove('is-new');
        void this.prompt.offsetWidth;
        this.prompt.classList.add('is-new');
        return;
      }
    }
    if (kind === this.current) return;
    this.current = kind;
    if (kind === 'none') {
      this.prompt.classList.add('is-hidden');
      return;
    }
    this.renderPrompt(kind);
    this.prompt.classList.remove('is-hidden');
  }

  /** Marks the prompt while Squishy is greeting, for a gentle highlight. */
  setGreeting(on: boolean): void {
    this.prompt.classList.toggle('is-greeting', on);
  }

  setHint(kind: HintKind | null): void {
    if (kind === this.currentHint) return;
    this.currentHint = kind;
    if (kind) this.hint.textContent = STRINGS[this.lang].lostHint;
    this.hint.classList.toggle('is-visible', !!kind);
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

  setCursor(player: number, visible: boolean, x: number, y: number, mode: CursorMode, pinching: boolean): void {
    const cursor = this.cursors[player];
    const s = this.cursorStates[player];
    if (!cursor || !s) return;
    const over = mode !== 'idle';
    const feed = mode === 'feed';
    if (visible) cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (s.visible !== visible) cursor.classList.toggle('is-hidden', !visible);
    if (s.over !== over) cursor.classList.toggle('is-over', over);
    if (s.pinching !== pinching) cursor.classList.toggle('is-pinching', pinching);
    if (s.feed !== feed) cursor.classList.toggle('is-feed', feed);
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

  /** Squishy's speech bubble above its head at CSS pixel (x, y), or hidden. */
  setSpeech(key: TextKey | null, x = 0, y = 0): void {
    if (key) {
      this.speech.style.transform = `translate(-50%, -100%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
      if (key !== this.speechKey) this.speech.textContent = STRINGS[this.lang][key];
    }
    if (!!key !== !!this.speechKey) this.speech.classList.toggle('is-visible', !!key);
    this.speechKey = key;
  }

  /**
   * Labels under the button bubbles (Play with me, Mini me, Next game, Free play, Stop). Each
   * label is kept inside `safe` (CSS pixels): longer French text near an edge shifts inward.
   */
  setBubbleLabels(list: readonly BubbleLabel[], safe?: { x: number; y: number; width: number; height: number }): void {
    while (this.labels.length < list.length) {
      const e = document.createElement('p');
      e.className = 'bubble-label';
      this.labelRoot.appendChild(e);
      this.labels.push({ el: e, key: null, primary: false, width: 0, height: 0 });
    }
    this.labels.forEach((l, i) => {
      const item = list[i];
      if (!item) {
        if (l.key) {
          l.el.hidden = true;
          l.key = null;
        }
        return;
      }
      let changed = false;
      if (l.key !== item.key) {
        l.el.textContent = STRINGS[this.lang][item.key];
        l.key = item.key;
        l.el.hidden = false;
        changed = true;
      }
      if (l.primary !== item.primary) {
        l.el.classList.toggle('is-primary', item.primary);
        changed = true;
      }
      l.primary = item.primary;
      // Measure only when the text or style changes (no layout read every frame).
      if (changed || l.width === 0) {
        l.width = l.el.offsetWidth;
        l.height = l.el.offsetHeight;
      }
      let x = item.x;
      let y = item.y;
      if (safe) {
        const half = l.width / 2;
        x = Math.min(Math.max(x, safe.x + half), safe.x + safe.width - half);
        y = Math.min(y, safe.y + safe.height - l.height);
      }
      l.el.style.transform = `translate(${(x - l.width / 2).toFixed(0)}px, ${y.toFixed(0)}px)`;
    });
  }

  /** Catch feedback on one player's cursor (player 1 if unknown). */
  pulseCatch(player = 0): void {
    const i = player >= 0 && player < this.cursors.length ? player : 0;
    const cursor = this.cursors[i];
    cursor.classList.remove('is-catch');
    void cursor.offsetWidth; // restart the animation
    cursor.classList.add('is-catch');
    window.clearTimeout(this.catchTimers[i]);
    this.catchTimers[i] = window.setTimeout(() => cursor.classList.remove('is-catch'), 500);
  }

  dispose(): void {
    window.clearTimeout(this.touchTimer);
    for (const t of this.catchTimers) window.clearTimeout(t);
  }

  private renderPrompt(kind: Exclude<PromptKind, 'none'>): void {
    const p = promptText(kind, STRINGS[this.lang], this.coachKey);
    this.title.textContent = p.title;
    this.sub.textContent = p.sub;
    this.prompt.classList.toggle('show-demo', p.demo);
  }
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id}`);
  return e;
}
