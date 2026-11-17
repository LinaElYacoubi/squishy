/**
 * All important tuning values live here.
 *
 * Distances marked "world" are in Three.js units on the creature plane (z = 0).
 * Screen fractions are relative to the safe area (the display area inside the safe margins).
 */

export const CONFIG = {
  /** Creature appearance and size. */
  creature: {
    /** Main body colour, plus one colour per mini-creature (pink / violet range). */
    mainColor: '#ff6fcf',
    miniColors: ['#ff7ad9', '#b77bff', '#ff8fb8'],
    /** Main creature radius as a fraction of the smaller safe-area dimension. */
    mainRadiusFraction: 0.2,
    /** Gloss and softness of the jelly material. */
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.8,
    sheenColor: '#ffd6f4',
    /** Soft self-glow so the body keeps its volume on a pure black background. */
    emissiveStrength: 0.08,
  },

  stage: {
    /** The floor sits this fraction of the safe height above the safe-area bottom (landscape). */
    floorFraction: 0.1,
    /** Higher floor for portrait displays, so the creature is not stranded at the bottom edge. */
    floorFractionPortrait: 0.27,
    /** Default display safe margins as fractions of the viewport (operators can change these live). */
    defaultSafeMargins: { top: 0.06, right: 0.05, bottom: 0.06, left: 0.05 },
    /** Mild perspective. */
    cameraFov: 30,
    cameraDistance: 14,
  },

  /** Hit testing. A creature can be grabbed when the cursor is within its radius times hitScale. */
  hit: {
    hitScale: 1.35,
    /** Minimum hit radius as a fraction of the smaller safe dimension, so small targets stay easy. */
    minHitFraction: 0.1,
    /**
     * The index fingertip drifts toward the thumb while pinching. A grab also counts if the
     * cursor overlapped the target within this many ms before the pinch registered.
     */
    pinchHistoryMs: 180,
    /** Cursor history kept in memory (must cover pinchHistoryMs and the throw window). */
    historyMs: 320,
  },

  /** Cursor mapping and smoothing (One Euro filter; lower minCutoff = smoother, higher beta = less lag). */
  cursor: {
    /**
     * Part of the camera image (normalised 0..1, after mirroring) that maps onto the whole
     * safe area, so visitors can reach the edges without moving their hand out of view.
     */
    inputRegion: { xMin: 0.18, xMax: 0.82, yMin: 0.14, yMax: 0.78 },
    minCutoff: 1.4,
    beta: 2.5,
    derivativeCutoff: 1.0,
    /** Mirror horizontally by default so movement feels natural to someone facing the camera. */
    mirrorByDefault: true,
  },

  /** Pinch detection. Ratios are thumb-tip/index-tip distance divided by palm length. */
  pinch: {
    /** Below this ratio the hand counts as pinched. */
    pinchThreshold: 0.3,
    /** Above this ratio the hand counts as open again. Must be larger than pinchThreshold. */
    releaseThreshold: 0.48,
    /** Consecutive inference frames needed before a change of state is accepted. */
    stableFrames: 2,
    /** Minimum time between two pinch events. */
    cooldownMs: 350,
  },

  /** Hand tracking and selection. */
  tracking: {
    /** Hand inference rate, independent of the render rate. */
    inferenceHz: 30,
    /**
     * MediaPipe delegate. 'GPU' is usually fastest; 'CPU' avoids competing with the 3D scene for
     * the GPU on weaker machines. If GPU setup fails, CPU is used automatically.
     */
    delegate: 'GPU' as 'GPU' | 'CPU',
    /**
     * Detect up to this many hands. With two players on, each followed hand is a player;
     * with two players off, the extra detections only help keep following the same hand.
     */
    maxHands: 2,
    /** Most players (followed hands, one cursor each). The operator panel can limit this to one. */
    maxPlayers: 2,
    minDetectionConfidence: 0.6,
    minPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
    /** Frames a new hand must be seen before it is accepted. */
    acquireFrames: 3,
    /** Missing detections shorter than this are bridged without dropping the hand. */
    lostGraceMs: 250,
    /** Largest frame-to-frame palm movement accepted, in palm lengths (plus a small absolute floor). */
    maxJumpPalms: 2.2,
    maxJumpMin: 0.08,
    /** If the second-closest candidate is within this factor of the closest, selection is ambiguous. */
    ambiguityRatio: 1.6,
    /** Camera request. Lower resolution keeps inference fast. */
    videoWidth: 640,
    videoHeight: 480,
  },

  /** Playful dodging. Distances are in main-creature radii. */
  dodge: {
    /** The creature considers dodging when the cursor comes within this many radii. */
    triggerRadii: 2.0,
    distanceRadii: 1.7,
    hopHeightRadii: 0.6,
    chance: 0.75,
    cooldownMs: 1400,
    /** After this many dodges in a row the creature stays put and offers a clear chance to grab it. */
    maxConsecutive: 2,
    catchWindowMs: 5000,
    /** The streak resets when the cursor stays away this long. */
    streakResetMs: 3500,
    /** No dodging just after a hand appears, so newcomers get an easy first try. */
    graceAfterAcquireMs: 2500,
  },

  /** Grab and stretch. Distances in the grabbed creature's radii unless noted. */
  grab: {
    /** How strongly the body follows the hand (higher = less lag). */
    followStiffness: 70,
    /** Lower = more jelly overshoot while following. */
    followDamping: 11,
    /** The body hangs this far below the grab point, so a held Squishy dangles and stretches a little. */
    sagRadii: 0.22,
    /** Stretch strength: how much stretch per radius of lag between body and hand. */
    stretchGain: 1.1,
    /** Maximum stretch (0.45 = 45 % longer). The perpendicular squeeze follows from volume. */
    maxStretch: 0.45,
    /** Maximum squeeze during the release wobble. */
    maxCompress: 0.25,
    /** Grab points further from the centre than this are pulled in (keeps stretching symmetric). */
    maxGrabOffsetRadii: 0.8,
  },

  /** Throwing. Speeds are in main-creature radii per second. */
  throw: {
    /** Cursor history used to estimate the release velocity. */
    windowMs: 120,
    /**
     * Ignore the last moments before the release: the index fingertip moves when the pinch opens,
     * which would otherwise look like a flick. About one camera frame.
     */
    ignoreLastMs: 40,
    /** Slower releases are gentle drops, not throws. Raise to make throwing harder. */
    minSpeedRadii: 7,
    /** Cap on throw speed. */
    maxSpeedRadii: 16,
    /** Multiplier from hand speed to creature speed. */
    scale: 0.75,
    /** Single cursor jumps faster than this are tracking glitches and are ignored. */
    spikeSpeedRadii: 70,
    /** Gravity in radii per second squared. */
    gravityRadii: 28,
    /** Bounciness of floor and walls (0..1). */
    floorRestitution: 0.55,
    wallRestitution: 0.6,
    /** Horizontal speed kept on each floor bounce. */
    floorFriction: 0.8,
    /** Impacts slower than this stop bouncing. */
    settleSpeedRadii: 2.2,
    /** Impacts faster than this make the creature blink in surprise. */
    surpriseImpactRadii: 6,
  },

  /** Merging small Squishies. */
  merge: {
    /** Creatures smaller than this (in main radii) count as small and can be dragged into others. */
    smallBelowRadii: 0.95,
    /** Merge when the bodies overlap: centre distance below this fraction of the sum of their radii. */
    overlapFactor: 0.85,
    /** The drag must last at least this long to count as deliberate. */
    minHoldMs: 250,
    /** Merged size never exceeds this many main radii. */
    maxRadii: 1.15,
    durationMs: 450,
    /** Never more than this many Squishies on screen (split makes exactly three). */
    maxCreatures: 3,
  },

  /** Squishy's Playground: Free Play extras, Play Together mini-games and secret reactions. */
  playground: {
    /** "Play with me" appears this long after a visitor starts playing (or right after their first pinch). */
    inviteAfterMs: 3500,
    /** Squishy glances at the "Play with me" bubble this often in Free Play. */
    inviteGlanceMs: 14000,
    /** Bubble sizes in main radii (hit areas are at least hit.minHitFraction). */
    playBubbleRadii: 0.62,
    smallBubbleRadii: 0.42,
    /** Bubble hit area relative to its drawn radius (generous for hand tracking). */
    bubbleHitScale: 1.2,
    /** After a round: the choice stays up this long, then Free Play resumes on its own. */
    betweenMs: 12000,
    /** A round ends gently (back to Free Play) when no hand has been seen for this long. */
    abandonMs: 9000,
    celebrateMs: 2600,
    /** Squishy Says: sequence lengths per level, and timing of each light-up step. */
    says: {
      levels: [1, 2, 3],
      lookMs: 550,
      litMs: 750,
      gapMs: 300,
      /** No answer for this long: show the sequence again. */
      replayAfterMs: 12000,
    },
    /** Snack Surprise: snacks asked for per round, and how long each effect plays. */
    snack: {
      requests: 3,
      effectMs: 2600,
    },
    /** Bubble Bounce: target sizes (main radii) for each pop in a round, largest first. */
    bounce: {
      targetRadii: [1.45, 1.2, 1.0],
      /** The bubble pops when the body centre comes within (radius + this x body size). */
      hitPadSizes: 0.45,
    },
    /** Merge Magic: how long a special look lasts. */
    magicMs: 12000,
    /** Petting: open hand moving back and forth slowly above the head. */
    pet: {
      /** Zone above the head, in body sizes. */
      zoneHalfWidthSizes: 1.25,
      zoneLowSizes: 0.35,
      zoneHighSizes: 2.4,
      /** A stroke must travel at least this far (body sizes) before turning back. */
      minStrokeSizes: 0.3,
      /** Strokes faster than this (body sizes per second) are a hand passing by, not petting. */
      maxSpeedSizes: 9,
      /** Direction changes needed within strokeWindowMs before petting starts. */
      reversalsToStart: 2,
      strokeWindowMs: 2600,
      /** Petting continues this long after the last stroke. */
      lingerMs: 900,
    },
    /** Secret reactions and their cooldowns. */
    secrets: {
      dizzyMinBounces: 3,
      dizzyMinImpact: 0.7,
      dizzyCooldownMs: 25000,
      heartAfterPetMs: 2200,
      heartCooldownMs: 18000,
      giggleStretch: 0.3,
      giggleHoldMs: 1500,
      giggleCooldownMs: 25000,
    },
    /** Particle bursts are kept small; reduced motion halves them. */
    burstParticles: 10,
    /**
     * Squishy's memory (Free Play only): moods that build up over a session. Kept in memory
     * only; nothing about visitors is stored.
     */
    memory: {
      /** Hunger (0..1) at start and after an operator reset: a little peckish. */
      startHunger: 0.5,
      /** Seconds for hunger to rise from 0 to 1 while someone is playing. */
      hungerRiseS: 90,
      /** Each snack lowers hunger by this much (a favourite snack counts a bit more). */
      feedSatisfies: 0.25,
      favouriteBonus: 0.1,
      /** At or above this, Squishy asks for food now and then. */
      hungryAt: 0.65,
      /**
       * At or below this after a snack, Squishy is full and politely refuses snacks, until hunger
       * climbs back to fullUntil (about 18 s at the rise rate above).
       */
      fullAt: 0.02,
      fullUntil: 0.2,
      /** Seconds between "I'm hungry!" reminders. */
      hungerNagS: 14,
      /** Seconds of petting that make Squishy doze off. */
      petToSleepS: 6,
      /** Sleepiness fades this much per second when not being petted. */
      sleepDecayPerS: 0.06,
      /** A dozing Squishy wakes up by itself after this long. */
      sleepMaxS: 9,
      /** Seconds between snore bubbles while asleep. */
      snoreEveryS: 1.6,
      /** Fondness gained per snack, per second of petting and per toss (0..1 scale, per visitor). */
      fondFeed: 0.2,
      fondPetPerS: 0.06,
      fondToss: 0.05,
      /** At or above this, Squishy considers the visitor a friend: no more dodging, follows the hand. */
      friendAt: 0.6,
      /** A friend who comes back within this long gets a "You're back!". */
      welcomeBackMs: 12000,
      /** Snacks of one kind needed before it becomes the favourite. */
      favouriteAfter: 2,
    },
  },

  /** Splitting (operator demonstration only). */
  split: {
    /** Smallest mini size as a fraction of the smaller safe-area dimension. */
    miniMinRadiusFraction: 0.095,
  },

  /** Feeding. */
  food: {
    colors: { berry: '#ff3b4f', fruit: '#ffc93c', blueberry: '#4a63e8' },
    /** Food radius in main-creature radii, with a minimum fraction of the smaller safe dimension. */
    radiusRadii: 0.32,
    minRadiusFraction: 0.055,
    /** Food hit area relative to its radius (generous so it is easy to pick up). */
    hitScale: 1.8,
    /** Feeding zone around the mouth, in the creature's radii. Larger = easier feeding. */
    feedRadiusRadii: 1.05,
    /** Creatures start watching food and opening their mouth within this multiple of the feeding zone. */
    noticeFactor: 2.4,
    returnMs: 500,
    respawnMs: 1600,
    chewMs: 900,
    /** Colour tint after eating, and how long it takes to fade. */
    tintAmount: 0.6,
    tintFadeMs: 3500,
    /** Puff-up impulse after eating. */
    puffKick: 1.7,
    /** Depth at which food is drawn in front of the creatures. */
    depth: 2.3,
  },

  /** Inactivity: without meaningful movement or gestures for this long, reset to the inviting idle state. */
  activity: {
    inactivityMs: 30000,
    /** Cursor must move this far (fraction of safe area) to count as activity. */
    moveThreshold: 0.035,
    /** Tracking lost for this long brings back the big "Show one hand" prompt. */
    lostPromptMs: 8000,
  },

  /** Visitor instructions. */
  ui: {
    /** The instruction fades after this much active interaction, or after the first pinch. */
    instructionFadeAfterMs: 5000,
    /** "Try giving me a snack." appears this long after the instruction fades, for snackHintMs. */
    snackHintDelayMs: 2500,
    snackHintMs: 6000,
  },

  /**
   * Welcoming idle greeting: after no hand has been seen for greetDelayMs, Squishy plays a short
   * visual-only greeting (wiggle, curious look, happy face) for greetMs, then rests for pauseMs.
   */
  idle: {
    greetDelayMs: 4000,
    greetMs: 2600,
    pauseMs: 7000,
    /** Wiggle amplitude (radians of lean) and speed; reduced motion uses the smaller values. */
    wiggleLean: 0.14,
    wiggleHz: 2.4,
    reducedWiggleLean: 0.04,
    reducedWiggleHz: 1.1,
  },

  /** Playful sound effects (Web Audio, synthesized locally). Muted until the visitor or operator turns them on. */
  sound: {
    /** Overall volume (0..1). Kept low: these are gentle cues, not music. */
    masterVolume: 0.22,
    /** At most this many tones play at once; extra sounds are skipped. */
    maxVoices: 6,
    /** Minimum time between two plays of the same sound. */
    minIntervalMs: {
      grab: 90,
      drop: 140,
      throw: 160,
      bounce: 120,
      feed: 260,
      merge: 320,
      select: 120,
      chime: 60,
      pop: 120,
      oops: 400,
      cheer: 800,
      hello: 1500,
      purr: 900,
      hiccup: 250,
      sparkle: 400,
      nope: 400,
      giggle: 600,
      dizzy: 800,
    },
    /** Bounces quieter than this (0..1) are silent; at most bouncesPerSecond bounce sounds per second. */
    minBounceStrength: 0.12,
    bouncesPerSecond: 4,
  },

  /** Rendering. */
  render: {
    maxPixelRatio: 1.75,
    /** Render frame-rate cap (independent of inferenceHz). 0 = follow the display refresh rate. */
    maxFps: 60,
    /** Clamp large frame gaps (e.g. after a tab switch) so animations never jump. */
    maxDeltaSeconds: 0.1,
  },

  /**
   * Hologram capsule mode: pure black (black reads as empty space in the capsule), a native
   * UHD frame and a soft glow so the creature looks lit from within and floats.
   */
  hologram: {
    /** Output frame in device pixels (portrait UHD). The long window edge is rendered at height. */
    width: 2160,
    height: 3840,
    /** Bloom glow. Raise strength for more halo; raise threshold so only the brightest parts glow. */
    bloomStrength: 0.4,
    bloomRadius: 0.35,
    bloomThreshold: 0.88,
    /** Brighter self-glow and fresnel rim so the silhouette holds up against black. */
    emissiveStrength: 0.12,
    rimStrength: 0.8,
    /** Rim light intensity (desktop uses 1.6). */
    rimLight: 2.2,
    exposure: 1.0,
    /** Food tray colour (the desktop lavender blooms into a white disc on black). */
    trayColor: '#5b4a80',
  },

  /** Reduced-motion overrides (applied when the OS asks for it, or the operator forces it). */
  reducedMotion: {
    dodgeChance: 0.35,
    dodgeMaxConsecutive: 1,
    dodgeDistanceScale: 0.6,
    hopHeightScale: 0.5,
    wobbleScale: 0.45,
    stretchScale: 0.6,
    throwSpeedScale: 0.6,
    restitutionScale: 0.6,
  },
} as const;

export type SafeMargins = { top: number; right: number; bottom: number; left: number };
