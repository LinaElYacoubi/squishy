/**
 * Static privacy checks on the application source: no API that could transmit,
 * record or export camera frames, images or landmarks is used anywhere in src/.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|css|html)$/.test(name) ? [p] : [];
  });
}

const sources = [...files(SRC), join(ROOT, 'index.html')].map((p) => ({
  path: p,
  text: readFileSync(p, 'utf8'),
}));

const FORBIDDEN: [string, RegExp][] = [
  ['network request (fetch)', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['sendBeacon', /sendBeacon/],
  ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/],
  ['WebRTC peer connection', /RTCPeerConnection/],
  ['MediaRecorder (recording)', /MediaRecorder/],
  ['canvas export (toDataURL)', /toDataURL/],
  ['canvas export (toBlob)', /toBlob/],
  ['pixel read-back (getImageData)', /getImageData/],
  ['GPU pixel read-back (readPixels)', /readPixels/],
  ['stream capture (captureStream)', /captureStream/],
  ['IndexedDB', /indexedDB/],
  ['file download links', /\.download\s*=/],
  ['cross-window messaging', /(window|parent|opener|top)\s*\.\s*postMessage/],
];

it('postMessage is only used between the page and its own inference worker', () => {
  const users = sources.filter((s) => /postMessage/.test(s.text)).map((s) => s.path.replace(/\\/g, '/'));
  expect(users.every((p) => /src\/input\/(handTracker|handInference\.worker)\.ts$/.test(p))).toBe(true);
});

describe('privacy', () => {
  for (const [label, re] of FORBIDDEN) {
    it(`application code does not use ${label}`, () => {
      const hits = sources.filter((s) => re.test(s.text)).map((s) => s.path);
      expect(hits).toEqual([]);
    });
  }

  it('no external URLs are referenced at runtime (model and runtime are served locally)', () => {
    // The SVG namespace in the inline favicon is an identifier, not a request.
    const hits = sources.filter((s) => /https?:\/\/(?!localhost|www\.w3\.org\/2000\/svg)/.test(s.text)).map((s) => s.path);
    expect(hits).toEqual([]);
  });

  it('localStorage is only used for operator settings, which contain no camera data', () => {
    const users = sources.filter((s) => /localStorage/.test(s.text)).map((s) => s.path.replace(/\\/g, '/'));
    expect(users.every((p) => p.endsWith('src/settings.ts'))).toBe(true);
    const settings = sources.find((s) => s.path.replace(/\\/g, '/').endsWith('src/settings.ts'))!.text;
    expect(settings).not.toMatch(/landmark|frame|image|video/i);
  });
});
