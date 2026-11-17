import { CONFIG, type SafeMargins } from './config';
import type { DisplayMode } from './scene/stage';
import { isLanguage, type Language } from './ui/i18n';

export type ReducedMotionSetting = 'auto' | 'on' | 'off';

/** Operator choices that persist across reloads on the installation machine (no camera data). */
export interface OperatorSettings {
  displayMode: DisplayMode;
  mirror: boolean;
  margins: SafeMargins;
  cameraId: string | null;
  reducedMotion: ReducedMotionSetting;
  /** Start (and reset) with three small Squishies instead of one, to test merging. */
  startWithMinis: boolean;
  /** Visitor text language (EN / FR buttons). */
  language: Language;
  /** Playful sound effects. Off until someone turns them on. */
  sound: boolean;
  /** Follow up to two hands, each with its own cursor (two players, or one player with both hands). */
  twoPlayers: boolean;
}

const KEY = 'jelly-catch.operator.v1';

export function defaultSettings(): OperatorSettings {
  return {
    displayMode: 'desktop',
    mirror: CONFIG.cursor.mirrorByDefault,
    margins: { ...CONFIG.stage.defaultSafeMargins },
    cameraId: null,
    reducedMotion: 'auto',
    startWithMinis: false,
    language: 'en',
    sound: false,
    twoPlayers: true,
  };
}

/**
 * Defaults, then saved settings, then URL overrides
 * (?display=black|desktop|hologram, ?mirror=0|1, ?lang=en|fr).
 */
export function loadSettings(search = location.search): OperatorSettings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<OperatorSettings>;
      if (isDisplayMode(saved.displayMode)) s.displayMode = saved.displayMode;
      if (typeof saved.mirror === 'boolean') s.mirror = saved.mirror;
      if (saved.margins) s.margins = sanitizeMargins({ ...s.margins, ...saved.margins });
      if (typeof saved.cameraId === 'string') s.cameraId = saved.cameraId;
      if (saved.reducedMotion === 'on' || saved.reducedMotion === 'off') s.reducedMotion = saved.reducedMotion;
      if (typeof saved.startWithMinis === 'boolean') s.startWithMinis = saved.startWithMinis;
      if (isLanguage(saved.language)) s.language = saved.language;
      if (typeof saved.sound === 'boolean') s.sound = saved.sound;
      if (typeof saved.twoPlayers === 'boolean') s.twoPlayers = saved.twoPlayers;
    }
  } catch {
    // Storage unavailable or corrupt: use defaults.
  }
  const params = new URLSearchParams(search);
  const display = params.get('display');
  if (isDisplayMode(display)) s.displayMode = display;
  const mirror = params.get('mirror');
  if (mirror === '0' || mirror === '1') s.mirror = mirror === '1';
  const lang = params.get('lang');
  if (isLanguage(lang)) s.language = lang;
  return s;
}

function isDisplayMode(v: unknown): v is DisplayMode {
  return v === 'desktop' || v === 'black' || v === 'hologram';
}

export function saveSettings(s: OperatorSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings simply will not persist.
  }
}

export function sanitizeMargins(m: SafeMargins): SafeMargins {
  const c = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.min(0.3, Math.max(0, v)) : 0);
  return { top: c(m.top), right: c(m.right), bottom: c(m.bottom), left: c(m.left) };
}
