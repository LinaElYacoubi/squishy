// Copies the MediaPipe Tasks Vision WASM runtime out of node_modules and
// downloads the hand landmarker model, so the app serves both locally and
// makes no third-party requests at runtime.
//
// Runs automatically after `npm install`; run again with `npm run setup-assets`.
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, 'public', 'mediapipe', 'wasm');
const modelDest = join(root, 'public', 'models', 'hand_landmarker.task');

// Official MediaPipe model (Apache-2.0), float16, version 1.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDest, { recursive: true });
  cpSync(wasmSrc, wasmDest, { recursive: true });
  console.log('[setup-assets] Copied MediaPipe WASM runtime to public/mediapipe/wasm');
} else {
  console.warn('[setup-assets] @mediapipe/tasks-vision is not installed yet; skipping WASM copy.');
}

if (existsSync(modelDest) && statSync(modelDest).size > 1_000_000) {
  console.log('[setup-assets] Hand landmarker model already present.');
} else {
  try {
    console.log(`[setup-assets] Downloading hand landmarker model from ${MODEL_URL}`);
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(modelDest), { recursive: true });
    writeFileSync(modelDest, buf);
    console.log(`[setup-assets] Saved public/models/hand_landmarker.task (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    // Do not fail `npm install`; the app shows a clear model-loading error instead.
    console.warn(`[setup-assets] Could not download the model: ${err.message}`);
    console.warn(`[setup-assets] Download it manually from ${MODEL_URL}`);
    console.warn('[setup-assets] and save it as public/models/hand_landmarker.task');
  }
}
