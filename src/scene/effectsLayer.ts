import * as THREE from 'three';
import { CONFIG } from '../config';
import { BODY_BOTTOM, type CreatureModel, type MagicLook } from '../game/creatureModel';
import type { StageBounds } from '../game/game';
import type { Bubble } from '../game/playground/bubble';
import { LOOKS } from '../game/playground/mergeMagic';
import type { ParticleKind } from '../game/playground/types';
import { drawBubble, drawSprite, type SpriteShape } from './symbols';

/** Bubbles float just behind the creatures, so Squishy passes in front of a Bubble Bounce target. */
const BUBBLE_Z = -1.2;
/** Particles and accessories are drawn in front. */
const FX_Z = 1.6;
const MAX_PARTICLES = 48;

interface BubbleMesh {
  body: THREE.Mesh;
  bodyMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  seen: boolean;
}

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  gravity: number;
  sway: number;
}

const ACCESSORY: Record<MagicLook, { shape: SpriteShape; color: string }> = {
  star: { shape: 'star', color: '#ffe066' },
  ocean: { shape: 'drop', color: '#7fe0ff' },
  galaxy: { shape: 'moon', color: '#ffe9a8' },
};

/** Projection factor: an object at depth z must be placed at x * k to appear at creature-plane x. */
function depthScale(z: number): number {
  return (CONFIG.stage.cameraDistance - z) / CONFIG.stage.cameraDistance;
}

/**
 * Playground visuals: bubbles with their symbols and glow, small particle bursts, floating
 * hearts and Merge Magic accessories. Everything is procedural (canvas textures, created once
 * and cached). Bursts are small and short, glows ease in and out, and nothing flashes.
 */
export class EffectsLayer {
  private group = new THREE.Group();
  private plane = new THREE.PlaneGeometry(1, 1);
  private textures = new Map<string, THREE.CanvasTexture>();
  private bubbles = new Map<number, BubbleMesh>();
  private particles: Particle[] = [];
  private accessories: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; emitAt: number }[] = [];
  private reduced = false;
  private R = 1;
  /**
   * Additive glow only on the opaque black hologram frame. On the transparent desktop canvas,
   * additive colour composites as dark smudges, so normal blending is used there.
   */
  private additive = false;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        toneMapped: false,
        map: this.sprite('dot'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.particles.push({ mesh, mat, life: 0, max: 0, x: 0, y: 0, vx: 0, vy: 0, size: 0, spin: 0, gravity: 0, sway: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.sprite('star'), transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.visible = false;
      mesh.renderOrder = 9;
      this.group.add(mesh);
      this.accessories.push({ mesh, mat, emitAt: 0 });
    }
    scene.add(this.group);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }

  setHologram(on: boolean): void {
    this.additive = on;
    const blending = on ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of this.bubbles.values()) m.glowMat.blending = blending;
  }

  private get glowBlending(): THREE.Blending {
    return this.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  // ---------------------------------------------------------------- particles

  burst(x: number, y: number, kind: ParticleKind, color: string, count: number = CONFIG.playground.burstParticles): void {
    const n = Math.max(1, Math.round(count * (this.reduced ? 0.5 : 1)));
    const R = this.R;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const speed = R * (this.reduced ? 1.1 : 2.2) * (0.6 + Math.random() * 0.6);
      this.spawn(kind, color, x, y, Math.cos(a) * speed, Math.sin(a) * speed + R * 0.6, R * (0.16 + Math.random() * 0.08), 0.75, R * 2.5);
    }
  }

  heart(x: number, y: number): void {
    const R = this.R;
    this.spawn('heart', '#ff6fb5', x, y, 0, R * 0.7, R * 0.42, 2.2, 0, R * 0.25);
  }

  private spawn(
    kind: SpriteShape,
    color: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    gravity: number,
    sway = 0,
  ): void {
    const p = this.particles.find((q) => q.life <= 0) ?? this.particles.reduce((a, q) => (q.life < a.life ? q : a));
    p.mat.map = this.sprite(kind);
    p.mat.color.set(color);
    // Hearts are a solid colour; sparkles glow softly.
    p.mat.blending = kind === 'heart' ? THREE.NormalBlending : this.glowBlending;
    Object.assign(p, { life, max: life, x, y, vx, vy, size, spin: (Math.random() - 0.5) * 3, gravity, sway });
    p.mesh.rotation.z = kind === 'heart' ? 0 : Math.random() * Math.PI;
    p.mesh.visible = true;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, bubbles: readonly Bubble[], creatures: readonly CreatureModel[], b: StageBounds, time: number): void {
    this.R = b.mainRadius;
    this.updateBubbles(bubbles, time);
    this.updateParticles(dt);
    this.updateAccessories(dt, creatures, time);
  }

  private updateBubbles(list: readonly Bubble[], time: number): void {
    const k = depthScale(BUBBLE_Z);
    for (const m of this.bubbles.values()) m.seen = false;
    for (const bub of list) {
      let m = this.bubbles.get(bub.id);
      if (!m) {
        m = this.createBubble(bub);
        this.bubbles.set(bub.id, m);
      }
      m.seen = true;
      const r = bub.drawRadius;
      const visible = r > 0.001;
      m.body.visible = m.glow.visible = visible;
      if (!visible) continue;
      m.body.position.set(bub.x * k, bub.y * k, BUBBLE_Z);
      // A squish flattens the bubble a little and widens it.
      const sq = bub.squish.value * 0.1;
      m.body.scale.set(2 * r * k * 1.087 * (1 + sq), 2 * r * k * 1.087 * (1 - sq), 1);
      m.bodyMat.opacity = bub.opacity;
      // Glow: lit bubbles (Squishy Says) and a slow, gentle breathing halo for invitations.
      const breathe = bub.attention ? 0.2 + 0.15 * (0.5 + 0.5 * Math.sin(time * (this.reduced ? 1.2 : 2.4))) : 0;
      const glow = Math.max(bub.glow, breathe) * bub.opacity;
      m.glow.visible = glow > 0.01;
      m.glow.position.set(bub.x * k, bub.y * k, BUBBLE_Z - 0.01);
      const gs = 2 * r * k * 1.6 * (1 + 0.08 * bub.glow);
      m.glow.scale.set(gs, gs, 1);
      m.glowMat.opacity = glow;
    }
    for (const [id, m] of this.bubbles) {
      if (m.seen) continue;
      this.group.remove(m.body, m.glow);
      m.bodyMat.dispose();
      m.glowMat.dispose();
      this.bubbles.delete(id);
    }
  }

  private createBubble(bub: Bubble): BubbleMesh {
    const key = `bubble|${bub.symbol}|${bub.color}|${bub.role === 'thought'}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = this.canvasTexture(512, (ctx, size) => drawBubble(ctx, size, bub.symbol, bub.color, bub.role === 'thought'));
      this.textures.set(key, tex);
    }
    const bodyMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const glowMat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      map: this.sprite('glow'),
      color: bub.color,
      transparent: true,
      depthWrite: false,
      blending: this.glowBlending,
      opacity: 0,
    });
    const body = new THREE.Mesh(this.plane, bodyMat);
    const glow = new THREE.Mesh(this.plane, glowMat);
    body.renderOrder = 4;
    glow.renderOrder = 3;
    this.group.add(glow, body);
    return { body, bodyMat, glow, glowMat, seen: true };
  }

  private updateParticles(dt: number): void {
    const k = depthScale(FX_Z);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.vx *= Math.exp(-1.5 * dt);
      p.x += p.vx * dt + (p.sway ? Math.sin(p.life * 3) * p.sway * dt : 0);
      p.y += p.vy * dt;
      const age = 1 - p.life / p.max;
      const s = p.size * (age < 0.15 ? age / 0.15 : 1) * k;
      p.mesh.position.set(p.x * k, p.y * k, FX_Z);
      p.mesh.scale.set(s * 2, s * 2, 1);
      p.mesh.rotation.z += p.spin * dt;
      // Fade out smoothly over the last 40 %.
      p.mat.opacity = Math.min(1, p.life / (p.max * 0.4));
    }
  }

  private updateAccessories(dt: number, creatures: readonly CreatureModel[], time: number): void {
    this.accessories.forEach((acc, i) => {
      const c = creatures[i];
      const amount = c?.alive ? c.magicAmount : 0;
      acc.mesh.visible = amount > 0.01 && !!c?.magic;
      if (!acc.mesh.visible || !c?.magic) return;
      const style = ACCESSORY[c.magic];
      acc.mat.map = this.sprite(style.shape);
      acc.mat.color.set(style.color);
      acc.mat.opacity = amount;
      const size = c.size;
      const z = size * 0.4;
      const k = depthScale(z);
      const top = c.y + 2 * BODY_BOTTOM * size * c.deform().d;
      const bob = Math.sin(time * (this.reduced ? 1.5 : 3)) * size * 0.05;
      acc.mesh.position.set(c.x * k, (top + size * 0.28 + bob) * k, z);
      const s = size * 0.62 * k;
      acc.mesh.scale.set(s, s, 1);
      acc.mesh.rotation.z = c.lean.value + c.wiggleLean;
      // A few sparkles drifting off the special look (fewer with reduced motion).
      acc.emitAt -= dt;
      if (acc.emitAt <= 0) {
        acc.emitAt = this.reduced ? 1.1 : 0.5;
        const look = LOOKS[c.magic];
        const a = Math.random() * Math.PI * 2;
        this.spawn(look.particle, look.color, c.x + Math.cos(a) * size, c.centerY + Math.sin(a) * size * 0.8, 0, size * 0.6, size * 0.14, 1.1, 0);
      }
    });
  }

  // ---------------------------------------------------------------- textures

  private sprite(shape: SpriteShape): THREE.CanvasTexture {
    const key = `sprite|${shape}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = this.canvasTexture(128, (ctx, size) => drawSprite(ctx, size, shape));
      this.textures.set(key, tex);
    }
    return tex;
  }

  private canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) draw(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.bubbles.values()) {
      m.bodyMat.dispose();
      m.glowMat.dispose();
    }
    for (const p of this.particles) p.mat.dispose();
    for (const a of this.accessories) a.mat.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.plane.dispose();
  }
}
