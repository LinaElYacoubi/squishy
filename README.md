# Squishy

A touch-free interactive 3D prototype for an INNOVA display at the University of Ottawa.

Squishy, a pink jelly creature, lives on the screen. Visitors move one hand in the air in front of
a webcam. Every interaction uses the same gesture: **pinch, move, let go**.

- **Grab and stretch:** pinch Squishy to pick it up. It dangles, follows the hand with a jelly lag
  and stretches toward it.
- **Throw and bounce:** let go during a quick flick and it flies, bounces off the edges and settles.
- **Merge:** drag a small Squishy onto another and let go. They melt into one larger Squishy.
- **Feed:** pinch a berry or fruit on the tray, bring it to Squishy's mouth and let go.

Everything is built in code (Vite, TypeScript, Three.js, MediaPipe Hand Landmarker). There are no
3D model files, no backend, no accounts and no cloud processing.

---

## 1. Install, run and build

Requirements: **Node.js 22.12 or newer** (Node 24 recommended), a current **Chrome or Edge**, and a webcam.

```bash
npm install          # installs packages, copies the tracking runtime and downloads the hand model
npm run dev          # development server at http://localhost:5173
npm run build        # type-check and build to dist/
npm run preview      # serve the built dist/ at http://localhost:4173
npm test             # unit tests (gesture logic, gameplay, privacy checks)
```

`npm install` runs `scripts/setup-assets.mjs` automatically. If the model download failed (for
example, while offline), run it again:

```bash
npm run setup-assets
```

For the installation machine, copy the whole `dist/` folder and serve it from **localhost** or
**HTTPS** with any static web server (for example `npm run preview`). Opening `index.html`
directly from disk (`file://`) will not work: browsers only allow camera access on secure pages.

## 2. Enabling the webcam

1. Open the app at `http://localhost:...` or an `https://` address. Camera access is blocked on
   plain `http://` addresses other than localhost.
2. The **operator panel** opens at start. It is the small round button in the top-right corner;
   press **O** to show or hide it.
3. Press **Enable camera**. The browser asks for permission once. Allow it.
4. If several cameras are connected, choose one in the **Camera** list (it is available once
   permission is granted). The choice is remembered.
5. Close the panel for visitors.

If something goes wrong, the panel explains it and offers **Retry**. This covers permission
denied, no camera, a camera in use by another app, a missing model and an unsupported browser.
To reset a denied permission, click the camera or lock icon in the address bar and allow the camera.

The camera only starts after **Enable camera** is pressed. After a page reload it has to be pressed
again. For an unattended kiosk you can let Chrome pre-approve the camera for your local address
(enterprise policy `VideoCaptureAllowedUrls`), but the button press is still needed.

## 3. Setup checklist (camera, lighting, mirroring)

- [ ] **Camera position:** centred above or below the display, facing visitors, roughly at chest
      to head height. Visitors should be about 1 to 2.5 m away.
- [ ] **Framing:** turn on **Show setup preview** in the operator panel. A raised hand should
      appear well inside the yellow dashed rectangle (the active input region). Ideally the hand
      fills 1/10 to 1/5 of the image height.
- [ ] **Lighting:** light the visitors' hands from the front. Avoid bright windows or spotlights
      behind visitors, which put hands in silhouette. Very dim rooms make tracking jittery.
- [ ] **Background:** busy backgrounds and other people are fine. Only one hand is followed, and
      it does not jump to other hands. If two hands overlap it deliberately lets go and reacquires.
- [ ] **Mirroring:** keep **Mirror tracking** on when visitors face the camera, so moving the hand
      right moves the cursor right. Turn it off only if the camera image is already mirrored (some
      capture devices do this). Check by moving your hand right and watching the cursor.
- [ ] **Pinch check:** in the preview, the debug line shows the pinch ratio. An open hand should
      read well above 0.48, and a pinch well below 0.30.
- [ ] **Display fit:** adjust **Safe margins** until the dashed pink outline (shown while the panel
      is open) matches the usable area of the real display. Creatures and the cursor stay inside it.
- [ ] **Display mode:** try **Black background** on the holographic or immersive equipment, and
      **Desktop preview** on a normal monitor. Black mode is only a presentation option to test on
      the equipment. It is not guaranteed to suit any particular projection.
- [ ] **Fullscreen:** press **Fullscreen** (or F11), then close the panel.

## 4. How visitors interact

Guidance on screen:
- "Show one hand to the camera." appears until a hand is detected.
- "Pinch to grab. Move. Let go." appears with a small animation of a thumb-and-index pinch. It
  fades after the first pinch or a few seconds of interaction.
- A little later, "Try giving me a snack." appears above the food tray for a few seconds, until
  food is picked up.
- The cursor ring grows and turns pink over anything grabbable, and closes while holding. It
  glows and fills when held food is close enough to a mouth to feed it.

What a pinch does, in priority order:
1. **Over food:** picks it up. Release near a mouth to feed. Released anywhere else, the food
   glides back to the tray.
2. **Over a Squishy:** grabs it. Release slowly to drop it, or quickly to throw it. Release a small
   Squishy over another one to merge them.
3. **Anywhere else:** nothing.

Once something is held, it stays held until the hand opens or tracking is lost. It never
switches to another object mid-gesture.

How each interaction behaves:
- **Grab and stretch:** dodging and idle hopping stop while a Squishy is held. Its eyes follow the
  movement or look at its stretched body. After a slow release it settles, wobbles back into
  shape and blinks, as if it noticed being stretched.
- **Throw:** the release speed is estimated from the last ~120 ms of hand movement, ignoring the
  final moment (the fingertip moves as the pinch opens) and any isolated tracking jumps. Slow
  releases are drops. Throw speed is capped, impacts squash the body, and hard bounces make it
  blink in surprise. Everything stays inside the safe area.
- **Hand lost while holding:** the Squishy is let go with no throw and falls gently, and held food
  returns to the tray. A returning hand must be open before a new pinch counts.
- **Merge:** only when a small Squishy is dragged for at least a moment and dropped (slowly) while
  overlapping another. Collisions and throws never merge. The new size comes from the combined
  volume, capped at `merge.maxRadii`, and the colour is a volume-weighted blend. Only the
  surviving Squishy's face remains.
- **Feeding:** as food comes near, Squishys watch it. In the feeding zone the mouth opens and a
  ring pulses around the food. On release the food is eaten exactly once: a chew, a happy squish,
  a temporary tint toward the food's colour and a little puff. The food reappears on the tray
  shortly after. With several Squishys, the one whose mouth is closest eats. Feeding is optional:
  there is no hunger, score or penalty. There is no sound (the project has no sound system).

General:
- If the hand is lost, the cursor fades, the pinch is cleared and "Show your hand again" appears.
- After about 30 seconds without movement or gestures, everything returns to the default
  arrangement for the next visitor. A hand held still does not keep it active.
- Touching the screen does nothing except show "No need to touch the screen."

## 5. Operator controls

| Control | What it does |
|---|---|
| Enable / Disable camera | Requests permission and starts tracking / stops every camera track |
| Camera | Choose among multiple webcams |
| Fullscreen | Toggles fullscreen (shows a message if the browser refuses) |
| Reset | Restores the default arrangement, colours, sizes and food, and clears any held object or animation |
| Split demo | Demonstration only: splits a single resting Squishy into three small ones. Visitors cannot trigger this |
| Start with three small Squishies | Makes the default arrangement (start, Reset and inactivity reset) three small Squishies, so merging can be tried straight away |
| Mode | Desktop preview (dark scene with a soft floor shadow) or Black background (pure black, no floor) |
| Mirror tracking | Reverses horizontal hand mapping |
| Reduced motion | Follows the OS setting by default. Gentler movement and fewer dodges when on |
| Safe margins | Shrinks the usable area per side to fit the real display |
| Show setup preview | Mirrored camera image with hand landmarks, input region and live diagnostics. Operator only |
| Mouse test mode | Development only: the mouse moves the cursor and a click is a pinch, using the same gameplay logic. Never switched on automatically |

Settings (not camera data) are saved in the browser's local storage. URL overrides:
`?display=black`, `?display=desktop`, `?mirror=0`, `?mirror=1`.

## 6. Where to adjust things

Most tuning values are in **`src/config.ts`**, grouped and commented:

| What | Where in `src/config.ts` |
|---|---|
| Creature colours, gloss, glow | `creature.mainColor`, `creature.miniColors`, `roughness`, `clearcoat`, `sheen`, `emissiveStrength` |
| Creature size | `creature.mainRadiusFraction` (minis are one third of the volume, never below `split.miniMinRadiusFraction`) |
| Target size (how forgiving grabbing is) | `hit.hitScale`, `hit.minHitFraction`, `hit.pinchHistoryMs` |
| **Stretch strength** | `grab.stretchGain` (how much it stretches), `grab.maxStretch` (limit), `grab.sagRadii` (dangle), `grab.followStiffness` / `followDamping` (lag and wobble) |
| **Throw sensitivity** | `throw.minSpeedRadii` (raise to make throws harder to trigger), `throw.scale`, `throw.maxSpeedRadii`, `throw.windowMs`, `throw.ignoreLastMs` |
| Bouncing | `throw.gravityRadii`, `floorRestitution`, `wallRestitution`, `floorFriction`, `settleSpeedRadii` |
| **Merge distance** | `merge.overlapFactor` (higher = merges from further apart), `merge.minHoldMs`, `merge.smallBelowRadii`, `merge.maxRadii` |
| **Feeding radius** | `food.feedRadiusRadii` (size of the mouth zone), `food.hitScale` (how easy food is to pick up) |
| Food look and timing | `food.colors`, `food.radiusRadii`, `respawnMs`, `chewMs`, `tintAmount`, `tintFadeMs`, `puffKick` |
| Snack hint timing | `ui.snackHintDelayMs`, `ui.snackHintMs` |
| Cursor smoothing | `cursor.minCutoff` (lower = smoother), `cursor.beta` (higher = less lag) |
| How far visitors must move their hand | `cursor.inputRegion` (part of the camera image mapped to the whole screen) |
| Pinch sensitivity | `pinch.pinchThreshold`, `pinch.releaseThreshold`, `pinch.stableFrames`, `pinch.cooldownMs` |
| Tracking rate, hand selection | `tracking.inferenceHz`, `tracking.delegate` (`'GPU'` or `'CPU'`), `acquireFrames`, `lostGraceMs`, `maxJumpPalms` |
| Dodging | `dodge.chance`, `distanceRadii`, `cooldownMs`, `maxConsecutive`, `catchWindowMs` |
| Inactivity reset | `activity.inactivityMs` |
| Floor height, default safe margins, camera perspective | `stage.*` |
| Render quality and rate | `render.maxPixelRatio`, `render.maxFps` |
| Reduced-motion behaviour | `reducedMotion.*` |

Shape and face details:
- Body shape, highlights and materials: `src/creature/assets.ts`
- Eyes, mouth, cheeks and expressions: `src/creature/jellyView.ts` (`EXPRESSIONS` table)
- Food shapes and the tray: `src/creature/foodView.ts`; tray placement: `src/scene/stage.ts`
  (bottom-left in landscape, bottom-centre below the floor in portrait)
- Interaction logic and timing: `src/game/game.ts`, `src/game/creatureModel.ts`, `src/game/throw.ts`
- Visitor wording: `src/ui/visitorOverlay.ts` and `index.html`

## 7. External assets and their sources

| Asset | Source | Licence | When it is downloaded |
|---|---|---|---|
| MediaPipe Tasks Vision library and WASM runtime | npm package [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.1.1 | Apache-2.0 | During `npm install`; copied to `public/mediapipe/wasm/` |
| Hand landmark model `hand_landmarker.task` (float16, v1) | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` (official MediaPipe model, see the [Hand Landmarker docs](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)) | Apache-2.0 | During `npm install` (`scripts/setup-assets.mjs`); saved to `public/models/` |
| Three.js (including the procedural `RoomEnvironment` for reflections) | npm package `three` | MIT | During `npm install` |

At **runtime** the app loads the model and runtime only from its own folder. It makes no requests
to other servers and needs no internet connection. There are no fonts, images or other remote assets.

## 8. Privacy

"Your camera is used for hand tracking. Video is processed in this browser and is not recorded or
uploaded by this app."

How the code keeps to this:
- Frames go from a hidden `<video>` element to the MediaPipe runtime in a local Web Worker (as an
  `ImageBitmap` that is closed right after inference). Only landmark coordinates come back, and
  they are kept in memory just long enough to move the cursor.
- No recording, screenshots, canvas exports, uploads, analytics or storage of frames or landmarks.
  `tests/privacy.test.ts` scans the source for network, recording and export APIs and fails if any appear.
- The setup preview draws the camera image only in the operator panel, for display.
- Disabling the camera, closing the page or a development hot-reload stops every camera track.

## 9. Project structure

```
src/
  config.ts                 all tuning values
  main.ts, app.ts           start-up, render loop, wiring
  settings.ts               operator settings persistence
  scene/stage.ts            renderer, camera, lights, framing and safe margins
  creature/assets.ts        procedural geometry and materials (shared, created once)
  creature/jellyView.ts     one creature's meshes, eyes, expressions, stretch deformation
  creature/foodView.ts      procedural food items, tray and feed-ready ring
  game/game.ts              interaction state (none / creature / food), sequences (split / merge),
                            physics, feeding and dodging
  game/creatureModel.ts     per-creature animation state (springs, stretch, hops, blinking, tint)
  game/food.ts              food item state (tray, held, returning, eaten)
  game/throw.ts             robust release-velocity estimate
  game/activity.ts          inactivity detection
  game/anim.ts              frame-rate-independent springs and easing
  input/handTracker.ts      camera access, inference loop, error handling
  input/handInference.worker.ts   MediaPipe inference off the main thread
  input/handSelection.ts    stable single-hand selection
  input/pinch.ts            normalised pinch ratio and pinch state machine
  input/cursorMapper.ts     mirroring, input region, One Euro smoothing
  input/handPipeline.ts     landmarks -> cursor and pinch events
  input/inputHub.ts         shared cursor state for hand and mouse modes
  ui/                       visitor overlay, operator panel, setup preview
tests/                      unit tests (Vitest)
scripts/setup-assets.mjs    copies the runtime and downloads the model
```

## 10. What was verified, and what still needs real testing

**Verified on a development PC (Windows 11, Node 24, Chrome):**
- `npm run build` (TypeScript strict type-check plus production build) succeeds.
- 85 unit tests pass (`npm test`). They use **simulated cursor input and synthetic landmark data,
  not a real camera**:
  - **Grab:** pinching grabs without ever splitting. Stretch follows the drag direction
    (left, right, up), deformation stays within limits under extreme pulls, the creature stays
    inside the stage, and there's no dodging or idle hopping while held.
  - **Release and throw:**
    - a slow release drops and settles back to normal shape
    - a fast flick throws, with the speed capped
    - a thrown Squishy bounces off a wall, stays in bounds and settles
    - hand loss mid-grab releases with zero velocity
    - it can be caught again in mid-air
  - **Throw estimator:** slow movement is not a throw, the speed cap works, and isolated tracking
    jumps, the finger-opening motion and stale movement are all ignored. Sparse 30 Hz samples work.
  - **Merge:**
    - a deliberate drop merges, giving the correct volume-based size and blended colour
    - three minis merge back into exactly one full-size Squishy, and the size cap holds
    - releasing away from others, or throwing past one, does not merge
  - **Split demo:** splits into three, blocks grabbing during the animation, and refuses while
    something is held or when several Squishys exist.
  - **Feeding:**
    - feed-ready state, eaten once, chew, tint, puff, then respawn
    - a miss returns the food to the tray
    - a held pinch cannot feed twice, and losing the hand returns the food
    - food takes priority over a creature behind it, and the target never switches mid-gesture
    - with several Squishys the closest mouth eats, and creatures watch approaching food
  - **Reset:** works during a grab, a throw, food holding, eating, splitting, after a split and
    during a merge. Each restores the default arrangement, colours, sizes and food, and a held
    pinch does not grab after the reset.
  - **Landmark pipeline end-to-end:** a held pinch grabs once, sliding onto Squishy while pinched
    does not grab, and tracking loss during a grab never throws. A closed hand returning cannot grab.
  - Pinch detection, hand selection, dodging limits, inactivity, frame-rate independence and the
    static privacy checks.
- Headless-Chrome checks in **mouse test mode** (23 checks) on the production build:
  - **Grab and drop:** grab without split, a visible stretch, a slow drop that settles
  - **Throw:** throw and bounce within bounds. This one uses real `PointerEvent`s dispatched in
    the page 16 ms apart, because the test browser's emulated graphics are too slow to deliver a
    real-time flick.
  - **Food:** pick up, feed-ready state, feed once, respawn, and a miss that returns to the tray
  - **Split demo and merge:** both work, and the start-with-three-Squishies option works
  - **Reset:** works during a grab, a food hold, a split and a merge. 20 more resets still leave
    one render loop.
  - **Layout:** portrait tray layout and feeding, black mode, and the snack hint appearing and
    then disappearing once food is picked up. No console errors.
- Headless-Chrome camera checks (18) using **Chrome's built-in fake camera (a test pattern with
  no hands)**:
  - the model loads locally in the Web Worker, with no external or upload requests
  - Disable camera stops the stream
  - permission-denied and model-failure messages, with a working Retry

**Not yet verified, needs testing with real hardware:**
- Hand tracking with a **real webcam and real hands**: pinch thresholds, cursor smoothing, the
  input region and dodge difficulty all need tuning with real visitors.
- **Throwing by hand:** with 30 Hz tracking and the pinch-release delay, `throw.minSpeedRadii` and
  `throw.ignoreLastMs` need tuning so that natural flicks throw and gentle releases do not.
  Opening the hand quickly can move the fingertip; watch for accidental throws.
- **Feeding and merging by hand:** check that `food.feedRadiusRadii` and `merge.overlapFactor`
  feel forgiving enough with real tracking jitter.
- **Performance on the installation PC.** Headless tests ran on software-emulated graphics,
  which says nothing about real frame rates. Check the "inference" and "render" numbers in the
  setup preview. If the GPU struggles, try `tracking.delegate: 'CPU'` or a lower
  `render.maxPixelRatio`.
- **The INNOVA holographic capsule or immersive cylinder.** Nothing has been tested on that
  equipment. That includes black-background mode, safe margins, viewing distance, text size and
  camera placement relative to the display.
- Real fullscreen behaviour, multiple physical cameras, and unplugging a camera while running.
- Browsers other than Chrome (Edge should behave the same; Firefox and Safari are untested).
# squishy
