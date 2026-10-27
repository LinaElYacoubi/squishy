import './styles.css';
import { App } from './app';
import { Stage, WebGLUnavailableError } from './scene/stage';

function showFatal(text: string): void {
  const fatal = document.getElementById('fatal');
  if (!fatal) return;
  (fatal.querySelector('.fatal-text') as HTMLElement).textContent = text;
  fatal.querySelector('.fatal-reload')?.addEventListener('click', () => location.reload(), { once: true });
  fatal.hidden = false;
}

let app: App | null = null;

try {
  Stage.assertWebGL();
  app = new App(document.getElementById('app')!);
  app.start();
} catch (err) {
  console.error(err);
  showFatal(
    err instanceof WebGLUnavailableError
      ? 'This browser or graphics driver does not provide WebGL. Enable hardware acceleration in the browser settings, update the browser, or try Chrome or Edge.'
      : 'Something went wrong while starting. Reload the page to try again.',
  );
}

if (app) {
  // GPU context loss (driver reset, sleep): show a readable message instead of a frozen scene.
  document.querySelector('#stage canvas')?.addEventListener('webglcontextlost', () => {
    showFatal('The graphics context was lost (for example after a driver reset). Reload to restart the experience.');
  });
}

// Release the camera and GPU resources when the page is closed or navigated away from.
window.addEventListener('pagehide', () => {
  app?.dispose();
  app = null;
});

// Clean up during development hot reloads so loops, listeners and camera tracks never pile up.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app?.dispose();
    app = null;
  });
}
