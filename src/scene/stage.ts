import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONFIG, type SafeMargins } from '../config';
import type { StageBounds } from '../game/game';

export type DisplayMode = 'desktop' | 'black';

export class WebGLUnavailableError extends Error {}

export interface SafeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renderer, scene, camera, lights and framing.
 *
 * The camera is fixed and looks straight at the creature plane (z = 0), so screen pixels map
 * linearly to world positions on that plane. Safe margins shrink the area creatures and the
 * cursor may use, so the scene can be fitted to the real display later.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  mode: DisplayMode = 'desktop';
  /** Safe area in CSS pixels, relative to the viewport. */
  safeRect: SafeRect = { x: 0, y: 0, width: 1, height: 1 };
  bounds!: StageBounds;

  private width = 1;
  private height = 1;
  private visibleW = 1;
  private visibleH = 1;
  private envTexture: THREE.Texture;

  constructor(
    private container: HTMLElement,
    private margins: SafeMargins,
  ) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      throw new WebGLUnavailableError(String(err));
    }
    const r = this.renderer;
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(r.domElement);
    r.domElement.addEventListener('webglcontextlost', this.handleContextLost);

    this.camera = new THREE.PerspectiveCamera(CONFIG.stage.cameraFov, 1, 0.1, 100);
    this.camera.position.set(0, 0, CONFIG.stage.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    // Soft studio reflections for the glossy jelly (generated procedurally, no downloads).
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.5;
    // Turn the studio so its bright panels reflect off to the side, not as a stripe down the face.
    this.scene.environmentRotation.set(0.35, 0.9, 0);

    const hemi = new THREE.HemisphereLight('#fff2fb', '#3b2357', 0.9);
    const key = new THREE.DirectionalLight('#ffffff', 2.0);
    key.position.set(-4, 6, 8);
    const rim = new THREE.DirectionalLight('#c9a8ff', 1.6);
    rim.position.set(5, 3, -6);
    this.scene.add(hemi, key, rim);

    this.resize();
  }

  /** Throws if WebGL is clearly unavailable, before any heavier setup. */
  static assertWebGL(): void {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new WebGLUnavailableError('WebGL is not available');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  setMargins(margins: SafeMargins): void {
    this.margins = margins;
    this.resize();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    document.documentElement.dataset.display = mode;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.visibleH = 2 * CONFIG.stage.cameraDistance * Math.tan(THREE.MathUtils.degToRad(CONFIG.stage.cameraFov / 2));
    this.visibleW = this.visibleH * this.camera.aspect;

    const m = this.margins;
    this.safeRect = {
      x: w * m.left,
      y: h * m.top,
      width: Math.max(1, w * (1 - m.left - m.right)),
      height: Math.max(1, h * (1 - m.top - m.bottom)),
    };

    const tl = this.pixelToWorld(this.safeRect.x, this.safeRect.y);
    const br = this.pixelToWorld(this.safeRect.x + this.safeRect.width, this.safeRect.y + this.safeRect.height);
    const safeW = br.x - tl.x;
    const safeH = tl.y - br.y;
    const minDim = Math.min(safeW, safeH);
    const mainRadius = minDim * CONFIG.creature.mainRadiusFraction;
    // Perspective makes the front of the body look slightly larger; keep a little extra room.
    const pad = mainRadius * 0.08;
    const portrait = safeH > safeW * 1.15;
    const left = tl.x + pad;
    const right = br.x - pad;

    // Food tray: bottom centre (below the floor) in portrait, bottom-left corner in landscape.
    const foodRadius = Math.max(mainRadius * CONFIG.food.radiusRadii, minDim * CONFIG.food.minRadiusFraction);
    const foodSpacing = foodRadius * 2.6;
    const trayHalfWidth = foodSpacing + foodRadius * 1.5;
    this.bounds = {
      left,
      right,
      top: tl.y - pad,
      bottom: br.y,
      floorY: br.y + safeH * (portrait ? CONFIG.stage.floorFractionPortrait : CONFIG.stage.floorFraction),
      mainRadius,
      miniMinRadius: minDim * CONFIG.split.miniMinRadiusFraction,
      minHitRadius: minDim * CONFIG.hit.minHitFraction,
      trayX: portrait ? (left + right) / 2 : left + trayHalfWidth,
      trayY: br.y + foodRadius * 1.35,
      foodRadius,
      foodSpacing,
    };
  }

  /** CSS pixel (relative to the viewport) to world position on the creature plane. */
  pixelToWorld(px: number, py: number): { x: number; y: number } {
    return {
      x: (px / this.width - 0.5) * this.visibleW,
      y: (0.5 - py / this.height) * this.visibleH,
    };
  }

  /** World position on the creature plane to CSS pixels (used by diagnostics and tests). */
  worldToPixel(x: number, y: number): { x: number; y: number } {
    return {
      x: (x / this.visibleW + 0.5) * this.width,
      y: (0.5 - y / this.visibleH) * this.height,
    };
  }

  /** Safe-area normalised coordinates (0..1) to CSS pixels. */
  safeToPixel(u: number, v: number): { x: number; y: number } {
    return { x: this.safeRect.x + u * this.safeRect.width, y: this.safeRect.y + v * this.safeRect.height };
  }

  safeToWorld(u: number, v: number): { x: number; y: number } {
    const p = this.safeToPixel(u, v);
    return this.pixelToWorld(p.x, p.y);
  }

  pixelToSafe(px: number, py: number): { u: number; v: number } {
    return {
      u: Math.min(1, Math.max(0, (px - this.safeRect.x) / this.safeRect.width)),
      v: Math.min(1, Math.max(0, (py - this.safeRect.y) / this.safeRect.height)),
    };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.envTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
  };
}
