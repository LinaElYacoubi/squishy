import * as THREE from 'three';
import { CONFIG } from '../config';
import { BODY_BOTTOM } from '../game/creatureModel';

/**
 * Geometry, materials and textures shared by every creature, created once and reused.
 * Everything is procedural: no model files are needed.
 */
export class CreatureAssets {
  readonly body: THREE.BufferGeometry;
  readonly sphere: THREE.SphereGeometry;
  readonly smile: THREE.TorusGeometry;
  readonly disc: THREE.CircleGeometry;
  readonly plane: THREE.PlaneGeometry;

  readonly eyeWhite: THREE.MeshStandardMaterial;
  readonly pupil: THREE.MeshStandardMaterial;
  readonly sparkle: THREE.MeshBasicMaterial;
  readonly mouth: THREE.MeshStandardMaterial;
  readonly highlight: THREE.MeshBasicMaterial;
  readonly cheek: THREE.MeshBasicMaterial;
  readonly shadowTexture: THREE.CanvasTexture;
  /** One body material per creature colour (index 0 = main, 1..3 = minis). */
  readonly bodyMaterials: THREE.MeshPhysicalMaterial[];

  private rimUniforms = {
    uRimColor: { value: new THREE.Color('#ffe3f6') },
    uRimStrength: { value: 0.55 },
  };

  constructor() {
    this.body = createBodyGeometry();
    this.sphere = new THREE.SphereGeometry(1, 24, 16);
    // Half torus. Unrotated it is an arch (closed happy eye); rotated by PI it is a smile.
    this.smile = new THREE.TorusGeometry(0.5, 0.11, 8, 24, Math.PI);
    this.disc = new THREE.CircleGeometry(1, 28);
    this.plane = new THREE.PlaneGeometry(1, 1);

    this.eyeWhite = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 0.12 });
    this.pupil = new THREE.MeshStandardMaterial({ color: '#1d1030', roughness: 0.15, metalness: 0 });
    this.sparkle = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.mouth = new THREE.MeshStandardMaterial({ color: '#4a1238', roughness: 0.5 });
    this.highlight = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
    this.cheek = new THREE.MeshBasicMaterial({ color: '#ff4fa3', transparent: true, opacity: 0.35, depthWrite: false });
    this.shadowTexture = createShadowTexture();

    const colors = [CONFIG.creature.mainColor, ...CONFIG.creature.miniColors];
    this.bodyMaterials = colors.map((c) => this.createBodyMaterial(c));
  }

  private createBodyMaterial(color: string): THREE.MeshPhysicalMaterial {
    const c = CONFIG.creature;
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: c.roughness,
      clearcoat: c.clearcoat,
      clearcoatRoughness: c.clearcoatRoughness,
      sheen: c.sheen,
      sheenColor: new THREE.Color(c.sheenColor),
      sheenRoughness: 0.35,
      emissive: new THREE.Color(color),
      emissiveIntensity: c.emissiveStrength,
    });
    // Soft fresnel rim for a translucent jelly look, without expensive refraction.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = this.rimUniforms.uRimColor;
      shader.uniforms.uRimStrength = this.rimUniforms.uRimStrength;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float rimFacing = saturate(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRimColor * pow(1.0 - rimFacing, 2.6) * uRimStrength;`,
        );
    };
    mat.customProgramCacheKey = () => 'jelly-rim';
    return mat;
  }

  dispose(): void {
    for (const g of [this.body, this.sphere, this.smile, this.disc, this.plane]) g.dispose();
    for (const m of [this.eyeWhite, this.pupil, this.sparkle, this.mouth, this.highlight, this.cheek, ...this.bodyMaterials]) {
      m.dispose();
    }
    this.shadowTexture.dispose();
  }
}

/** A rounded gumdrop: sphere with a flattened, slightly wider base and a softer top. */
function createBodyGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 56, 40);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y0 = v.y;
    let xz = 1;
    if (y0 < 0) {
      v.y = y0 * BODY_BOTTOM;
      xz = 1 + 0.25 * -y0 * (1 + y0);
    } else {
      xz = 1 - 0.04 * y0;
    }
    v.x *= xz;
    v.z *= xz;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function createShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
