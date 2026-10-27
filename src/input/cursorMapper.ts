import { CONFIG } from '../config';
import { OneEuroFilter } from './oneEuroFilter';

export interface InputRegion {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Maps a point in the camera image (normalised 0..1) to the safe display area (0..1),
 * mirroring horizontally if requested, and smooths it with a One Euro filter.
 */
export class CursorMapper {
  mirror: boolean = CONFIG.cursor.mirrorByDefault;
  region: InputRegion = { ...CONFIG.cursor.inputRegion };
  private fx = new OneEuroFilter(CONFIG.cursor.minCutoff, CONFIG.cursor.beta, CONFIG.cursor.derivativeCutoff);
  private fy = new OneEuroFilter(CONFIG.cursor.minCutoff, CONFIG.cursor.beta, CONFIG.cursor.derivativeCutoff);

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }

  /** Raw mapping without smoothing. */
  mapRaw(imageX: number, imageY: number): { u: number; v: number } {
    const x = this.mirror ? 1 - imageX : imageX;
    const r = this.region;
    return {
      u: clamp01((x - r.xMin) / (r.xMax - r.xMin)),
      v: clamp01((imageY - r.yMin) / (r.yMax - r.yMin)),
    };
  }

  map(imageX: number, imageY: number, tMs: number): { u: number; v: number } {
    const raw = this.mapRaw(imageX, imageY);
    return { u: clamp01(this.fx.filter(raw.u, tMs)), v: clamp01(this.fy.filter(raw.v, tMs)) };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
