import * as THREE from 'three';
import { approach } from '../game/anim';
import { BODY_BOTTOM, type CreatureModel, type Expression } from '../game/creatureModel';
import type { CreatureAssets } from './assets';

interface Eye {
  group: THREE.Group;
  white: THREE.Mesh;
  pupil: THREE.Mesh;
  sparkle: THREE.Mesh;
  arc: THREE.Mesh;
  ux: number;
  uy: number;
  p: THREE.Vector3;
}

const EXPRESSIONS: Record<Expression, { eye: number; pupil: number; o: number; smile: number }> = {
  neutral: { eye: 1, pupil: 1, o: 0, smile: 1 },
  curious: { eye: 1.08, pupil: 1.05, o: 0, smile: 0.85 },
  surprised: { eye: 1.3, pupil: 0.6, o: 1, smile: 0 },
  happy: { eye: 1, pupil: 1, o: 0, smile: 1.35 },
  cheeky: { eye: 1, pupil: 1, o: 0, smile: 1.4 },
  hungry: { eye: 1.15, pupil: 1.15, o: 1.45, smile: 0 },
};

/**
 * Point on the (undeformed) body surface for a direction with the given x and y on the unit
 * sphere, using the same shaping as the body geometry. Facial features are placed here and
 * then transformed with the body, so they stay attached as it squashes and stretches.
 */
function surfacePoint(x: number, y0: number): THREE.Vector3 {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y0 * y0));
  const xz = y0 < 0 ? 1 + 0.25 * -y0 * (1 + y0) : 1 - 0.04 * y0;
  return new THREE.Vector3(x * xz, y0 < 0 ? y0 * BODY_BOTTOM : y0, z * xz);
}

/** Three.js view of one CreatureModel slot. Created once and reused; never rebuilt per frame. */
export class JellyView {
  readonly root = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private material: THREE.MeshPhysicalMaterial;
  private eyes: Eye[] = [];
  private smile: THREE.Mesh;
  private mouthO: THREE.Mesh;
  private cheeks: THREE.Mesh[] = [];
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private mouthPoint = surfacePoint(0, -0.14);
  private cheekPoints = [surfacePoint(-0.56, -0.04), surfacePoint(0.56, -0.04)];
  private expr = { ...EXPRESSIONS.neutral };
  private tmpColor = new THREE.Color();

  constructor(
    assets: CreatureAssets,
    slot: number,
    private scene: THREE.Scene,
  ) {
    this.material = assets.bodyMaterials[slot];
    const body = new THREE.Mesh(assets.body, this.material);
    this.bodyGroup.add(body);
    // The body transform (squash + directional stretch) is written as a matrix every frame.
    this.bodyGroup.matrixAutoUpdate = false;

    // Glossy highlights live on the body so they deform with it.
    const hl1 = new THREE.Mesh(assets.sphere, assets.highlight);
    hl1.position.set(-0.38, 0.56, 0.74);
    hl1.scale.set(0.2, 0.11, 0.05);
    hl1.rotation.z = 0.65;
    const hl2 = new THREE.Mesh(assets.sphere, assets.highlight);
    hl2.position.set(-0.13, 0.76, 0.62);
    hl2.scale.set(0.06, 0.045, 0.03);
    this.bodyGroup.add(hl1, hl2);
    this.root.add(this.bodyGroup);

    for (const ux of [-0.34, 0.34]) {
      const group = new THREE.Group();
      const white = new THREE.Mesh(assets.sphere, assets.eyeWhite);
      const pupil = new THREE.Mesh(assets.sphere, assets.pupil);
      const sparkle = new THREE.Mesh(assets.sphere, assets.sparkle);
      const arc = new THREE.Mesh(assets.smile, assets.pupil);
      arc.scale.setScalar(1.25);
      arc.position.set(0, -0.15, 0.45);
      group.add(white, pupil, sparkle, arc);
      this.root.add(group);
      this.eyes.push({ group, white, pupil, sparkle, arc, ux, uy: 0.2, p: surfacePoint(ux, 0.2) });
    }

    this.smile = new THREE.Mesh(assets.smile, assets.mouth);
    this.smile.rotation.z = Math.PI;
    this.mouthO = new THREE.Mesh(assets.sphere, assets.mouth);
    this.root.add(this.smile, this.mouthO);

    for (let i = 0; i < 2; i++) {
      const cheek = new THREE.Mesh(assets.disc, assets.cheek);
      cheek.rotation.y = i === 0 ? -0.6 : 0.6;
      cheek.renderOrder = 2;
      this.cheeks.push(cheek);
      this.root.add(cheek);
    }

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: assets.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    this.shadow = new THREE.Mesh(assets.plane, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;

    scene.add(this.root, this.shadow);
  }

  update(m: CreatureModel, time: number, dt: number, floorY: number, showShadow: boolean): void {
    const size = m.size;
    const visible = m.alive && size > 0.002;
    this.root.visible = visible;
    this.shadow.visible = visible && showShadow;
    if (!visible) return;

    // Colour, blended toward the last food eaten.
    const k = m.tintAmount;
    this.tmpColor.setRGB(
      m.color[0] + (m.tint[0] - m.color[0]) * k,
      m.color[1] + (m.tint[1] - m.color[1]) * k,
      m.color[2] + (m.tint[2] - m.color[2]) * k,
      THREE.SRGBColorSpace,
    );
    this.material.color.copy(this.tmpColor);
    this.material.emissive.copy(this.tmpColor);

    const D = m.deform();
    const centerY = size * BODY_BOTTOM * D.d;

    this.root.position.set(m.x + Math.sin(time * 45) * m.shiver * size, m.y, 0);
    this.root.rotation.z = m.lean.value;
    // prettier-ignore
    this.bodyGroup.matrix.set(
      D.a * size, D.b * size, 0, 0,
      D.c * size, D.d * size, 0, centerY,
      0, 0, D.z * size, 0,
      0, 0, 0, 1,
    );
    this.bodyGroup.matrixWorldNeedsUpdate = true;

    const target = EXPRESSIONS[m.expression];
    const e = this.expr;
    e.eye = approach(e.eye, target.eye, 14, dt);
    e.pupil = approach(e.pupil, target.pupil, 14, dt);
    e.o = approach(e.o, target.o, 16, dt);
    e.smile = approach(e.smile, target.smile, 12, dt);
    // Chewing: the mouth opens and closes quickly.
    const chew = m.chewing;
    const mouthO = chew ? 0.25 + 0.75 * Math.abs(Math.sin(time * 13)) : e.o;
    const smile = chew ? 0 : e.smile;

    const place = (obj: THREE.Object3D, p: THREE.Vector3, inset = 0) => {
      obj.position.set(
        (D.a * p.x + D.b * p.y) * size,
        centerY + (D.c * p.x + D.d * p.y) * size,
        (p.z - inset) * size * D.z,
      );
    };

    // Eyes: attached to the deformed surface, deforming only partly so they stay readable.
    const eyeSquashX = 1 + (D.a - 1) * 0.4;
    const eyeSquashY = 1 + (D.d - 1) * 0.4;
    const closedHappy = m.expression === 'happy' && m.blink > 0.5;
    const lookX = m.expression === 'surprised' ? m.lookX * 0.3 : m.lookX;
    const lookY = m.expression === 'surprised' ? m.lookY * 0.3 : m.lookY;
    for (const eye of this.eyes) {
      place(eye.group, eye.p, 0.05);
      eye.group.rotation.set(-eye.uy * 0.4, eye.ux * 0.55, 0);
      const s = size * 0.2 * e.eye;
      eye.group.scale.set(s * eyeSquashX, s * eyeSquashY, s);

      const open = 1 - m.blink * 0.92;
      eye.white.visible = !closedHappy;
      eye.white.scale.set(1, open, 0.55);
      eye.pupil.visible = !closedHappy && m.blink < 0.7;
      eye.pupil.scale.set(0.55 * e.pupil, 0.62 * e.pupil * open, 0.22);
      eye.pupil.position.set(lookX * 0.33, lookY * 0.28 * open, 0.46);
      eye.sparkle.visible = eye.pupil.visible;
      eye.sparkle.scale.setScalar(0.17 * Math.min(1, e.pupil + 0.2));
      eye.sparkle.position.set(eye.pupil.position.x + 0.17, eye.pupil.position.y + 0.22 * open, 0.62);
      eye.arc.visible = closedHappy;
    }

    // Mouth: smile and an open "O" (surprise, hunger, chewing), cross-faded by scale.
    place(this.smile, this.mouthPoint, 0.02);
    const smileS = size * 0.17;
    this.smile.visible = smile > 0.05;
    this.smile.scale.set(smileS * Math.max(0.05, smile), smileS * Math.max(0.05, Math.min(1.2, smile)), smileS);
    place(this.mouthO, this.mouthPoint, 0.03);
    this.mouthO.visible = mouthO > 0.05;
    this.mouthO.scale.set(size * 0.085 * mouthO, size * 0.11 * mouthO, size * 0.05);

    this.cheekPoints.forEach((p, i) => {
      place(this.cheeks[i], p, -0.01);
      this.cheeks[i].scale.set(size * 0.12 * D.a, size * 0.075 * D.d, 1);
    });

    if (showShadow) {
      const height = Math.max(0, m.y - floorY);
      const s = Math.max(0, 1 - height / (m.radius * 3));
      this.shadow.position.set(m.x, floorY + 0.002, 0.2 * size);
      this.shadow.scale.set(size * 2.3 * D.a * (0.6 + 0.4 * s), size * 2.6 * (0.6 + 0.4 * s), 1);
      this.shadowMat.opacity = 0.55 * (0.35 + 0.65 * s);
    }
  }

  dispose(): void {
    this.scene.remove(this.root, this.shadow);
    this.shadowMat.dispose();
  }
}
