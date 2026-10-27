/**
 * Module worker that runs MediaPipe hand landmark inference off the main thread.
 *
 * Privacy: it receives one ImageBitmap at a time from the page, runs inference locally,
 * closes the bitmap immediately and returns only landmark coordinates to the page.
 * It never stores, encodes or transmits frames.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker, type LandmarkerPaths } from './landmarkerFactory';

export type WorkerRequest =
  | { type: 'init'; paths: LandmarkerPaths }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number }
  | { type: 'close' };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'result'; ts: number; landmarks: { x: number; y: number; z: number }[][] }
  | { type: 'frame-error'; ts: number };

const scope = self as unknown as {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let landmarker: HandLandmarker | null = null;

scope.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      try {
        landmarker = await createHandLandmarker(msg.paths, true);
        scope.postMessage({ type: 'ready' });
      } catch (err) {
        scope.postMessage({ type: 'init-error', message: String(err) });
      }
      break;
    case 'frame':
      try {
        if (!landmarker) throw new Error('not ready');
        const result = landmarker.detectForVideo(msg.bitmap, msg.ts);
        const landmarks = result.landmarks.map((hand) => hand.map(({ x, y, z }) => ({ x, y, z })));
        scope.postMessage({ type: 'result', ts: msg.ts, landmarks });
      } catch {
        scope.postMessage({ type: 'frame-error', ts: msg.ts });
      } finally {
        msg.bitmap.close();
      }
      break;
    case 'close':
      landmarker?.close();
      landmarker = null;
      break;
  }
};
