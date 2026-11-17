import type { BubbleSymbol } from '../game/playground/bubble';

/**
 * Canvas 2D drawings for bubble symbols, particles and Merge Magic accessories. Drawn once
 * into textures (no image files). Every symbol has a distinct SHAPE, not only a colour.
 */

type Ctx = CanvasRenderingContext2D;

export function starPath(ctx: Ctx, cx: number, cy: number, r: number, points = 5, inner = 0.48): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

export function heartPath(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.85);
  ctx.bezierCurveTo(cx - s * 1.25, cy + s * 0.05, cx - s * 0.95, cy - s * 0.95, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.95, cy - s * 0.95, cx + s * 1.25, cy + s * 0.05, cx, cy + s * 0.85);
  ctx.closePath();
}

function roundedPoly(ctx: Ctx, pts: [number, number][], radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % pts.length];
    const mx = (p[0] + next[0]) / 2;
    const my = (p[1] + next[1]) / 2;
    if (i === 0) {
      const prev = pts[pts.length - 1];
      ctx.moveTo((prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2);
    }
    ctx.arcTo(p[0], p[1], mx, my, radius);
  }
  ctx.closePath();
}

function fillOutlined(ctx: Ctx, fill: string, line = 10): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = line;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draw a bubble symbol centred at (cx, cy) with half-size s. */
export function drawSymbol(ctx: Ctx, symbol: BubbleSymbol, color: string, cx: number, cy: number, s: number): void {
  ctx.save();
  switch (symbol) {
    case 'star':
      starPath(ctx, cx, cy + s * 0.06, s);
      fillOutlined(ctx, color);
      break;
    case 'heart':
      heartPath(ctx, cx, cy, s * 0.95);
      fillOutlined(ctx, color);
      break;
    case 'triangle':
      roundedPoly(
        ctx,
        [
          [cx, cy - s * 0.95],
          [cx + s * 0.95, cy + s * 0.72],
          [cx - s * 0.95, cy + s * 0.72],
        ],
        s * 0.16,
      );
      fillOutlined(ctx, color);
      break;
    case 'berry': {
      // Strawberry: tapered red body, green leaves, yellow seeds.
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.95);
      ctx.bezierCurveTo(cx - s * 0.9, cy + s * 0.35, cx - s * 0.95, cy - s * 0.6, cx, cy - s * 0.55);
      ctx.bezierCurveTo(cx + s * 0.95, cy - s * 0.6, cx + s * 0.9, cy + s * 0.35, cx, cy + s * 0.95);
      ctx.closePath();
      fillOutlined(ctx, '#ff3b4f', 8);
      starPath(ctx, cx, cy - s * 0.6, s * 0.42, 5, 0.4);
      ctx.fillStyle = '#3fbf5a';
      ctx.fill();
      ctx.fillStyle = '#ffe680';
      for (const [dx, dy] of [[-0.35, -0.15], [0.3, -0.12], [0, 0.15], [-0.25, 0.4], [0.25, 0.42], [0, 0.65]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * s, cy + dy * s, s * 0.06, s * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fruit':
      // A soft yellow chunk.
      ctx.translate(cx, cy);
      ctx.rotate(-0.25);
      roundedPoly(
        ctx,
        [
          [-s * 0.8, -s * 0.6],
          [s * 0.8, -s * 0.6],
          [s * 0.8, s * 0.6],
          [-s * 0.8, s * 0.6],
        ],
        s * 0.3,
      );
      fillOutlined(ctx, '#ffc93c', 8);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.35, -s * 0.3, s * 0.22, s * 0.1, -0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'blueberry':
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.82, 0, Math.PI * 2);
      fillOutlined(ctx, '#4a63e8', 8);
      starPath(ctx, cx, cy - s * 0.2, s * 0.3, 5, 0.45);
      ctx.fillStyle = '#1c2470';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.38, cy + s * 0.25, s * 0.14, s * 0.09, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'play':
    case 'next':
      // Play triangle (Next game adds a second one).
      if (symbol === 'next') {
        roundedPoly(ctx, [[cx - s * 0.75, cy - s * 0.62], [cx + s * 0.1, cy], [cx - s * 0.75, cy + s * 0.62]], s * 0.12);
        fillOutlined(ctx, '#ffffff', 6);
        roundedPoly(ctx, [[cx - s * 0.05, cy - s * 0.62], [cx + s * 0.85, cy], [cx - s * 0.05, cy + s * 0.62]], s * 0.12);
        fillOutlined(ctx, '#ffffff', 6);
      } else {
        roundedPoly(ctx, [[cx - s * 0.5, cy - s * 0.78], [cx + s * 0.85, cy], [cx - s * 0.5, cy + s * 0.78]], s * 0.16);
        fillOutlined(ctx, '#ffffff', 6);
      }
      break;
    case 'minis':
      // Three little gumdrops.
      for (const [dx, dy, rr] of [[-0.55, 0.25, 0.36], [0.55, 0.25, 0.36], [0, -0.3, 0.42]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * s, cy + dy * s, rr * s, rr * s * 0.92, 0, 0, Math.PI * 2);
        fillOutlined(ctx, '#ffffff', 5);
        ctx.fillStyle = '#2a1640';
        for (const ex of [-0.13, 0.13]) {
          ctx.beginPath();
          ctx.arc(cx + (dx + ex) * s, cy + (dy - 0.03) * s, s * 0.05, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case 'home':
      // A little house.
      roundedPoly(
        ctx,
        [
          [cx, cy - s * 0.85],
          [cx + s * 0.85, cy - s * 0.05],
          [cx + s * 0.62, cy - s * 0.05],
          [cx + s * 0.62, cy + s * 0.75],
          [cx - s * 0.62, cy + s * 0.75],
          [cx - s * 0.62, cy - s * 0.05],
          [cx - s * 0.85, cy - s * 0.05],
        ],
        s * 0.1,
      );
      fillOutlined(ctx, '#ffffff', 6);
      ctx.fillStyle = color;
      ctx.fillRect(cx - s * 0.18, cy + s * 0.2, s * 0.36, s * 0.55);
      break;
    case 'stop':
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.32;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.55, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.55, cy + s * 0.55);
      ctx.moveTo(cx + s * 0.55, cy - s * 0.55);
      ctx.lineTo(cx - s * 0.55, cy + s * 0.55);
      ctx.stroke();
      break;
    case 'ring':
      break;
  }
  ctx.restore();
}

/** A bubble with its symbol. Thought bubbles are bright so the snack picture reads from afar. */
export function drawBubble(ctx: Ctx, size: number, symbol: BubbleSymbol, color: string, thought: boolean): void {
  const c = size / 2;
  const r = size * 0.46;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(c - r * 0.25, c - r * 0.3, r * 0.1, c, c, r);
  if (thought) {
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(235,225,255,0.85)');
  } else if (symbol === 'ring') {
    g.addColorStop(0, hexA(color, 0.06));
    g.addColorStop(0.75, hexA(color, 0.16));
    g.addColorStop(1, hexA(color, 0.5));
  } else {
    g.addColorStop(0, hexA(color, 0.28));
    g.addColorStop(0.8, hexA(color, 0.42));
    g.addColorStop(1, hexA(color, 0.7));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Rim.
  ctx.lineWidth = size * (symbol === 'ring' ? 0.035 : 0.025);
  ctx.strokeStyle = thought ? 'rgba(160,130,220,0.9)' : 'rgba(255,255,255,0.9)';
  ctx.stroke();
  // Glossy highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(c - r * 0.45, c - r * 0.52, r * 0.22, r * 0.11, -0.6, 0, Math.PI * 2);
  ctx.fill();
  drawSymbol(ctx, symbol, color, c, c, r * 0.55);
}

export type SpriteShape = 'sparkle' | 'star' | 'heart' | 'bubble' | 'dot' | 'glow' | 'drop' | 'moon';

/** White (tintable) particle and glow shapes, plus coloured accessories (drop, moon). */
export function drawSprite(ctx: Ctx, size: number, shape: SpriteShape): void {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  switch (shape) {
    case 'glow': {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.68, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      break;
    }
    case 'dot': {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      break;
    }
    case 'sparkle':
      starPath(ctx, c, c, c * 0.9, 4, 0.28);
      ctx.fill();
      break;
    case 'star':
      starPath(ctx, c, c * 1.05, c * 0.9);
      ctx.fill();
      break;
    case 'heart':
      heartPath(ctx, c, c, c * 0.8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      break;
    case 'bubble':
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = size * 0.08;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(c - c * 0.35, c - c * 0.35, c * 0.18, c * 0.1, -0.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.moveTo(c, c * 0.15);
      ctx.bezierCurveTo(c * 1.75, c * 1.05, c * 1.5, c * 1.85, c, c * 1.85);
      ctx.bezierCurveTo(c * 0.5, c * 1.85, c * 0.25, c * 1.05, c, c * 0.15);
      ctx.fill();
      break;
    case 'moon':
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(c * 1.4, c * 0.8, c * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
