/**
 * Focused checks for language persistence, sound muting and the idle greeting.
 * No browser: storage and Web Audio are replaced by small fakes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SoundFx } from '../src/audio/sound';
import { CONFIG } from '../src/config';
import { Game, NO_INPUT, type GameInput } from '../src/game/game';
import { IdleGreeting, REST_POSE } from '../src/game/idleGreeting';
import { defaultSettings, loadSettings, saveSettings } from '../src/settings';
import { LANGUAGES, STRINGS } from '../src/ui/i18n';
import { BOUNDS } from './helpers';

// ---------------------------------------------------------------- fakes

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  cancelScheduledValues() {},
});

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = param();
  onended: (() => void) | null = null;
  stopped = false;
  constructor(ctx: FakeAudioContext) {
    super();
    ctx.oscillators.push(this);
  }
  start() {}
  stop() {
    this.stopped = true;
  }
  /** Simulate the browser finishing the tone. */
  end() {
    this.onended?.();
  }
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOsc[] = [];
  closed = false;
  onstatechange: (() => void) | null = null;
  createOscillator() {
    return new FakeOsc(this);
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: param() });
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
    this.closed = true;
  }
}

function makeSound(enabled = false) {
  const created: FakeAudioContext[] = [];
  let clock = 0;
  const fx = new SoundFx(
    enabled,
    () => {
      const c = new FakeAudioContext();
      created.push(c);
      return c as unknown as AudioContext;
    },
    () => clock,
  );
  return {
    fx,
    created,
    advance(ms: number) {
      clock += ms;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- language

describe('language preference', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  beforeEach(() => {
    g.localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete g.localStorage;
  });

  it('defaults to English and starts muted', () => {
    const s = loadSettings('');
    expect(s.language).toBe('en');
    expect(s.sound).toBe(false);
  });

  it('remembers French across reloads, alongside other settings', () => {
    const s = defaultSettings();
    s.language = 'fr';
    s.displayMode = 'hologram';
    saveSettings(s);
    const loaded = loadSettings('');
    expect(loaded.language).toBe('fr');
    expect(loaded.displayMode).toBe('hologram');
  });

  it('ignores an invalid saved language', () => {
    (g.localStorage as MemoryStorage).setItem(
      'jelly-catch.operator.v1',
      JSON.stringify({ language: 'de', sound: 'yes' }),
    );
    const s = loadSettings('');
    expect(s.language).toBe('en');
    expect(s.sound).toBe(false);
  });

  it('can be forced with ?lang=fr', () => {
    expect(loadSettings('?lang=fr').language).toBe('fr');
    expect(loadSettings('?lang=xx').language).toBe('en');
  });

  it('remembers the sound preference', () => {
    const s = defaultSettings();
    s.sound = true;
    saveSettings(s);
    expect(loadSettings('').sound).toBe(true);
  });

  it('every visitor string is translated', () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value, `${lang}.${key}`).toMatch(/\S/);
      }
    }
    expect(Object.keys(STRINGS.fr).sort()).toEqual(Object.keys(STRINGS.en).sort());
    expect(STRINGS.en.welcome).toBe('Hi, I’m Squishy! Show one hand to play.');
    expect(STRINGS.fr.welcome.replace(/ /g, ' ')).toBe('Salut, moi c’est Squishy ! Montre une main pour jouer.');
  });
});

// ---------------------------------------------------------------- sound

describe('sound effects', () => {
  it('start muted and never create an audio context until turned on by a user action', () => {
    const { fx, created } = makeSound();
    expect(fx.state).toBe('off');
    fx.unlock();
    expect(fx.play('grab')).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('a saved "on" preference waits for a click or key press (locked)', () => {
    const { fx, created } = makeSound(true);
    expect(fx.state).toBe('locked');
    expect(fx.play('grab')).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('play after unlocking, and muting stops every sound at once', async () => {
    const { fx, created, advance } = makeSound();
    fx.setEnabled(true, true);
    await flush();
    expect(fx.state).toBe('on');
    expect(fx.play('merge')).toBe(true);
    advance(500);
    expect(fx.play('grab')).toBe(true);
    expect(fx.activeVoices).toBe(4);

    fx.setEnabled(false, true);
    await flush();
    expect(fx.state).toBe('off');
    expect(fx.activeVoices).toBe(0);
    expect(created[0].oscillators.every((o) => o.stopped)).toBe(true);
    expect(created[0].state).toBe('suspended');
    advance(500);
    expect(fx.play('grab')).toBe(false);
  });

  it('limits repeated bounces so a bouncing Squishy is not noisy', async () => {
    const { fx, created, advance } = makeSound();
    fx.setEnabled(true, true);
    await flush();
    let played = 0;
    // 40 bounces in two seconds, finishing each tone as the browser would.
    for (let i = 0; i < 40; i++) {
      if (fx.play('bounce', 1)) played++;
      created[0].oscillators.forEach((o) => o.end());
      advance(50);
    }
    expect(played).toBeLessThanOrEqual(CONFIG.sound.bouncesPerSecond * 2);
    expect(played).toBeGreaterThan(0);
    // Very soft impacts are silent.
    advance(2000);
    expect(fx.play('bounce', 0.01)).toBe(false);
  });

  it('caps overlapping voices', async () => {
    const { fx, advance } = makeSound();
    fx.setEnabled(true, true);
    await flush();
    const names = ['merge', 'feed', 'throw', 'grab', 'drop'] as const;
    for (const n of names) {
      fx.play(n);
      advance(1);
    }
    expect(fx.activeVoices).toBeLessThanOrEqual(CONFIG.sound.maxVoices);
  });

  it('goes silent while the page is hidden and resumes afterwards', async () => {
    const { fx, advance } = makeSound();
    fx.setEnabled(true, true);
    await flush();
    fx.play('grab');
    fx.setHidden(true);
    await flush();
    expect(fx.activeVoices).toBe(0);
    advance(500);
    expect(fx.play('grab')).toBe(false);
    fx.setHidden(false);
    await flush();
    expect(fx.play('grab')).toBe(true);
  });

  it('keeps working without Web Audio, and dispose closes the context', async () => {
    const broken = new SoundFx(false, () => {
      throw new Error('no audio');
    });
    broken.setEnabled(true, true);
    expect(broken.state).toBe('unavailable');
    expect(broken.play('grab')).toBe(false);
    broken.dispose();

    const { fx, created } = makeSound();
    fx.setEnabled(true, true);
    await flush();
    fx.play('feed');
    fx.dispose();
    expect(created[0].closed).toBe(true);
    expect(fx.activeVoices).toBe(0);
  });

  it('the game reports bounces from throws, but not from resting idle hops', () => {
    const g = new Game(BOUNDS, () => 0.5);
    const bounces: number[] = [];
    g.events.onBounce = (s) => bounces.push(s);
    for (let i = 0; i < 600; i++) g.update(1 / 60, NO_INPUT);
    expect(bounces).toHaveLength(0);

    const c = g.creatures[0];
    c.motion = 'airborne';
    c.y = BOUNDS.floorY + 2;
    c.vy = -BOUNDS.mainRadius * 10;
    for (let i = 0; i < 120; i++) g.update(1 / 60, NO_INPUT);
    expect(bounces.length).toBeGreaterThan(0);
    expect(bounces.every((s) => s > 0 && s <= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------- idle greeting

describe('idle greeting', () => {
  const timing = { delayMs: 4000, greetMs: 2600, pauseMs: 7000 };
  const step = (g: IdleGreeting, ms: number, present: boolean) => {
    for (let t = 0; t < ms; t += 16) g.update(16, present);
  };

  it('starts only after no hand has been seen for a few seconds', () => {
    const g = new IdleGreeting(timing);
    step(g, 3800, false);
    expect(g.greeting).toBe(false);
    expect(g.pose(false)).toBe(REST_POSE);
    step(g, 400, false);
    expect(g.greeting).toBe(true);
  });

  it('alternates a short greeting with quiet pauses', () => {
    const g = new IdleGreeting(timing);
    step(g, timing.delayMs + 100, false);
    expect(g.greeting).toBe(true);
    step(g, timing.greetMs, false);
    expect(g.idle).toBe(true);
    expect(g.greeting).toBe(false);
    expect(g.pose(false)).toBe(REST_POSE);
    step(g, timing.pauseMs, false);
    expect(g.greeting).toBe(true);
  });

  it('stops the very frame a hand appears', () => {
    const g = new IdleGreeting(timing);
    step(g, timing.delayMs + timing.greetMs * 0.5, false);
    expect(g.pose(false).expression).not.toBeNull();
    g.update(16, true);
    expect(g.greeting).toBe(false);
    expect(g.idle).toBe(false);
    expect(g.pose(false)).toBe(REST_POSE);
    // And it waits the full delay again before greeting the next time.
    step(g, timing.delayMs - 200, false);
    expect(g.greeting).toBe(false);
  });

  it('plays a curious look, a wiggle and a happy face, smaller with reduced motion', () => {
    const g = new IdleGreeting(timing);
    step(g, timing.delayMs, false);
    let maxLean = 0;
    let maxReduced = 0;
    const exprs = new Set<string | null>();
    for (let t = 0; t < timing.greetMs; t += 16) {
      g.update(16, false);
      maxLean = Math.max(maxLean, Math.abs(g.pose(false).lean));
      maxReduced = Math.max(maxReduced, Math.abs(g.pose(true).lean));
      exprs.add(g.pose(false).expression);
      expect(g.pose(true).bob).toBe(0);
    }
    expect(exprs.has('curious')).toBe(true);
    expect(exprs.has('happy')).toBe(true);
    expect(maxLean).toBeGreaterThan(0.05);
    expect(maxReduced).toBeLessThan(maxLean / 2);
  });

  it('is visual only: gameplay, hit areas and inactivity are unchanged', () => {
    const plain = new Game(BOUNDS, () => 0.5);
    const greeted = new Game(BOUNDS, () => 0.5);
    const greet = new IdleGreeting(timing);
    let events = 0;
    greeted.events = {
      onGrab: () => events++,
      onRelease: () => events++,
      onBounce: () => events++,
      onFeed: () => events++,
      onMerge: () => events++,
    };
    for (let i = 0; i < 60 * 12; i++) {
      plain.update(1 / 60, NO_INPUT);
      greeted.update(1 / 60, NO_INPUT);
      greet.update(1000 / 60, false);
      for (const c of greeted.creatures) c.greet = greet.pose(false);
    }
    expect(greet.idle).toBe(true);
    const a = plain.creatures[0];
    const b = greeted.creatures[0];
    expect(b.x).toBeCloseTo(a.x, 10);
    expect(b.y).toBeCloseTo(a.y, 10);
    expect(b.centerY).toBeCloseTo(a.centerY, 10);
    expect(greeted.hitRadius(b)).toBe(plain.hitRadius(a));
    expect(b.expression).toBe(a.expression);
    expect(greeted.phase).toBe('idle');
    expect(events).toBe(0);

    // A hand appears and pinches on the creature: the grab works normally.
    greet.update(16, true);
    for (const c of greeted.creatures) c.greet = greet.pose(false);
    const hand: GameInput = {
      ...NO_INPUT,
      present: true,
      active: true,
      x: b.x,
      y: b.centerY,
      pinching: true,
      pinchStart: true,
      acquired: true,
      recent: [{ x: b.x, y: b.centerY, t: 0 }],
    };
    greeted.update(1 / 60, hand);
    expect(b.greet).toBe(REST_POSE);
    expect(greeted.grabbed).toBe(b);
  });
});
