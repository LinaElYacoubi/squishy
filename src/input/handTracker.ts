import { CONFIG } from '../config';
import type { WorkerRequest, WorkerResponse } from './handInference.worker';
import type { LandmarkerPaths } from './landmarkerFactory';
import type { Point3 } from './pinch';

/**
 * Camera access and the hand landmark inference loop.
 *
 * Inference runs in a module worker (official MediaPipe Tasks Vision API, ES-module WASM build),
 * so the render loop is never blocked. If workers cannot run it, it falls back to the main thread.
 *
 * Privacy: frames go only from the <video> element to the local MediaPipe runtime (in the
 * worker as a transferred ImageBitmap that is closed right after inference). Nothing here
 * records, stores, uploads or transmits frames or landmarks. The model and runtime are served
 * from this app's own folder (see scripts/setup-assets.mjs).
 */

export type TrackerErrorKind = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'in-use' | 'model' | 'unknown';

export class TrackerError extends Error {
  constructor(
    readonly kind: TrackerErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const ERROR_MESSAGES: Record<TrackerErrorKind, string> = {
  insecure: 'Camera access needs a secure page. Open the app from http://localhost or over HTTPS.',
  unsupported:
    'This browser cannot provide camera hand tracking (needs getUserMedia, WebAssembly and WebGL). Try a current Chrome or Edge.',
  denied:
    'Camera permission was denied. Allow camera access for this page in the browser site settings, then press Retry.',
  unavailable: 'No usable camera was found. Check that a webcam is connected, then press Retry.',
  'in-use': 'The camera is in use by another application or tab. Close it there, then press Retry.',
  model:
    'The hand tracking model could not be loaded. Run "npm run setup-assets" so public/models/hand_landmarker.task and public/mediapipe/wasm exist, then press Retry.',
  unknown: 'The camera could not be started. Press Retry.',
};

export type HandsCallback = (hands: Point3[][], tMs: number, aspect: number) => void;

interface InferenceBackend {
  readonly kind: 'worker' | 'main thread';
  /** Runs inference on the current video frame; resolves to null if the frame failed. */
  detect(video: HTMLVideoElement, ts: number): Promise<Point3[][] | null>;
  close(): void;
}

export class HandTracker {
  readonly video: HTMLVideoElement;
  onHands: HandsCallback = () => {};
  /** Called when a running camera stops unexpectedly (e.g. unplugged). */
  onCameraEnded: () => void = () => {};

  private stream: MediaStream | null = null;
  private backend: InferenceBackend | null = null;
  private backendPromise: Promise<InferenceBackend> | null = null;
  private timer: number | undefined;
  private paused = false;
  private busy = false;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private startToken = 0;
  /** Measured inference rate, for the setup panel. */
  inferenceRate = 0;
  private rateCount = 0;
  private rateStart = 0;

  constructor(private hz: number = CONFIG.tracking.inferenceHz) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    // Kept in the DOM but invisible; it is never shown to visitors.
    Object.assign(this.video.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '0',
      top: '0',
    });
    document.body.appendChild(this.video);
  }

  get running(): boolean {
    return this.stream !== null;
  }

  get deviceId(): string | undefined {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  get label(): string {
    return this.stream?.getVideoTracks()[0]?.label || 'camera';
  }

  get backendKind(): string {
    return this.backend?.kind ?? '-';
  }

  get aspect(): number {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
  }

  static checkSupport(): TrackerError | null {
    if (!window.isSecureContext) return new TrackerError('insecure', ERROR_MESSAGES.insecure);
    if (!navigator.mediaDevices?.getUserMedia || typeof WebAssembly === 'undefined') {
      return new TrackerError('unsupported', ERROR_MESSAGES.unsupported);
    }
    return null;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    const token = ++this.startToken;
    const unsupported = HandTracker.checkSupport();
    if (unsupported) throw unsupported;

    // Start loading the model in parallel with the permission prompt.
    const backend = this.loadBackend();
    backend.catch(() => {}); // handled below

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: CONFIG.tracking.videoWidth },
          height: { ideal: CONFIG.tracking.videoHeight },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      throw mapMediaError(err);
    }
    if (token !== this.startToken) {
      stopStream(stream);
      return;
    }

    try {
      this.backend = await backend;
    } catch (err) {
      stopStream(stream);
      console.error('Hand model failed to load', err);
      throw new TrackerError('model', ERROR_MESSAGES.model);
    }
    if (token !== this.startToken) {
      stopStream(stream);
      return;
    }

    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', this.handleTrackEnded);
    }
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch {
      this.stop();
      throw new TrackerError('unknown', ERROR_MESSAGES.unknown);
    }
    this.lastVideoTime = -1;
    this.rateStart = performance.now();
    this.rateCount = 0;
    this.schedule(0);
  }

  /** Stops the camera completely (all tracks) and the inference loop. The model stays loaded. */
  stop(): void {
    this.startToken++;
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.busy = false;
    if (this.stream) {
      for (const track of this.stream.getVideoTracks()) track.removeEventListener('ended', this.handleTrackEnded);
      stopStream(this.stream);
      this.stream = null;
    }
    this.video.pause();
    this.video.srcObject = null;
    this.inferenceRate = 0;
  }

  /** Pause inference while the page is hidden; the loop resumes when unpaused. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.stream && this.timer === undefined) this.schedule(0);
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  dispose(): void {
    this.stop();
    this.backend?.close();
    this.backend = null;
    this.backendPromise?.then((b) => b.close()).catch(() => {});
    this.backendPromise = null;
    this.video.remove();
  }

  private loadBackend(): Promise<InferenceBackend> {
    if (!this.backendPromise) {
      const base = new URL(import.meta.env.BASE_URL, document.baseURI);
      const paths: LandmarkerPaths = {
        wasm: new URL('mediapipe/wasm', base).href,
        model: new URL('models/hand_landmarker.task', base).href,
      };
      this.backendPromise = createWorkerBackend(paths)
        .catch((err) => {
          console.warn('Worker inference unavailable, using the main thread', err);
          return createMainThreadBackend(paths);
        })
        .catch((err) => {
          this.backendPromise = null; // allow Retry
          throw err;
        });
    }
    return this.backendPromise;
  }

  private schedule(delay: number): void {
    this.timer = window.setTimeout(this.tick, delay);
  }

  private tick = (): void => {
    this.timer = undefined;
    const backend = this.backend;
    if (!this.stream || !backend || this.paused) return; // setPaused(false) restarts the loop
    const started = performance.now();
    const video = this.video;

    // Never queue frames: skip while a frame is in flight, and only process each video frame once.
    if (!this.busy && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      // MediaPipe requires strictly increasing timestamps.
      const ts = Math.max(started, this.lastTimestamp + 1);
      this.lastTimestamp = ts;
      const token = this.startToken;
      const aspect = this.aspect;
      this.busy = true;
      backend
        .detect(video, ts)
        .then((hands) => {
          if (token !== this.startToken || !hands) return;
          this.onHands(hands, ts, aspect);
          this.countFrame();
        })
        .catch((err) => console.warn('Hand inference failed for a frame', err))
        .finally(() => {
          if (token === this.startToken) this.busy = false;
        });
    }

    const spent = performance.now() - started;
    this.schedule(Math.max(4, 1000 / this.hz - spent));
  };

  private countFrame(): void {
    this.rateCount++;
    const now = performance.now();
    if (now - this.rateStart > 1000) {
      this.inferenceRate = (this.rateCount * 1000) / (now - this.rateStart);
      this.rateCount = 0;
      this.rateStart = now;
    }
  }

  private handleTrackEnded = (): void => {
    this.stop();
    this.onCameraEnded();
  };
}

async function createWorkerBackend(paths: LandmarkerPaths): Promise<InferenceBackend> {
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Workers or ImageBitmap not supported');
  }
  const worker = new Worker(new URL('./handInference.worker.ts', import.meta.url), { type: 'module' });
  const send = (msg: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

  try {
    let timeout: number | undefined;
    await new Promise<void>((resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error('Worker init timed out')), 45000);
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'ready') resolve();
        else if (e.data.type === 'init-error') reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Worker failed to start'));
      send({ type: 'init', paths });
    }).finally(() => window.clearTimeout(timeout));
  } catch (err) {
    worker.terminate();
    throw err;
  }

  let pending: ((hands: Point3[][] | null) => void) | null = null;
  const settle = (hands: Point3[][] | null) => {
    const p = pending;
    pending = null;
    p?.(hands);
  };
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    if (e.data.type === 'result') settle(e.data.landmarks);
    else if (e.data.type === 'frame-error') settle(null);
  };
  worker.onerror = () => settle(null);

  return {
    kind: 'worker',
    async detect(video, ts) {
      const bitmap = await createImageBitmap(video);
      return new Promise((resolve) => {
        pending = resolve;
        send({ type: 'frame', bitmap, ts }, [bitmap]);
      });
    },
    close() {
      settle(null);
      send({ type: 'close' });
      worker.terminate();
    },
  };
}

async function createMainThreadBackend(paths: LandmarkerPaths): Promise<InferenceBackend> {
  const { createHandLandmarker } = await import('./landmarkerFactory');
  const landmarker = await createHandLandmarker(paths, false);
  return {
    kind: 'main thread',
    async detect(video, ts) {
      return landmarker.detectForVideo(video, ts).landmarks as Point3[][];
    },
    close() {
      landmarker.close();
    },
  };
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function mapMediaError(err: unknown): TrackerError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new TrackerError('denied', ERROR_MESSAGES.denied);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new TrackerError('unavailable', ERROR_MESSAGES.unavailable);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new TrackerError('in-use', ERROR_MESSAGES['in-use']);
    default:
      return new TrackerError('unknown', ERROR_MESSAGES.unknown);
  }
}
