import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { FoodKind, FoodModel } from '../game/food';
import type { StageBounds } from '../game/game';

/**
 * Procedural food items and their tray. Food is drawn in front of the creatures (at depth
 * CONFIG.food.depth) and scaled toward the camera axis so it appears exactly where its
 * creature-plane position is, which keeps it aligned with the cursor.
 */
export class FoodLayer {
  private readonly group = new THREE.Group();
  private readonly items: { kind: FoodKind; obj: THREE.Group }[] = [];
  private readonly tray: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(private scene: THREE.Scene) {
    const g = <T extends THREE.BufferGeometry>(geo: T): T => (this.geometries.push(geo), geo);
    const m = <T extends THREE.Material>(mat: T): T => (this.materials.push(mat), mat);
    // Standard (not physical) materials keep food cheap to draw; the scene's reflections make it glossy.
    const glossy = (color: string, roughness = 0.3) =>
      m(new THREE.MeshStandardMaterial({ color, roughness, emissive: color, emissiveIntensity: 0.06 }));

    const sphere = g(new THREE.SphereGeometry(1, 32, 20));
    const leafMat = glossy('#3fbf5a', 0.45);

    // Strawberry-like red berry: tapered body, leafy cap and seeds.
    const berry = new THREE.Group();
    const berryGeo = g(new THREE.SphereGeometry(1, 32, 24));
    const p = berryGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = y < 0 ? 1 + y * 0.42 : 1;
      p.setXYZ(i, p.getX(i) * k, y * 1.08, p.getZ(i) * k);
    }
    berryGeo.computeVertexNormals();
    berry.add(new THREE.Mesh(berryGeo, glossy(CONFIG.food.colors.berry)));
    const cap = new THREE.Mesh(g(new THREE.ConeGeometry(0.62, 0.32, 7)), leafMat);
    cap.position.y = 1.02;
    berry.add(cap);
    // Seeds: one merged mesh instead of one draw call per seed.
    const seedGeo = new THREE.SphereGeometry(1, 6, 4);
    const seedParts: THREE.BufferGeometry[] = [];
    for (const [sx, sy] of [[-0.45, 0.35], [0.1, 0.5], [0.5, 0.2], [-0.2, -0.05], [0.3, -0.3], [-0.5, -0.3], [0, -0.6]]) {
      const k = sy < 0 ? 1 + sy * 0.42 : 1;
      const part = seedGeo.clone();
      part.scale(0.06, 0.09, 0.04);
      part.translate(sx * k, sy * 1.08, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)) * k + 0.02);
      seedParts.push(part);
    }
    berry.add(new THREE.Mesh(g(mergeGeometries(seedParts)), m(new THREE.MeshBasicMaterial({ color: '#ffe680' }))));
    seedGeo.dispose();
    for (const part of seedParts) part.dispose();

    // Yellow fruit piece: a soft rounded chunk.
    const fruit = new THREE.Group();
    const chunk = new THREE.Mesh(g(new RoundedBoxGeometry(1.6, 1.25, 1.25, 4, 0.32)), glossy(CONFIG.food.colors.fruit, 0.35));
    chunk.rotation.set(0.35, 0.55, 0.1);
    fruit.add(chunk);

    // Blueberry: round, slightly flattened, with a little crown.
    const blueberry = new THREE.Group();
    const bb = new THREE.Mesh(sphere, glossy(CONFIG.food.colors.blueberry, 0.45));
    bb.scale.set(1, 0.92, 1);
    blueberry.add(bb);
    const crown = new THREE.Mesh(g(new THREE.TorusGeometry(0.28, 0.09, 8, 14)), glossy('#1c2470', 0.5));
    crown.position.set(0, 0.55, 0.72);
    crown.rotation.x = -0.65;
    blueberry.add(crown);

    for (const [kind, obj] of [['berry', berry], ['fruit', fruit], ['blueberry', blueberry]] as const) {
      this.items.push({ kind, obj });
      this.group.add(obj);
    }

    // Tray, tilted toward the camera so its top is visible.
    this.tray = new THREE.Mesh(
      g(new THREE.CylinderGeometry(1, 0.92, 0.22, 48)),
      m(new THREE.MeshStandardMaterial({ color: '#e7dcff', roughness: 0.35, emissive: '#e7dcff', emissiveIntensity: 0.08 })),
    );
    this.tray.rotation.x = 0.5;
    this.group.add(this.tray);

    // "Release now to feed" indicator.
    this.ringMat = m(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    this.ring = new THREE.Mesh(g(new THREE.TorusGeometry(1, 0.07, 8, 48)), this.ringMat);
    this.ring.visible = false;
    this.group.add(this.ring);

    scene.add(this.group);
  }

  update(foods: readonly FoodModel[], b: StageBounds, time: number): void {
    const z = CONFIG.food.depth;
    const k = (CONFIG.stage.cameraDistance - z) / CONFIG.stage.cameraDistance;
    const r = b.foodRadius;

    this.tray.position.set(b.trayX * k, (b.trayY - r * 0.95) * k, z - r * 0.3);
    this.tray.scale.set((b.foodSpacing + r * 1.5) * k, r * 0.6 * k, r * 1.4 * k);

    let ready: FoodModel | null = null;
    for (const f of foods) {
      const obj = this.items[f.index].obj;
      obj.visible = f.visible;
      if (!obj.visible) continue;
      const bob = f.state === 'tray' ? Math.sin(time * 2.2 + f.index * 2) * r * 0.04 : 0;
      const pulse = f.feedReady ? 1 + 0.08 * Math.sin(time * 10) : 1;
      const s = r * f.scale.value * pulse * k;
      obj.position.set(f.x * k, (f.y + bob) * k, z);
      obj.scale.setScalar(s);
      obj.rotation.z = f.state === 'held' ? Math.sin(time * 6) * 0.12 : 0;
      if (f.feedReady) ready = f;
    }

    this.ring.visible = ready !== null;
    if (ready) {
      this.ring.position.set(ready.x * k, ready.y * k, z + r * 0.2);
      this.ring.scale.setScalar(r * 1.55 * k * (1 + 0.06 * Math.sin(time * 10)));
      this.ringMat.opacity = 0.55 + 0.25 * Math.sin(time * 10);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
