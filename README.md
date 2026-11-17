# Squishy's Playground

A touch-free interactive 3D experience for an INNOVA display at the University of Ottawa.

Squishy, a pink jelly creature, lives on the screen. Visitors move one hand in the air in front of
a webcam. Every interaction uses the same gesture: **move to aim, pinch to grab or select, let go**.

There are two ways to play:

1. **Free Play** (the default): toss, stretch, feed, pet and merge Squishy straight away.
2. **Play Together**: Squishy invites visitors with a big **"Play with me!"** bubble. Pinching it
   starts a short mini-game (**Squishy Says**, **Snack Surprise** or **Bubble Bounce**, in turn).
   After each round, visitors choose **Next game** or **Free play**.

Free Play:
- **Grab and stretch:** pinch Squishy to pick it up. It dangles, follows the hand with a jelly lag
  and stretches toward it.
- **Throw and bounce:** let go during a quick flick and it flies, bounces off the edges and settles.
- **Feed:** pinch a berry or fruit on the tray, bring it to Squishy's mouth and let go.
- **Pet:** move an open hand slowly back and forth above Squishy's head. It closes its eyes, leans
  into your hand and relaxes.
- **Mini me and Merge Magic:** pinch **"Mini me!"** to make three small Squishies. Drop one on
  another and they merge into a temporary **Star Jelly**, **Ocean Jelly** or **Galaxy Jelly**.
- **Two players:** up to two hands are followed at once, each with its own cursor (pink and mint).
  Two visitors (or one visitor with both hands) can each hold something: one holds Squishy while
  the other brings a snack, or each grabs a mini. Squishy says "Two friends!" when a second hand
  joins.
- **Squishy's memory:** Squishy has moods that build up as people play (Free Play only):
  - **Hungry:** hunger grows while someone plays. When hungry, Squishy looks at the tray and says
    "I'm hungry!" now and then. After two snacks in a row it is **full** and politely refuses
    ("I'm full!") for about 20 seconds.
  - **Favourite snack:** the snack it has eaten most (at least twice) becomes its favourite: "My
    favourite!" with a heart. Remembered until an operator Reset.
  - **Sleepy:** about six seconds of petting and it dozes off: eyes closed, swaying, snore bubbles.
    Picking it up or holding a snack to its mouth wakes it; otherwise it wakes by itself with a
    yawn after about nine seconds.
  - **Friends:** snacks, petting and tosses make it fond of the visitor. Once friends it says
    "You're my friend!", stops dodging, and says "You're back!" if the visitor returns within a
    few seconds. A new visitor starts over.

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
npm test             # unit tests (gesture logic, gameplay, playground, privacy checks)
```

On Windows, run the commands from a path that starts with an upper-case drive letter
(`C:\Users\...`, not `c:\Users\...`). With a lower-case drive letter Vitest loads itself twice
and every test file fails with `Cannot read properties of undefined (reading 'config')`. A new
PowerShell or Command Prompt window uses `C:` by default; some editor terminals use `c:`.

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
- [ ] **Display mode:** use **Hologram capsule** on the INNOVA holographic capsule (portrait UHD,
      2160 x 3840), and **Desktop preview** on a normal monitor. **Black background** is a plain
      black option without the hologram glow. See [Hologram capsule mode](#hologram-capsule-mode).
- [ ] **Fullscreen:** press **Fullscreen** (or F11), then close the panel.

## 4. How visitors interact

Guidance on screen (in English or French, see below):
- "Hi, I’m Squishy! Show one hand to play." appears until a hand is detected, with the animated
  pinch demonstration underneath.
- **Welcoming idle greeting:** when no hand has been seen for about 4 seconds, Squishy greets
  whoever walks past: a curious peek, a playful wiggle and a happy face (about 2.6 s), then a quiet
  pause (about 7 s), and again. It stops the moment a hand appears. The greeting is purely visual
  and silent: it never moves Squishy, changes what can be grabbed or affects the inactivity reset.
  With reduced motion the wiggle is small and slow, without the bob.
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
  there is no hunger, score or penalty.

General:
- If the hand is lost, the cursor fades, the pinch is cleared and "Show your hand again" appears.
- After about 30 seconds without movement or gestures, everything returns to the welcome state
  (Free Play, default arrangement) for the next visitor. A hand held still does not keep it
  active. **A mini-game round is never reset while a hand is still in view** (someone may be
  watching Squishy Says): the reset waits until the visitor has left. A round with nobody in
  view for about 9 seconds ends gently and Free Play resumes.
- Touching the screen does nothing except show "No need to touch the screen."

### Squishy's Playground

Only one short instruction shows at a time, at the top, in English or French. Every activity also
works with the sound off: each sound has a visible counterpart (a speech bubble, a face, a glow or
a pop).

**Squishy comes alive**
- **Notices a new visitor:** when a hand appears, Squishy looks toward it, hops and says "Hi!".
- **Attract loop:** with nobody playing, the silent welcome greeting and pinch demonstration play.
  Both stop the moment a hand appears.
- **Readable reactions:** an excited face before a toss (while held and moving fast), delighted
  closed-eye chewing after a snack, and a goofy cross-eyed wobble after a missed bubble or a wrong
  answer.

**Free Play extras**
- **"Play with me!"**: a big, glowing, pink bubble on the right that appears a few seconds after
  someone starts playing (or after their first pinch). Squishy glances at it now and then.
- **"Mini me!"**: a smaller bubble on the left (only while there is a single Squishy). It splits
  Squishy into three minis without the operator panel. There are never more than three Squishies.
- **Merge Magic:** two minis merging reveal a temporary look for 12 seconds: **Star Jelly** (gold,
  with a star), **Ocean Jelly** (blue, with a water drop) or **Galaxy Jelly** (violet, with a
  moon). Each look has its name in a speech bubble, a small burst and drifting sparkles. The same
  pair of minis always makes the same look, so visitors can hunt for all three.
- **Pet Squishy:** an open hand moving slowly back and forth above the head (at least two changes
  of direction, each a real stroke). A hand passing over once, or a fast swipe, does not count.
  Petting pauses while pinching or carrying food. Squishy does not dodge a hand hovering above its
  head.
- **Tips:** short discovery tips appear one at a time, each once per visitor (play a game, pet me,
  Mini me, drop one mini on another).

**Play Together mini-games** (each module is separate and reuses the same input and game logic)

| Game | How it plays |
|---|---|
| **Squishy Says** | Three bubbles: a gold **star**, a pink **heart** and a blue **triangle** (different shapes, not only colours). Squishy looks at a bubble, then it lights up with a note. The visitor pinches the same bubble. Levels go 1, then 2, then 3 bubbles in a row. A wrong bubble gets "Oops!", a goofy wobble and a replay of the same sequence, never a failure screen. No answer for 12 seconds also replays the sequence. Squishy cannot be grabbed during this game, so pinches only answer. |
| **Snack Surprise** | Squishy's thought bubble shows the snack it wants. Feeding the matching snack unlocks its effect: **strawberry** = a happy wiggle with hops and hearts, **yellow fruit** = a quick, smooth colour change to sunny yellow, **blueberry** = three hiccups. A wrong snack gets "Nope!" and a head shake, and the snack glides back to the tray. Three snacks per round. |
| **Bubble Bounce** | A big floating bubble appears close above Squishy. Grab Squishy and **toss** it through the bubble: an obvious pop, a ring burst and "Pop!". Three bubbles per round, each a little smaller and further away. Only a real toss counts. A slow drop inside the bubble does not pop it ("Let go while moving to toss!"). **If the hand is lost while carrying Squishy, it is let go gently and counts as neither a hit nor a miss.** A missed toss gets "So close!" and a goofy wobble. |

Each round ends with a short celebration ("You did it!", hops and a few stars), then **Next game**
(it shows the next game's name) and **Free play** bubbles. Without a choice, Free Play resumes
after 12 seconds. A small **Stop** bubble at floor level on the right leaves a round early.

**Secret reactions** (each with a cooldown, so they stay special)
- **Dizzy:** spiral eyes and "Whoaaa…" after a big bounce (three or more bounces, or a hard impact).
  Cooldown 25 s.
- **Heart bubble:** after about two seconds of petting, a heart floats up. Cooldown 18 s.
- **Giggle:** "Hee hee!" after being held stretched (for example pulled down against the floor) for
  about 1.5 s. Cooldown 25 s.

### Language and sound buttons (visitor)

Two small buttons sit in the bottom-right corner of the safe area. They are ordinary buttons for
a mouse, a touch or the keyboard (Tab, then Enter or Space). They are never treated as a pinch,
even in mouse test mode.

| Button | What it does |
|---|---|
| **EN / FR** | Switches every visitor text at once (welcome, pinch demonstration, snack hint, mini-game instructions, bubble labels, Squishy's speech bubbles, "Show your hand again", touch reminder, privacy note), including in the middle of a round. The game and camera keep running. The choice is remembered. The operator panel stays in English. |
| **Sound** | Turns the sound effects on or off. The choice is remembered. Keyboard shortcut: **M**. |

About the sounds:
- Short, soft, cute effects for grabbing, dropping, throwing, bouncing, feeding and merging. No
  background music, and the idle greeting is silent. They are synthesized live with Web Audio:
  there are no audio files and nothing is downloaded.
- **Muted the first time.** Browsers only allow audio after a click or a key press, and a webcam
  gesture does not count. If sound was left on in an earlier session, the button reads
  "Click for sound" until someone clicks anywhere or presses a key once. For an installation,
  the operator does this once after starting the browser.
- Bounces are rate-limited and overlapping sounds are capped, so a bouncing Squishy stays quiet.
- Sounds stop at once when muted or when the page is hidden. If the browser has no Web Audio,
  the button reads "No sound" and the game carries on.

## 5. Operator controls

| Control | What it does |
|---|---|
| Enable / Disable camera | Requests permission and starts tracking / stops every camera track |
| Camera | Choose among multiple webcams |
| Fullscreen | Toggles fullscreen (shows a message if the browser refuses) |
| Reset | Restores the default arrangement, colours, sizes and food, and clears any held object or animation |
| Split demo | Demonstration only: splits a single resting Squishy into three small ones. Visitors cannot trigger this |
| Start with three small Squishies | Makes the default arrangement (start, Reset and inactivity reset) three small Squishies, so merging can be tried straight away |
| Mode | Desktop preview (dark scene with a soft floor shadow), Black background (pure black, no floor) or Hologram capsule (pure black, native 4K portrait, glow) |
| Mirror tracking | Reverses horizontal hand mapping |
| Reduced motion | Follows the OS setting by default. Gentler movement and fewer dodges when on |
| Safe margins | Shrinks the usable area per side to fit the real display |
| Show setup preview | Mirrored camera image with hand landmarks, input region and live diagnostics. Operator only |
| Two players | On by default. Follows up to two hands, each with its own cursor. Turn off to follow only one hand (for example if passers-by behind the visitor keep becoming a second player) |
| Mouse test mode | The mouse moves the cursor and a click is a pinch, using the same gameplay logic. The whole experience (Free Play, every mini-game, petting by moving the mouse over Squishy's head) can be tested without a webcam. **Hold Shift** to move player 2's cursor instead (player 1's stays where it was), to test two players. Moving the mouse out of the window counts as losing the hand. Never switched on automatically |
| Start a game | Squishy Says, Snack Surprise or Bubble Bounce, straight away (for testing and demonstrations) |

Keyboard: **O** opens or closes the operator panel, **M** toggles sound.

Settings (not camera data), including the visitor language and sound choice, are saved in the
browser's local storage. URL overrides:
`?display=black`, `?display=desktop`, `?display=hologram`, `?mirror=0`, `?mirror=1`,
`?lang=en`, `?lang=fr`.

### Hologram capsule mode

For the INNOVA holographic capsule, whose screen is **portrait UHD (2160 x 3840)**. In the capsule,
black shows as empty space, so this mode is built to make Squishy look lit from within and floating:

- **Native UHD frame.** The scene renders at 2160 x 3840 device pixels whatever the Windows display
  scaling (100 %, 150 % or 200 %). It ignores `render.maxPixelRatio`.
- **Pure black background**, no floor shadow and a darker food tray, so nothing lights up the
  "empty" space.
- **Glow:** a bloom pass plus a stronger self-glow and rim light keep the silhouette clear against black.
- **Larger visitor text**, because the capsule is viewed from further away.

To set it up: open the app on the capsule PC with `?display=hologram` (or choose **Hologram
capsule** in the operator panel), press **Fullscreen**, then turn on **Show setup preview**. The
last diagnostics line should read `output: 2160 x 3840 px (UHD portrait)`. If it shows another
size, the window is not fullscreen or Windows has the screen set to landscape.

The glow is tuned in `hologram.*` in `src/config.ts`. Use `bloomStrength` for more or less halo,
`bloomThreshold` to choose how bright something must be before it glows, and `exposure` for
overall brightness.

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
| Number of players | `tracking.maxPlayers` (the operator panel's Two players box limits it to one) |
| **Squishy's memory** | `playground.memory.*`: hunger rate and thresholds (`hungerRiseS`, `hungryAt`, `fullAt`, `fullUntil`, `hungerNagS`), sleep (`petToSleepS`, `sleepMaxS`), friendship (`fondFeed`, `fondPetPerS`, `friendAt`, `welcomeBackMs`), favourite snack (`favouriteAfter`) |
| Dodging | `dodge.chance`, `distanceRadii`, `cooldownMs`, `maxConsecutive`, `catchWindowMs` |
| Inactivity reset | `activity.inactivityMs` |
| Idle greeting timing and wiggle | `idle.greetDelayMs`, `idle.greetMs`, `idle.pauseMs`, `idle.wiggleLean`, `idle.wiggleHz` (and the `reduced…` values) |
| Sound volume and limits | `sound.masterVolume`, `sound.maxVoices`, `sound.minIntervalMs`, `sound.minBounceStrength`, `sound.bouncesPerSecond` |
| Floor height, default safe margins, camera perspective | `stage.*` |
| Render quality and rate | `render.maxPixelRatio`, `render.maxFps` |
| Hologram capsule resolution, glow, brightness, tray colour | `hologram.*` |
| Reduced-motion behaviour | `reducedMotion.*` |
| "Play with me" timing, bubble sizes and hit areas | `playground.inviteAfterMs`, `inviteGlanceMs`, `playBubbleRadii`, `smallBubbleRadii`, `bubbleHitScale` |
| Round timing (celebration, choice, abandon) | `playground.celebrateMs`, `betweenMs`, `abandonMs` |
| Squishy Says levels and pace | `playground.says.levels`, `lookMs`, `litMs`, `gapMs`, `replayAfterMs` |
| Snack Surprise | `playground.snack.requests`, `effectMs` |
| Bubble Bounce target sizes and how forgiving a hit is | `playground.bounce.targetRadii`, `hitPadSizes` |
| Petting sensitivity | `playground.pet.*` (zone, `minStrokeSizes`, `maxSpeedSizes`, `reversalsToStart`) |
| Secret reactions and cooldowns | `playground.secrets.*` |
| Merge Magic duration, maximum Squishies | `playground.magicMs`, `merge.maxCreatures` |
| Particle burst size | `playground.burstParticles` (halved with reduced motion) |

Shape and face details:
- Body shape, highlights and materials: `src/creature/assets.ts`
- Eyes, mouth, cheeks and expressions: `src/creature/jellyView.ts` (`EXPRESSIONS` table)
- Food shapes and the tray: `src/creature/foodView.ts`; tray placement: `src/scene/stage.ts`
  (bottom-left in landscape, bottom-centre below the floor in portrait)
- Interaction logic and timing: `src/game/game.ts`, `src/game/creatureModel.ts`, `src/game/throw.ts`
- Visitor wording in both languages: `src/ui/i18n.ts`
- Sound recipes (pitches, lengths, volumes): `RECIPES` in `src/audio/sound.ts`
- Greeting choreography: `src/game/idleGreeting.ts`
- Mini-games and Free Play extras: `src/game/playground/` (one module each)
- Bubble symbols and particle shapes: `src/scene/symbols.ts`; their rendering: `src/scene/effectsLayer.ts`

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
  settings.ts               operator and visitor settings persistence (incl. language, sound)
  audio/sound.ts            Web Audio sound effects (synthesized, muted by default, rate-limited)
  scene/stage.ts            renderer, camera, lights, framing and safe margins
  creature/assets.ts        procedural geometry and materials (shared, created once)
  creature/jellyView.ts     one creature's meshes, eyes, expressions, stretch deformation
  creature/foodView.ts      procedural food items, tray and feed-ready ring
  game/game.ts              interaction state per player (none / creature / food), sequences
                            (split / merge), physics, feeding and dodging
  game/creatureModel.ts     per-creature animation state (springs, stretch, hops, blinking, tint)
  game/food.ts              food item state (tray, held, returning, eaten)
  game/throw.ts             robust release-velocity estimate
  game/activity.ts          inactivity detection
  game/idleGreeting.ts      visual-only welcoming greeting while nobody is playing
  game/anim.ts              frame-rate-independent springs and easing
  game/playground/
    playground.ts           Free Play extras and the Play Together flow (invite, round,
                            celebrate, next game / free play), greeting, tips
    squishySays.ts          Squishy Says
    snackSurprise.ts        Snack Surprise
    bubbleBounce.ts         Bubble Bounce
    petting.ts              petting detector (deliberate back-and-forth strokes)
    secrets.ts              secret reactions and their cooldowns
    memory.ts               Squishy's memory: hunger, sleep, fondness, favourite snack
    mergeMagic.ts           Merge Magic looks
    bubble.ts, types.ts     shared bubble model, layout helpers, scheduler
  scene/effectsLayer.ts     bubbles, particles, hearts and Merge Magic accessories
  scene/symbols.ts          canvas drawings of bubble symbols and particle shapes
  input/handTracker.ts      camera access, inference loop, error handling
  input/handInference.worker.ts   MediaPipe inference off the main thread
  input/handSelection.ts    stable hand selection, one followed hand per player
  input/pinch.ts            normalised pinch ratio and pinch state machine
  input/cursorMapper.ts     mirroring, input region, One Euro smoothing
  input/handPipeline.ts     landmarks -> cursor and pinch events
  input/inputHub.ts         shared cursor state for hand and mouse modes
  ui/                       visitor overlay, visitor buttons (EN/FR, sound), i18n strings,
                            operator panel, setup preview
tests/                      unit tests (Vitest)
scripts/setup-assets.mjs    copies the runtime and downloads the model
```

## 10. What was verified, and what still needs real testing

**Two players and Squishy's memory: verified on the development PC (2026-11-11):**
- `npm run build` succeeds and **161 unit tests pass** (the 139 below plus 22 in
  `tests/memoryAndPlayers.test.ts`): two hands tracked as two players without sharing or stealing
  a hand, separate pinches per hand, one player holding Squishy while the other carries a snack,
  each player holding their own mini, a lost hand dropping only that player's item, "Two
  friends!", hunger and its reminders, full and refusing, the favourite snack, falling asleep and
  waking, friendship, "You're back!", and moods pausing during mini-games.
- A headless-Chrome check in **mouse test mode** on the production build: both cursors appear,
  player 2 (Shift) grabs Squishy while player 1 holds a snack, both release, turning Two players
  off hides cursor 2. No console errors.

**Not yet verified:** two real hands or two real visitors in front of the webcam. Still to check:
whether a passer-by's hand behind the visitor becomes an unwanted player 2 (turn **Two players**
off if so); whether two people standing close together keep their own cursors; whether the mint
cursor is readable through the capsule glass; and whether the memory timings (hunger every
~90 s, sleep after ~6 s of petting) feel right for typical visit lengths.

**Squishy's Playground: verified on a development PC (Windows 11, Node 24, Chrome, Intel Arc GPU):**
- `npm run build` succeeds and **139 unit tests pass** (the 104 below plus 35 in
  `tests/playground.test.ts`, all with simulated input):
  - a full **Squishy Says** round from the invitation bubble: title, "Watch", three levels
    (1, 2, 3 bubbles), celebration, the Next game / Free play choice and the return to Free Play
  - Squishy looks at each bubble before it lights; a wrong answer is silly and replays the same
    sequence; the Stop bubble works
  - **Snack Surprise:** the thought bubble shows the wanted snack, the right snack plays three
    different effects, a wrong snack is refused and returns to the tray, and Free Play feeding is
    unchanged
  - **Bubble Bounce:** tosses pop all three bubbles; a lost hand while carrying Squishy through the
    bubble is not a throw, a hit or a miss; a slow drop does not pop; a missed toss is goofy
  - **Petting** starts only with deliberate strokes, not a single pass or a fast swipe, pauses
    while pinching or holding food, and Squishy does not dodge a hand above its head
  - **Mini me**, the three-Squishy cap, and **Merge Magic** (look, name, expiry)
  - **Secrets** (dizzy, heart, giggle) and their cooldowns; the new-visitor greeting
  - every bubble stays inside the safe area on a narrow portrait (capsule) layout and in
    landscape; a pinch on a bubble never also grabs Squishy or food
- **Headless Chrome on the production build, in mouse test mode** (45 checks, real GPU, using the
  operator panel's mouse mode as an operator would):
  - the visitor flow: attract, "Hi!", "Play with me!", a full Squishy Says round with a deliberate
    mistake, a **language switch mid-round**, Snack Surprise with a refused snack, Bubble Bounce
    with **tracking loss during a grab** (mouse leaving the window), three pops, back to Free
    Play, petting with the heart secret, Mini me and Star Jelly
  - **reset after inactivity** (31 s), **no reset mid-round while a visitor is present** (32 s),
    then the reset once the visitor leaves
  - **narrow portrait layouts** (450 x 800 in Black background, and 1080 x 1920 in Hologram
    capsule, which is 2160 x 3840 at 200 % Windows scaling): every bubble, French label and the
    visitor buttons stay inside the safe area and clear of the snack tray; the hologram background
    is pure black
  - reduced motion follows the OS setting and halves particle bursts
  - no console errors
  - The browser checks use synthetic pointer events, so the throw tests show that tossing works
    with a mouse, not with a hand.

**Original sandbox: verified earlier on the same PC:**
- `npm run build` (TypeScript strict type-check plus production build) succeeds.
- 104 unit tests pass (`npm test`). They use **simulated cursor input and synthetic landmark data,
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
  - **Language:** English by default, French remembered across reloads, invalid values ignored,
    `?lang=` override, and every string present in both languages.
  - **Sound** (with a fake audio context): muted on first use, no audio context before a user
    action, muting and hiding the page stop every sound, bounce rate-limit, voice cap, no crash
    without Web Audio, and disposal closes the context.
  - **Idle greeting:** starts after the delay, alternates with pauses, stops on the frame a hand
    appears, is smaller with reduced motion, and leaves positions, hit areas, game state and events
    untouched (a grab works normally right after).
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
- **Squishy's Playground with real hands.** Still to check: whether visitors find "Play with me!"
  without help; whether Squishy Says bubbles are easy to pinch from 1 to 2.5 m
  (`playground.bubbleHitScale`); whether Bubble Bounce tosses hit often enough
  (`playground.bounce.hitPadSizes`, `targetRadii`, and the throw settings below); whether petting
  triggers for a natural slow wave but not for passers-by (`playground.pet.*`); and whether
  "Mini me!" gets pinched by accident when reaching for Squishy.
- **The playground on the capsule.** Still to check: the bubble glow and "Play with me!" halo
  through the capsule glass (bloom can make them very bright); the Merge Magic colours under bloom
  (the gold Star Jelly can wash out the face); whether the coach line and speech bubbles are
  readable from the visitor's distance; the new sounds on the installation speakers; and frame
  rate with bubbles and particles at 4K.
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
- **The INNOVA holographic capsule.** Hologram mode was only checked in headless Chrome at
  2160 x 3840 with software graphics: it renders a full UHD frame, and the glow was tuned by eye on
  screenshots. Nothing has run on the capsule itself. Still to check there: how the glow and
  brightness look through the capsule glass, frame rate at 4K with bloom (lower `bloomStrength`
  or switch to **Black background** if it struggles), safe margins, text size, viewing distance
  and camera placement.
- Real fullscreen behaviour, multiple physical cameras, and unplugging a camera while running.
- Browsers other than Chrome (Edge should behave the same; Firefox and Safari are untested).
- **Language, sound and greeting in a real browser.** These were added after the headless-Chrome
  runs above and are covered by unit tests only. Still to check by eye and ear: the sounds on the
  installation speakers (volume in `sound.masterVolume`), the "Click for sound" unlock, the
  greeting's look, and that the EN / FR and sound buttons are readable, reachable and inside the
  visible area of the capsule (they follow the safe margins). Check that the longer French texts
  fit on the portrait display.
# squishy
