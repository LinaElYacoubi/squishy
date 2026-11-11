/** Visitor-facing text in English and French. Operator controls stay in English. */

export type Language = 'en' | 'fr';

export const LANGUAGES: readonly Language[] = ['en', 'fr'];

/** Key of a visitor string (used by the playground so text re-renders on a language switch). */
export type TextKey = keyof VisitorStrings;

export function isLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'fr';
}

export interface VisitorStrings {
  /** The one gesture, used as title or subtitle of the main prompt. */
  instruction: string;
  /** Welcome shown while nobody is playing. */
  welcome: string;
  waitingSub: string;
  unavailableSub: string;
  demoCaption: string;
  demoLabel: string;
  /** Shown briefly when the tracked hand is lost. */
  lostHint: string;
  snackHint: string;
  touchHint: string;
  privacy: string;
  languageGroup: string;
  soundOff: string;
  soundOn: string;
  /** Sound is on but the browser needs one click or key press before it may play. */
  soundLocked: string;
  soundUnavailable: string;
  soundTitleOff: string;
  soundTitleOn: string;

  // ---- Squishy's Playground (one short line at a time)
  /** Big invitation bubble in Free Play. */
  playWithMe: string;
  /** Small bubble that splits Squishy into minis. */
  makeMinis: string;
  /** Between rounds: go back to Free Play. */
  freePlay: string;
  /** Between rounds: play the next game. */
  playAgain: string;
  /** Small bubble during a round to stop and go back to Free Play. */
  stopGame: string;
  gameSays: string;
  gameSnack: string;
  gameBounce: string;
  /** Shown above "Play with me" when Squishy invites. */
  inviteCoach: string;
  saysWatch: string;
  saysYourTurn: string;
  saysYourTurnMany: string;
  saysOops: string;
  saysNice: string;
  snackWant: string;
  snackNope: string;
  snackYum: string;
  bounceToss: string;
  bounceLetGo: string;
  bounceMiss: string;
  bounceNext: string;
  celebrate: string;
  between: string;
  /** Discovery tips, shown one at a time in Free Play. */
  tipPet: string;
  tipMinis: string;
  tipMerge: string;
  // Squishy's speech bubbles (very short).
  sayHi: string;
  sayYes: string;
  sayOops: string;
  sayYay: string;
  sayNope: string;
  sayHic: string;
  sayWhoa: string;
  sayHeehee: string;
  sayYum: string;
  sayPop: string;
  // ---- Squishy's memory and two players
  sayHungry: string;
  sayFull: string;
  sayFavourite: string;
  sayZzz: string;
  sayYawn: string;
  sayFriend: string;
  sayBack: string;
  sayTwoFriends: string;
  lookStar: string;
  lookOcean: string;
  lookGalaxy: string;
}

// French uses a narrow no-break space before "!" and "?" so they never wrap onto their own line.
const NB = ' ';

export const STRINGS: Record<Language, VisitorStrings> = {
  en: {
    instruction: 'Pinch to grab. Move. Let go.',
    welcome: 'Hi, I’m Squishy! Show one hand to play.',
    waitingSub: 'Hand tracking is starting soon.',
    unavailableSub: 'Hand tracking is paused right now.',
    demoCaption: 'Pinch thumb and index finger',
    demoLabel: 'Demonstration: thumb and index finger close together in a pinch',
    lostHint: 'Show your hand again',
    snackHint: 'Try giving me a snack.',
    touchHint: 'No need to touch the screen. Move your hand in the air.',
    privacy:
      'Your camera is used for hand tracking. Video is processed in this browser and is not recorded or uploaded by this app.',
    languageGroup: 'Language',
    soundOff: 'Sound off',
    soundOn: 'Sound on',
    soundLocked: 'Click for sound',
    soundUnavailable: 'No sound',
    soundTitleOff: 'Turn sound on',
    soundTitleOn: 'Turn sound off',
    playWithMe: 'Play with me!',
    makeMinis: 'Mini me!',
    freePlay: 'Free play',
    playAgain: 'Next game',
    stopGame: 'Stop',
    gameSays: 'Squishy Says',
    gameSnack: 'Snack Surprise',
    gameBounce: 'Bubble Bounce',
    inviteCoach: 'Pinch the bubble to play a game.',
    saysWatch: 'Watch my bubbles!',
    saysYourTurn: 'Your turn! Pinch that bubble.',
    saysYourTurnMany: 'Your turn! Same order.',
    saysOops: 'Oops! Watch again.',
    saysNice: 'Yes! Now a longer one.',
    snackWant: 'Feed me the snack in my bubble.',
    snackNope: 'Not that one! Look at my bubble.',
    snackYum: 'Yum! Watch this…',
    bounceToss: 'Grab me and toss me into the bubble!',
    bounceLetGo: 'Now let go while moving to toss!',
    bounceMiss: 'So close! Try again.',
    bounceNext: 'Pop! Here comes another.',
    celebrate: 'You did it!',
    between: 'Another game, or free play?',
    tipPet: 'Psst… wave slowly over my head.',
    tipMinis: 'Pinch “Mini me!” to make little Squishies.',
    tipMerge: 'Drop one mini on another!',
    sayHi: 'Hi!',
    sayYes: 'Yes!',
    sayOops: 'Oops!',
    sayYay: 'Yay!',
    sayNope: 'Nope!',
    sayHic: 'Hic!',
    sayWhoa: 'Whoaaa…',
    sayHeehee: 'Hee hee!',
    sayYum: 'Yum!',
    sayPop: 'Pop!',
    sayHungry: "I'm hungry!",
    sayFull: "I'm full!",
    sayFavourite: 'My favourite!',
    sayZzz: 'Zzz…',
    sayYawn: '*Yawn* Hi again!',
    sayFriend: "You're my friend!",
    sayBack: "You're back!",
    sayTwoFriends: 'Two friends!',
    lookStar: 'Star Jelly!',
    lookOcean: 'Ocean Jelly!',
    lookGalaxy: 'Galaxy Jelly!',
  },
  fr: {
    instruction: 'Pince pour attraper. Bouge. Lâche.',
    welcome: `Salut, moi c’est Squishy${NB}! Montre une main pour jouer.`,
    waitingSub: 'Le suivi de la main va bientôt démarrer.',
    unavailableSub: 'Le suivi de la main est en pause pour le moment.',
    demoCaption: 'Rapproche le pouce et l’index',
    demoLabel: 'Démonstration : le pouce et l’index se rapprochent pour pincer',
    lostHint: 'Montre encore ta main',
    snackHint: 'Essaie de me donner à manger.',
    touchHint: 'Pas besoin de toucher l’écran. Bouge ta main dans l’air.',
    privacy:
      'La caméra sert à suivre ta main. La vidéo est traitée dans ce navigateur. Cette application ne l’enregistre pas et ne l’envoie nulle part.',
    languageGroup: 'Langue',
    soundOff: 'Son coupé',
    soundOn: 'Son activé',
    soundLocked: 'Clique pour le son',
    soundUnavailable: 'Pas de son',
    soundTitleOff: 'Activer le son',
    soundTitleOn: 'Couper le son',
    playWithMe: `Joue avec moi${NB}!`,
    makeMinis: `Mini-moi${NB}!`,
    freePlay: 'Jeu libre',
    playAgain: 'Autre jeu',
    stopGame: 'Arrêter',
    gameSays: 'Squishy dit',
    gameSnack: 'Collation surprise',
    gameBounce: 'Éclate-bulles',
    inviteCoach: 'Pince la bulle pour jouer à un jeu.',
    saysWatch: `Regarde mes bulles${NB}!`,
    saysYourTurn: `À toi${NB}! Pince cette bulle.`,
    saysYourTurnMany: `À toi${NB}! Dans le même ordre.`,
    saysOops: `Oups${NB}! Regarde encore.`,
    saysNice: `Oui${NB}! Maintenant, une plus longue.`,
    snackWant: 'Donne-moi la collation dans ma bulle.',
    snackNope: `Pas celle-là${NB}! Regarde ma bulle.`,
    snackYum: `Miam${NB}! Regarde bien…`,
    bounceToss: `Attrape-moi et lance-moi dans la bulle${NB}!`,
    bounceLetGo: `Lâche-moi en bougeant pour me lancer${NB}!`,
    bounceMiss: `Presque${NB}! Essaie encore.`,
    bounceNext: `Pop${NB}! En voici une autre.`,
    celebrate: `Tu as réussi${NB}!`,
    between: `Un autre jeu ou du jeu libre${NB}?`,
    tipPet: 'Psst… passe doucement ta main au-dessus de ma tête.',
    tipMinis: `Pince «${NB}Mini-moi${NB}!${NB}» pour faire des petits Squishy.`,
    tipMerge: `Dépose un mini sur un autre${NB}!`,
    sayHi: `Salut${NB}!`,
    sayYes: `Oui${NB}!`,
    sayOops: `Oups${NB}!`,
    sayYay: `Youpi${NB}!`,
    sayNope: `Non merci${NB}!`,
    sayHic: `Hic${NB}!`,
    sayWhoa: 'Ouhhh…',
    sayHeehee: `Hi hi${NB}!`,
    sayYum: `Miam${NB}!`,
    sayPop: `Pop${NB}!`,
    sayHungry: `J'ai faim${NB}!`,
    sayFull: `Je n'ai plus faim${NB}!`,
    sayFavourite: `Mon préféré${NB}!`,
    sayZzz: 'Zzz…',
    sayYawn: `*Bâille* Re-bonjour${NB}!`,
    sayFriend: `On est amis${NB}!`,
    sayBack: `Te revoilà${NB}!`,
    sayTwoFriends: `Deux amis${NB}!`,
    lookStar: `Gelée étoilée${NB}!`,
    lookOcean: `Gelée océane${NB}!`,
    lookGalaxy: `Gelée galactique${NB}!`,
  },
};
