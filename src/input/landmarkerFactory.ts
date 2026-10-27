import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG } from '../config';

export interface LandmarkerPaths {
  /** Absolute URL of the folder holding the MediaPipe WASM runtime. */
  wasm: string;
  /** Absolute URL of hand_landmarker.task. */
  model: string;
}

/**
 * Creates a MediaPipe Hand Landmarker in VIDEO mode, preferring the GPU delegate and
 * falling back to CPU. `useModule` loads the ES-module WASM build, which module workers need.
 */
export async function createHandLandmarker(
  paths: LandmarkerPaths,
  useModule: boolean,
  delegate: 'GPU' | 'CPU' = CONFIG.tracking.delegate,
): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(paths.wasm, useModule);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: paths.model, delegate },
    runningMode: 'VIDEO' as const,
    numHands: CONFIG.tracking.maxHands,
    minHandDetectionConfidence: CONFIG.tracking.minDetectionConfidence,
    minHandPresenceConfidence: CONFIG.tracking.minPresenceConfidence,
    minTrackingConfidence: CONFIG.tracking.minTrackingConfidence,
  });
  if (delegate === 'CPU') return HandLandmarker.createFromOptions(fileset, options('CPU'));
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (gpuErr) {
    console.warn('GPU delegate unavailable, falling back to CPU', gpuErr);
    return HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}
