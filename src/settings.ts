import { CONFIG, type SafeMargins } from './config';
import type { DisplayMode } from './scene/stage';

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
  };
}

/** Defaults, then saved settings, then URL overrides (?display=black|desktop, ?mirror=0|1). */
export function loadSettings(search = location.search): OperatorSettings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<OperatorSettings>;
      if (saved.displayMode === 'desktop' || saved.displayMode === 'black') s.displayMode = saved.displayMode;
      if (typeof saved.mirror === 'boolean') s.mirror = saved.mirror;
      if (saved.margins) s.margins = sanitizeMargins({ ...s.margins, ...saved.margins });
      if (typeof saved.cameraId === 'string') s.cameraId = saved.cameraId;
      if (saved.reducedMotion === 'on' || saved.reducedMotion === 'off') s.reducedMotion = saved.reducedMotion;
      if (typeof saved.startWithMinis === 'boolean') s.startWithMinis = saved.startWithMinis;
    }
  } catch {
    // Storage unavailable or corrupt: use defaults.
  }
  const params = new URLSearchParams(search);
  const display = params.get('display');
  if (display === 'black' || display === 'desktop') s.displayMode = display;
  const mirror = params.get('mirror');
  if (mirror === '0' || mirror === '1') s.mirror = mirror === '1';
  return s;
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
