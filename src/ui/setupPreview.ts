import type { InputRegion } from '../input/cursorMapper';
import type { Point3 } from '../input/pinch';

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/**
 * Draws the mirrored camera image, detected hands and the active input region into the
 * operator's setup canvas. Only runs while the setup preview is visible. Pixels are drawn
 * for display only and are never read back, saved or sent anywhere.
 */
export function drawSetupPreview(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement | null,
  hands: readonly (readonly Point3[])[],
  selected: readonly Point3[] | null,
  mirror: boolean,
  region: InputRegion,
  pinching: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  if (video && video.readyState >= 2) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No camera image', w / 2, h / 2);
  }

  // The preview is always shown mirrored; draw the input region where it applies.
  const x0 = mirror ? region.xMin : 1 - region.xMax;
  const x1 = mirror ? region.xMax : 1 - region.xMin;
  ctx.strokeStyle = 'rgba(255, 204, 77, 0.9)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 * w, region.yMin * h, (x1 - x0) * w, (region.yMax - region.yMin) * h);
  ctx.setLineDash([]);

  for (const hand of hands) {
    const isSelected = hand === selected;
    ctx.strokeStyle = isSelected ? '#ff7ad9' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo((1 - hand[a].x) * w, hand[a].y * h);
      ctx.lineTo((1 - hand[b].x) * w, hand[b].y * h);
    }
    ctx.stroke();
    if (isSelected) {
      for (const i of [4, 8]) {
        ctx.fillStyle = pinching ? '#ff7ad9' : '#ffffff';
        ctx.beginPath();
        ctx.arc((1 - hand[i].x) * w, hand[i].y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
