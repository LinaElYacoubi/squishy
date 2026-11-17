import type { SoundState } from '../audio/sound';
import { LANGUAGES, STRINGS, isLanguage, type Language } from './i18n';

export interface VisitorControlActions {
  setLanguage: (lang: Language) => void;
  /** Called from a click or key press, so it may unlock audio. */
  toggleSound: () => void;
}

/**
 * Small EN / FR and sound buttons for visitors. Clicks here never reach the game: the app
 * ignores pointer events inside `.visitor-controls` in mouse test mode.
 */
export class VisitorControls {
  private root: HTMLElement;
  private langButtons = new Map<Language, HTMLButtonElement>();
  private soundBtn: HTMLButtonElement;
  private soundLabel: HTMLElement;
  private langGroup: HTMLElement;
  private lang: Language = 'en';
  private sound: SoundState = 'off';
  private abort = new AbortController();

  constructor(private actions: VisitorControlActions) {
    const root = document.getElementById('visitor-controls');
    if (!root) throw new Error('Missing #visitor-controls');
    this.root = root;
    this.langGroup = root.querySelector('.lang-switch') as HTMLElement;
    this.soundBtn = root.querySelector('.sound-toggle') as HTMLButtonElement;
    this.soundLabel = this.soundBtn.querySelector('.sound-label') as HTMLElement;
    for (const lang of LANGUAGES) {
      this.langButtons.set(lang, root.querySelector(`[data-lang="${lang}"]`) as HTMLButtonElement);
    }

    const opts = { signal: this.abort.signal };
    root.addEventListener(
      'click',
      (e) => {
        const btn = e.target instanceof Element ? e.target.closest('button') : null;
        if (!btn) return;
        const lang = btn.getAttribute('data-lang');
        if (isLanguage(lang)) {
          if (lang !== this.lang) this.actions.setLanguage(lang);
        } else if (btn === this.soundBtn) {
          this.actions.toggleSound();
        }
      },
      opts,
    );
  }

  setLanguage(lang: Language): void {
    this.lang = lang;
    for (const [l, btn] of this.langButtons) btn.setAttribute('aria-pressed', String(l === lang));
    this.langGroup.setAttribute('aria-label', STRINGS[lang].languageGroup);
    this.renderSound();
  }

  setSoundState(state: SoundState): void {
    this.sound = state;
    this.renderSound();
  }

  dispose(): void {
    this.abort.abort();
  }

  private renderSound(): void {
    const t = STRINGS[this.lang];
    const label =
      this.sound === 'on' ? t.soundOn : this.sound === 'locked' ? t.soundLocked : this.sound === 'unavailable' ? t.soundUnavailable : t.soundOff;
    const on = this.sound !== 'off';
    this.soundLabel.textContent = label;
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.title = on ? t.soundTitleOn : t.soundTitleOff;
    this.root.dataset.sound = this.sound;
  }
}
