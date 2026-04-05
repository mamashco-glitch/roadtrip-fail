// --- Screen navigation ---
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// --- Game state ---
const state = {
  money: 100,
  cart: {},
  // travel state
  gas: 100,
  snacks: 0,
  morale: 100,
  progress: 0
};

const itemNames = {
  'snackies':    'Snackies',
  'giant-chips': 'Giant Chips',
  'burrito':     'Gas Station Burrito',
  'spare-tire':  'Spare Tire'
};

// Snacks added per food item purchased
const snackValue = {
  'snackies':    12,
  'giant-chips': 18,
  'burrito':     10
};

let gameInterval      = null;
let statusLockUntil   = 0; // timestamp — status msg is protected until this time
let snackHuntMilestone  = false; // flipped true once the guaranteed snack hunt fires
let trafficMilestone    = false; // flipped true once the guaranteed traffic game fires
let miniGamePaused      = false;
let debugSnackPreview   = false;
let debugTrafficPreview = false;

// Event pacing — tick-based so timer only runs during active driving
let eventTick       = 0;  // seconds elapsed since last event
let eventTickTarget = 16; // seconds until next event fires

// Shuffled deck — each event plays once before any repeats
let eventDeck      = []; // remaining indices in current shuffle
let lastEventIndex = -1; // last played index (used to avoid deck-seam repeats)

function shuffleDeck() {
  const indices = EVENTS.map((_, i) => i);
  // Fisher-Yates
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  // If top of new deck matches last played event, swap it with next card
  if (indices.length > 1 && indices[0] === lastEventIndex) {
    [indices[0], indices[1]] = [indices[1], indices[0]];
  }
  return indices;
}

function drawNextEvent() {
  if (eventDeck.length === 0) eventDeck = shuffleDeck();
  const idx = eventDeck.shift();
  lastEventIndex = idx;
  return EVENTS[idx];
}

// --- Game mode ---
// "driving" | "event" | "minigame-snack"
let currentMode = 'driving';

// --- Crash cutscene state ---
let isCrashScene      = false;
let crashSceneMessage = '';

// --- Snack Hunt: sprite assets ---
// Eight directional frames — frame 0 used now; frame 1 ready for animation later
const playerSprites = {
  up:    [new Image(), new Image()],
  down:  [new Image(), new Image()],
  left:  [new Image(), new Image()],
  right: [new Image(), new Image()]
};
playerSprites.up[0].src    = 'player-up-1.png';
playerSprites.up[1].src    = 'player-up-2.png';
playerSprites.down[0].src  = 'player-down-1.png';
playerSprites.down[1].src  = 'player-down-2.png';
playerSprites.left[0].src  = 'player-left-1.png';
playerSprites.left[1].src  = 'player-left-2.png';
playerSprites.right[0].src = 'player-right-1.png';
playerSprites.right[1].src = 'player-right-2.png';

// Snack Hunt background — preloaded once, drawn on canvas each frame
const snackHuntBgImg = new Image();
snackHuntBgImg.src = 'snack-hunt-bg.png';

function isMobileTouchDevice() {
  return window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// --- Snack Hunt: player state ---
const PLAYER_WIDTH        = 31;  // fixed draw width in canvas px — height derived per frame
const PLAYER_RENDER_WIDTH = 52;
const PLAYER_RENDER_WIDTH_MOBILE = 25;
const WALK_FRAME_INTERVAL = 8;  // RAF frames between sprite toggles (~133ms at 60fps)

const snackPlayer = {
  x:          0,
  y:          0,
  direction:  'down',
  speed:      3,   // pixels per frame at 60fps
  frame:      0,   // 0 or 1 — which walk frame is showing
  frameTimer: 0    // counts RAF ticks since last frame toggle
};

// Keys currently held — populated by global listeners below
const snackKeys = {};

document.addEventListener('keydown', e => {
  if (e.shiftKey && e.code === 'Digit1') {
    e.preventDefault();
    if (gameInterval) {
      clearInterval(gameInterval);
      gameInterval = null;
    }
    document.getElementById('event-box').classList.add('hidden');
    showScreen('screen-game');
    debugSnackPreview   = true;
    debugTrafficPreview = false;
    miniGamePaused      = true;
    showSnackHunt();
    return;
  }
  if (e.shiftKey && e.code === 'Digit2') {
    e.preventDefault();
    if (gameInterval) {
      clearInterval(gameInterval);
      gameInterval = null;
    }
    document.getElementById('event-box').classList.add('hidden');
    showScreen('screen-game');
    debugSnackPreview   = false;
    debugTrafficPreview = true;
    miniGamePaused      = true;
    showTrafficGame();
    return;
  }
  if (e.shiftKey && e.code === 'KeyP') {
    if (currentMode === 'minigame-snack' || currentMode === 'minigame-traffic') {
      e.preventDefault();
      miniGamePaused = !miniGamePaused;
    }
    return;
  }
  snackKeys[e.key] = true;
  if (currentMode === 'minigame-snack') {
    // Block page scroll on arrow keys and spacebar
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
    // Fire on spacebar — single shot per keydown, not held
    if (e.key === ' ') fireProjectile();
  }
  if (currentMode === 'minigame-traffic') {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft')  trafficSwitchLane(-1);
    if (e.key === 'ArrowRight') trafficSwitchLane(1);
  }
});
document.addEventListener('keyup', e => { snackKeys[e.key] = false; });

let snackHuntRaf = null; // requestAnimationFrame handle

// --- Snack Hunt: projectiles ---
const snackProjectiles = []; // { x, y, dx, dy }
const PROJECTILE_SPEED = 7;  // px per frame
const PROJECTILE_SIZE  = 5;  // dot radius px

// --- Snack Hunt: snack sprites ---
const snackSprites = {
  chips:   [new Image(), new Image()],
  candy:   [new Image(), new Image()],
  burrito: [new Image(), new Image()],
};
snackSprites.chips[0].src   = 'snack-chips-1.png';
snackSprites.chips[1].src   = 'snack-chips-2.png';
snackSprites.candy[0].src   = 'snack-candy-1.png';
snackSprites.candy[1].src   = 'snack-candy-2.png';
snackSprites.burrito[0].src = 'snack-burrito-1.png';
snackSprites.burrito[1].src = 'snack-burrito-2.png';
const junkBossSprites = [
  { normal: [new Image(), new Image()], hit: new Image() },
  { normal: [new Image(), new Image()], hit: new Image() },
  { normal: [new Image(), new Image()], hit: new Image() },
];
junkBossSprites[0].normal[0].src = 'junk-1-1.png';
junkBossSprites[0].normal[1].src = 'junk-1-2.png';
junkBossSprites[0].hit.src       = 'junk-1-hit.png';
junkBossSprites[1].normal[0].src = 'junk-2-1.png';
junkBossSprites[1].normal[1].src = 'junk-2-2.png';
junkBossSprites[1].hit.src       = 'junk-2-hit.png';
junkBossSprites[2].normal[0].src = 'junk-3-1.png';
junkBossSprites[2].normal[1].src = 'junk-3-2.png';
junkBossSprites[2].hit.src       = 'junk-3-hit.png';

const SNACK_WIDTHS = { chips: 70, candy: 56, burrito: 84 }; // px — height derived per sprite
const SNACK_WIDTHS_MOBILE = { chips: 58, candy: 46, burrito: 52 };
const SNACK_ANIM_INTERVAL = 20; // RAF ticks between frame toggles (~333ms at 60fps)
const JUNK_BOSS_HP_MAX = 9;
const JUNK_BOSS_REWARD = 12;
const JUNK_BOSS_RENDER_WIDTH = isMobileTouchDevice() ? PLAYER_WIDTH * 3 : PLAYER_WIDTH * 6;
const JUNK_BOSS_SPEED = 1.4 * 1.35;
const JUNK_BOSS_HIT_FLASH_FRAMES = 8;
const JUNK_BOSS_WANDER_INTERVAL_MIN = 52;
const JUNK_BOSS_WANDER_INTERVAL_MAX = 104;

const snackItems = []; // { type, x, y, vx }
let snackAnimFrame = 0; // 0 or 1 — shared across all snacks
let snackAnimTimer = 0; // counts RAF ticks since last toggle
let junkBoss = null;
let junkBossSpawned = false;
let snackBossBonus = 0;

const SNACK_MAX          = 2;   // max active at once
const SNACK_RESPAWN_MIN  = 180; // ~3 s at 60fps
const SNACK_RESPAWN_MAX  = 420; // ~7 s at 60fps
let   snackRespawnTimer  = 60;  // start short so first appears quickly

// Score awarded to state.snacks per hit (chips=1, candy=2, burrito=3)
const SNACK_POINTS = { chips: 1, candy: 1, burrito: 2 };

// Per-session hit tally — reset each time the minigame starts
const snackCollected = { chips: 0, candy: 0, burrito: 0 };

// Timer — 45 seconds expressed as RAF frames (≈60fps)
const SNACK_HUNT_DURATION = 45 * 60; // frames
let   snackHuntFramesLeft = 0;        // counts down to 0; stays at 0 when expired

// Spawn from left, right, or bottom — with diagonal drift
function spawnNewSnack(canvasW, canvasH) {
  const types  = ['chips', 'candy', 'burrito'];
  const type   = types[Math.floor(Math.random() * types.length)];
  const sw     = getSnackWidth(type);
  const speed  = 0.8 + Math.random() * 1.2; // 0.8–2 px/frame
  const drift  = (Math.random() - 0.5) * speed * 0.6; // diagonal component

  const edge = Math.floor(Math.random() * 3); // 0=left 1=right 2=bottom
  if (edge === 0) {                             // from left → moves right + drift
    return { type, x: -(sw / 2), y: canvasH * (0.50 + Math.random() * 0.30), vx:  speed, vy: drift };
  } else if (edge === 1) {                      // from right → moves left + drift
    return { type, x: canvasW + sw / 2,        y: canvasH * (0.50 + Math.random() * 0.30), vx: -speed, vy: drift };
  } else {                                      // from bottom → moves up + drift
    return { type, x: canvasW * (0.10 + Math.random() * 0.80), y: canvasH + sw / 2, vx: drift, vy: -speed };
  }
}

const DIR_VECTORS = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

function getSnackPlayerRenderWidth() {
  return isMobileTouchDevice() ? PLAYER_RENDER_WIDTH_MOBILE : PLAYER_RENDER_WIDTH;
}

function getSnackWidth(type) {
  return (isMobileTouchDevice() ? SNACK_WIDTHS_MOBILE : SNACK_WIDTHS)[type];
}

function getJunkBossStageIndex(hp) {
  return Math.max(0, Math.min(2, Math.floor((JUNK_BOSS_HP_MAX - hp) / 3)));
}

function getJunkBossDimensions(hp) {
  const stage = junkBossSprites[getJunkBossStageIndex(hp)];
  const refSpr = stage.normal[0];
  const renderH = refSpr.naturalWidth
    ? Math.round(JUNK_BOSS_RENDER_WIDTH * refSpr.naturalHeight / refSpr.naturalWidth)
    : JUNK_BOSS_RENDER_WIDTH;
  return { w: JUNK_BOSS_RENDER_WIDTH, h: renderH };
}

function isFiniteJunkBossValue(value) {
  return Number.isFinite(value);
}

function setJunkBossWanderVelocity(boss) {
  let dx = Math.random() * 2 - 1;
  let dy = Math.random() * 2 - 1;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  boss.vx = dx * JUNK_BOSS_SPEED;
  boss.vy = dy * JUNK_BOSS_SPEED;
  boss.wanderTimer = JUNK_BOSS_WANDER_INTERVAL_MIN + Math.floor(Math.random() * (JUNK_BOSS_WANDER_INTERVAL_MAX - JUNK_BOSS_WANDER_INTERVAL_MIN + 1));
}

function spawnJunkBoss(canvasW, canvasH) {
  try {
    const fromLeft = Math.random() < 0.5;
    const dims = getJunkBossDimensions(JUNK_BOSS_HP_MAX);
    junkBoss = {
      x: fromLeft ? -(dims.w / 2) : canvasW + dims.w / 2,
      y: canvasH * (0.38 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * JUNK_BOSS_SPEED,
      vy: 0,
      hp: JUNK_BOSS_HP_MAX,
      mode: 'enter',
      enterFrom: fromLeft ? 'left' : 'right',
      escapeDir: fromLeft ? -1 : 1,
      wanderTimer: 0,
      hitTimer: 0,
      hitStage: 0,
    };
    junkBossSpawned = true;
  } catch (err) {
    console.warn('Snack Hunt boss spawn failed', err);
    junkBoss = null;
    junkBossSpawned = true;
  }
}

function updateJunkBoss(canvasW, canvasH, timerDone) {
  if (!junkBoss) return;
  if (!isFiniteJunkBossValue(junkBoss.x) || !isFiniteJunkBossValue(junkBoss.y) ||
      !isFiniteJunkBossValue(junkBoss.vx) || !isFiniteJunkBossValue(junkBoss.vy)) {
    console.warn('Snack Hunt boss had invalid state', junkBoss);
    junkBoss = null;
    return;
  }
  const dims = getJunkBossDimensions(junkBoss.hp);
  const halfW = dims.w / 2;
  const halfH = dims.h / 2;

  if (junkBoss.hitTimer > 0) junkBoss.hitTimer--;

  if (timerDone && junkBoss.mode !== 'escape') {
    junkBoss.mode = 'escape';
    junkBoss.vx = junkBoss.escapeDir * JUNK_BOSS_SPEED * 1.2;
    junkBoss.vy = 0;
  }

  if (junkBoss.mode === 'enter') {
    junkBoss.x += junkBoss.vx;
    if ((junkBoss.enterFrom === 'left' && junkBoss.x - halfW >= 0) ||
        (junkBoss.enterFrom === 'right' && junkBoss.x + halfW <= canvasW)) {
      junkBoss.mode = 'wander';
      setJunkBossWanderVelocity(junkBoss);
      junkBoss.x = Math.max(halfW, Math.min(canvasW - halfW, junkBoss.x));
    }
    return;
  }

  if (junkBoss.mode === 'escape') {
    junkBoss.x += junkBoss.vx;
    if (junkBoss.x + halfW < 0 || junkBoss.x - halfW > canvasW) junkBoss = null;
    return;
  }

  junkBoss.wanderTimer--;
  if (junkBoss.wanderTimer <= 0) setJunkBossWanderVelocity(junkBoss);

  junkBoss.x += junkBoss.vx;
  junkBoss.y += junkBoss.vy;

  if (junkBoss.x - halfW < 0) {
    junkBoss.x = halfW;
    junkBoss.vx = Math.abs(junkBoss.vx);
  } else if (junkBoss.x + halfW > canvasW) {
    junkBoss.x = canvasW - halfW;
    junkBoss.vx = -Math.abs(junkBoss.vx);
  }

  if (junkBoss.y - halfH < 0) {
    junkBoss.y = halfH;
    junkBoss.vy = Math.abs(junkBoss.vy);
  } else if (junkBoss.y + halfH > canvasH) {
    junkBoss.y = canvasH - halfH;
    junkBoss.vy = -Math.abs(junkBoss.vy);
  }
}

function fireProjectile() {
  const vec  = DIR_VECTORS[snackPlayer.direction];
  // Spawn from player centre
  const refSpr = playerSprites[snackPlayer.direction === 'left' ? 'right' : snackPlayer.direction][0];
  const ph = Math.round(PLAYER_WIDTH * refSpr.naturalHeight / refSpr.naturalWidth);
  snackProjectiles.push({
    x:  snackPlayer.x + PLAYER_WIDTH / 2,
    y:  snackPlayer.y + ph / 2,
    dx: vec.dx * PROJECTILE_SPEED,
    dy: vec.dy * PROJECTILE_SPEED,
  });
}

// --- Passenger system ---
const DEFAULTS = ['Mom', 'Dad', 'Kid', 'Teen', 'Dog'];

const CRASH_REASONS = [
  "couldn't handle 6 hours without proper snacks",
  "lost it after the third gas station stop",
  "refused to listen to that playlist one more time",
  "mentally checked out somewhere in Nevada",
  "was never the same after the gas station burrito",
  "declared the AC situation a personal attack",
  "ran out of phone battery and had nothing left to live for",
  "couldn't take one more round of the license plate game",
  "got personally offended by the roadside billboard",
  "stopped speaking after the wrong turn in Barstow",
  "finally snapped when someone ate the last Cheeto",
  "hit their limit when the aux cord got unplugged mid-song",
  "couldn't reconcile the ETA changing for the fourth time",
  "asked to stop three times and was outvoted every time",
  "saw the next rest stop was 84 miles away and gave up",
];

// Each index: morale must drop BELOW this value to crash passenger N
// [80, 60, 40, 20, 0] → 5 thresholds for 5 passengers
const CRASH_THRESHOLDS = [80, 60, 40, 20, 0];

let passengers   = []; // { name }
let crashedCount = 0;  // how many have crashed so far — single source of truth

function initPassengers() {
  passengers = DEFAULTS.map((def, i) => {
    const input = document.getElementById(`pname-${i}`);
    const name = input && input.value.trim() ? input.value.trim() : def;
    return { name };
  });
  crashedCount    = 0;
  state.moraleMax = 100;
  renderPassengerRow();
}

function renderPassengerRow() {
  const row = document.getElementById('passenger-row');
  row.innerHTML = '';
  passengers.forEach((p, i) => {
    const tag = document.createElement('span');
    tag.className = 'passenger-tag' + (i < crashedCount ? ' crashed' : '');
    tag.id = `ptag-${i}`;
    tag.textContent = p.name;
    row.appendChild(tag);
  });
}

// Called every game tick. Triggers AT MOST one crash per tick
// so messages are readable and ordering is guaranteed.
function checkCrashOuts(morale) {
  if (crashedCount >= passengers.length) return;

  // Count how many crashes the current morale value demands.
  // Thresholds 0–3 use strict "< threshold"; threshold index 4 (value 0) → morale <= 0.
  let needed = 0;
  for (let i = 0; i < CRASH_THRESHOLDS.length - 1; i++) {
    if (morale < CRASH_THRESHOLDS[i]) needed = i + 1;
  }
  if (morale <= 0) needed = CRASH_THRESHOLDS.length; // all 5

  if (needed <= crashedCount) return; // nothing new to do

  // Crash ALL newly-required passengers in order
  let lastCrashMsg = '';
  while (crashedCount < needed) {
    const idx  = crashedCount;
    const name = passengers[idx].name;
    const reason = CRASH_REASONS[Math.floor(Math.random() * CRASH_REASONS.length)];

    crashedCount++;

    // Lower moraleMax to this threshold so morale can't recover above it
    state.moraleMax = CRASH_THRESHOLDS[idx];
    if (state.morale > state.moraleMax) state.morale = state.moraleMax;

    // Update tag UI
    const tag = document.getElementById(`ptag-${idx}`);
    if (tag) tag.className = 'passenger-tag crashed';

    lastCrashMsg = `${name} crashed out because they ${reason}.`;
    setStatusMsg(`💥 ${lastCrashMsg}`, 4000);
  }

  // Trigger cutscene for the last (or only) crash this tick
  if (lastCrashMsg) showCrashScene(lastCrashMsg);
}

// --- Event definitions ---
const EVENTS = [

  // ── CORE EVENT: Flat Tire ─────────────────────────────────────────────────
  {
    desc: 'A tire blows out. You pull over to the shoulder.',
    choices: [
      {
        label: 'Use spare tire',
        effect: () => {
          if (state.cart['spare-tire']) {
            state.cart['spare-tire']--;
            state.morale = Math.min(state.moraleMax, state.morale + 8);
            setStatusMsg('Spare mounted. Back on the road.');
          } else {
            state.gas    -= 18;
            state.morale -= 12;
            setStatusMsg('No spare in the car. Long wait ahead.');
          }
        }
      },
      {
        label: 'Call roadside ($30)',
        effect: () => {
          if (state.money >= 30) {
            state.money  -= 30;
            state.gas    -= 7;
            setStatusMsg('Roadside arrived. Took 45 minutes.');
          } else {
            state.morale -= 12;
            state.gas    -= 15;
            setStatusMsg('Not enough money. Had to figure it out.');
          }
        }
      },
      {
        label: 'Wait it out',
        effect: () => {
          state.gas    -= 20;
          state.morale -= 18;
          setStatusMsg('Waited on the shoulder for over an hour.');
        }
      }
    ]
  },

  // ── Kids Fighting ─────────────────────────────────────────────────────────
  {
    desc: 'The kids are fighting in the back seat. Again.',
    choices: [
      { label: 'Bribe them with snacks', effect: () => {
          if (state.snacks >= 12) {
            state.snacks = Math.max(0, state.snacks - 12);
            state.morale = Math.min(state.moraleMax, state.morale + 12);
            setStatusMsg('Snacks deployed. Temporary peace restored.');
          } else {
            state.morale -= 15;
            setStatusMsg('Reached for snacks — bag\'s empty. Now everyone\'s fighting AND hungry.');
          }
        }
      },
      { label: 'Threaten to turn around', effect: () => { state.morale = Math.min(state.moraleMax, state.morale + 7); setStatusMsg('Nobody believes you but it worked anyway.'); } },
      { label: 'Ignore it',               effect: () => { state.morale -= 15; setStatusMsg('It escalates. Obviously.'); } }
    ]
  },

  // ── CORE EVENT: Gas Station ───────────────────────────────────────────────
  {
    desc: 'A gas station appears ahead. The tank is getting low.',
    choices: [
      {
        label: 'Rush in (fill up & grab snacks)',
        effect: () => {
          if (state.money >= 20) {
            state.money  -= 20;
            state.gas     = Math.min(100, state.gas + 15);
            state.snacks  = Math.min(100, state.snacks + 10);
            state.morale  = Math.min(state.moraleMax, state.morale + 5);
            setStatusMsg('Quick stop. Everyone stretched their legs.');
          } else {
            state.gas    = Math.min(100, state.gas + 8);
            state.snacks = Math.min(100, state.snacks + 5);
            setStatusMsg('Grabbed what we could afford.');
          }
        }
      },
      {
        label: 'Take your time (full stop)',
        effect: () => { showSnackHunt(); }
      },
      {
        label: 'Skip it',
        effect: () => {
          state.gas    = Math.min(100, state.gas + 5);
          state.morale -= 7;
          setStatusMsg('Saved time. Everyone is annoyed about it.');
        }
      }
    ]
  },

  // ── Diner ─────────────────────────────────────────────────────────────────
  {
    desc: 'A roadside diner looks promising. Everyone is hungry.',
    choices: [
      { label: 'Stop for food ($15)', effect: () => {
          if (state.money >= 15) {
            state.snacks = Math.min(100, state.snacks + 18);
            state.morale = Math.min(state.moraleMax, state.morale + 10);
            state.money -= 15;
            setStatusMsg('Hot food. Actual plates. Worth it.');
          } else {
            state.morale -= 8;
            setStatusMsg('Can\'t afford it. Everyone stares at the sign as you drive past.');
          }
        }
      },
      { label: 'Eat the car snacks', effect: () => {
          if (state.snacks >= 12) {
            state.snacks = Math.max(0, state.snacks - 12);
            state.morale = Math.min(state.moraleMax, state.morale + 5);
            setStatusMsg('Dug through the bag. Found enough to get by.');
          } else {
            state.morale -= 12;
            setStatusMsg('Snack bag is completely empty. This is fine. Everything is fine.');
          }
        }
      },
      { label: 'Push through', effect: () => { state.morale -= 12; setStatusMsg('Nobody is happy. The dog is mad too.'); } }
    ]
  },

  // ── Car Noise ─────────────────────────────────────────────────────────────
  {
    desc: 'The car is making a strange noise. Probably fine.',
    choices: [
      { label: 'Pull over and check', effect: () => { state.gas = Math.min(100, state.gas + 5); setStatusMsg('Found a loose fuel line. Clamped it. Saved some gas.'); } },
      { label: 'Turn the radio up',   effect: () => { state.morale = Math.min(state.moraleMax, state.morale + 6); setStatusMsg('Out of sight, out of mind.'); } }
    ]
  },

  // ── Bathroom Emergency ────────────────────────────────────────────────────
  {
    desc: 'Someone needs a bathroom. Right now. Non-negotiable.',
    choices: [
      { label: 'Find a rest stop', effect: () => { state.gas -= 5; state.morale = Math.min(state.moraleMax, state.morale + 8); setStatusMsg('Crisis averted. Clean bathrooms, too.'); } },
      { label: 'Hand them a cup',  effect: () => { state.morale -= 18; setStatusMsg('Nobody is happy about this.'); } }
    ]
  },

  // ── CORE EVENT: Traffic ───────────────────────────────────────────────────
  {
    desc: 'Dead stop. Construction zone. You can see the horizon and it\'s all brake lights.',
    choices: [
      {
        label: 'Wait it out',
        effect: () => {
          state.gas    -= 8;
          state.morale -= 12;
          setStatusMsg('Thirty minutes in traffic. Nobody talks.');
        }
      },
      {
        label: 'Take a detour',
        effect: () => {
          state.gas    -= 18;
          state.morale  = Math.min(state.moraleMax, state.morale + 6);
          setStatusMsg('Detour worked. Burned extra gas but spirits lifted.');
        }
      },
      {
        label: 'Weave through traffic',
        effect: () => { showTrafficGame(); }
      }
    ]
  },

  // ── Found Money ───────────────────────────────────────────────────────────
  {
    desc: 'You find a crumpled $20 bill on the floor of the car.',
    choices: [
      { label: 'Keep it for gas',     effect: () => { state.money += 20; setStatusMsg('Found $20. Back in the budget.'); } },
      { label: 'Give it to the kids', effect: () => { state.morale = Math.min(state.moraleMax, state.morale + 15); setStatusMsg('Instant hero status. For now.'); } }
    ]
  },

  // ── Radio ─────────────────────────────────────────────────────────────────
  {
    desc: 'The radio cuts out. Total silence. Kids are restless.',
    choices: [
      { label: 'Play a road trip game', effect: () => { state.morale = Math.min(state.moraleMax, state.morale + 12); setStatusMsg('License plate bingo. Surprisingly effective.'); } },
      { label: 'Enjoy the quiet',       effect: () => { state.morale -= 10; setStatusMsg('Nobody else is enjoying it.'); } }
    ]
  },

  // ── Dog at Rest Stop ──────────────────────────────────────────────────────
  {
    desc: 'A dog at the rest stop needs a snack. It is very cute.',
    choices: [
      { label: 'Share your snacks', effect: () => {
          if (state.snacks >= 8) {
            state.snacks = Math.max(0, state.snacks - 8);
            state.morale = Math.min(state.moraleMax, state.morale + 15);
            setStatusMsg('Worth it. That dog deserved it.');
          } else {
            state.morale -= 10;
            setStatusMsg('No snacks left. The dog just stared at you. Everyone is devastated.');
          }
        }
      },
      { label: 'Keep driving', effect: () => { state.morale -= 7; setStatusMsg('Everyone feels bad about it.'); } }
    ]
  }
];

// --- Shop logic ---
function updateMoneyDisplay() {
  document.getElementById('money-amount').textContent = state.money;
}

function updateCartDisplay() {
  const el = document.getElementById('cart-contents');
  const entries = Object.entries(state.cart);
  if (entries.length === 0) {
    el.textContent = 'Nothing yet.';
    el.classList.add('cart-empty');
  } else {
    el.classList.remove('cart-empty');
    el.textContent = entries.map(([key, qty]) => `${itemNames[key]} x${qty}`).join('  |  ');
  }
}

function refreshShopButtons() {
  document.querySelectorAll('.shop-btn').forEach(btn => {
    btn.disabled = parseInt(btn.dataset.cost) > state.money;
  });
}

function resetShop() {
  state.money = 100;
  state.cart = {};
  updateMoneyDisplay();
  updateCartDisplay();
  refreshShopButtons();
}

document.querySelectorAll('.shop-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cost = parseInt(btn.dataset.cost);
    const item = btn.dataset.item;
    if (cost > state.money) return;
    state.money -= cost;
    state.cart[item] = (state.cart[item] || 0) + 1;
    updateMoneyDisplay();
    updateCartDisplay();
    refreshShopButtons();
  });
});

// --- Travel screen helpers ---
function setBar(barId, pct) {
  const bar = document.getElementById(barId);
  bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  // colour shifts red when low
  if (pct <= 20) bar.style.background = '#e74c3c';
  else if (pct <= 50) bar.style.background = '#f5a623';
  else bar.style.background = '#f5c518';
}

function updateTravelUI() {
  const gasVal    = Math.max(0, state.gas);
  const snackVal  = Math.max(0, state.snacks);
  const moraleVal = Math.max(0, state.morale);
  const progVal   = Math.min(100, state.progress);

  document.getElementById('val-gas').textContent    = Math.ceil(gasVal);
  document.getElementById('val-snacks').textContent = Math.ceil(snackVal);
  document.getElementById('val-morale').textContent = Math.ceil(moraleVal);
  document.getElementById('val-money').textContent  = '$' + state.money;
  document.getElementById('val-progress').textContent = Math.floor(progVal) + '%';

  setBar('bar-gas',      gasVal);
  setBar('bar-snacks',   snackVal);
  setBar('bar-morale',   moraleVal);

  const progBar = document.getElementById('bar-progress');
  progBar.style.width = progVal + '%';

  // status message — don't overwrite if a recent event outcome is still showing
  if (Date.now() >= statusLockUntil) {
    let msg = '';
    if (snackVal <= 0)      msg = 'Out of snacks. Everyone is spiraling.';
    else if (snackVal < 15) msg = 'Snacks running low...';
    if (gasVal < 20)        msg = 'Almost out of gas!';
    if (moraleVal < 20)     msg = 'Morale is critical. Someone is crying.';
    document.getElementById('status-msg').textContent = msg;
  }
}

// --- Crash cutscene ---
function showCrashScene(msg) {
  isCrashScene      = true;
  crashSceneMessage = msg;

  // Pause game loop while cutscene is visible
  clearInterval(gameInterval);
  gameInterval = null;

  // Swap views
  document.querySelector('.road-scene').classList.add('hidden');
  document.getElementById('crash-scene-msg').textContent = msg;
  document.getElementById('crash-scene').classList.remove('hidden');
}

function hideCrashScene() {
  isCrashScene = false;
  document.getElementById('crash-scene').classList.add('hidden');
  document.querySelector('.road-scene').classList.remove('hidden');
  startGameLoop();
}

document.getElementById('crash-continue').addEventListener('click', hideCrashScene);

// --- Snack Hunt mini-game ---
function showSnackHunt() {
  currentMode = 'minigame-snack';

  document.getElementById('snack-hunt').classList.remove('hidden');
  initSnackHunt();
}

function exitSnackHunt() {
  const earned = snackCollected.chips   * SNACK_POINTS.chips
               + snackCollected.candy   * SNACK_POINTS.candy
               + snackCollected.burrito * SNACK_POINTS.burrito
               + snackBossBonus;
  resetSnackInput();
  stopSnackHunt();
  currentMode = 'driving';
  miniGamePaused = false;
  debugSnackPreview = false;
  document.getElementById('snack-hunt').classList.add('hidden');
  document.querySelector('.road-scene').classList.remove('paused');

  // Award snacks from what the player actually hit
  state.snacks = Math.min(100, state.snacks + earned);
  if (earned > 0) {
    setStatusMsg(`+${earned} snacks from the gas station haul!`, 3000);
  } else {
    setStatusMsg(`Couldn't grab anything. Still hungry.`, 3000);
  }

  eventTick = 0;
  eventTickTarget = 12 + Math.floor(Math.random() * 9);
  startGameLoop();
}

document.getElementById('snack-hunt-exit').addEventListener('click', exitSnackHunt);

// --- Traffic mini-game ---

// Player sprites
const trafficPlayerSprites = [new Image(), new Image()];
trafficPlayerSprites[0].src = 'traffic-player-1.png';
trafficPlayerSprites[1].src = 'traffic-player-2.png';

// Background
const trafficBgImg = new Image();
trafficBgImg.src = 'traffic-bg.png';

// Enemy car sprites — 5 types × 2 frames
const TRAFFIC_CAR_TYPE_COUNT = 5;
const trafficCarSprites = Array.from({ length: TRAFFIC_CAR_TYPE_COUNT }, () => [new Image(), new Image()]);
for (let i = 0; i < TRAFFIC_CAR_TYPE_COUNT; i++) {
  trafficCarSprites[i][0].src = `traffic-car-${i + 1}-1.png`;
  trafficCarSprites[i][1].src = `traffic-car-${i + 1}-2.png`;
}

// Lane system — road occupies ~27%–72% of canvas width (derived from pixel sampling)
const TRAFFIC_ROAD_LEFT_RATIO  = 101 / 375;  // ~0.269
const TRAFFIC_ROAD_RIGHT_RATIO = 270 / 375;  // ~0.720
const TRAFFIC_LANE_COUNT       = 4;

let trafficLanes = []; // x center of each lane, computed in initTrafficGame

// Traffic chunk presets — each row is 4 lanes: e=empty, c=car
const trafficChunks = [
  ["e e e e","c e c c","c e c c","c e e c","c c e c"],
  ["e e e e","c c e c","c c e c","c e e c","c e c c"],
  ["e e e e","c e c c","c e c c","c e e c","c c e c","c c e e","c c c e"],
  ["e e e e","c c e c","c c e c","c e e c","c e c c","e e c c","e c c c"],
  ["e e e e","c e c c","c e e c","c c e c","c c e e","e c c e","e e c c"],
  ["e e e e","c c e c","c e e c","c e c c","e e c c","e c e c","c e e c"],
  ["e e e e","c e c c","c e c c","c e e c","c c e c","c c e e","e c c e","c e c e","c c e e","c c c e"],
  ["e e e e","c c e c","c c e c","c e e c","c e c c","e e c c","e c c e","e e c e","c e e c","c e c c"],
  ["e e e e","c e c c","c e c c","c e e c","c c e c","c c e e","e c c e","e c e c","c e e c","c c e c","c c e e","c c c e"],
  ["e e e e","c c e c","c c e c","c e e c","c e c c","e e c c","e c c e","e c c c","e e c c","c e e c","c c e c","c c e e","c c c e"]
];

// Player state
const trafficPlayer = {
  lane:         1,    // 0-3; starts in second lane (one of the middle lanes)
  x:            0,    // current draw x (slides toward targetX)
  targetX:      0,    // x center of the current lane
  y:            0,    // current y; moves with up/down keys
  currentFrame: 0,    // 0 or 1 — sprite frame
  frameTimer:   0     // counts RAF ticks since last frame toggle
};

// Enemy car state
let trafficEnemyCars   = [];  // { lane, x, y, w, h, spriteType, currentFrame, frameTimer }
let trafficBgScrollY   = 0;   // background scroll offset (px, cycles 0→canvasHeight)
let trafficChunkIdx    = 0;   // which chunk we're currently drawing from
let trafficRowIdx      = 0;   // which row within the current chunk
let trafficRowTimer    = 0;   // frames since last row was spawned
let trafficFrameCount  = 0;   // total frames elapsed — drives speed ramp

// Tuning constants
const TRAFFIC_PLAYER_WIDTH        = 48;   // draw width for player car (px)
const TRAFFIC_CAR_WIDTH           = 44;   // draw width for enemy cars (px)
const TRAFFIC_PLAYER_RENDER_WIDTH = 68;
const TRAFFIC_CAR_RENDER_WIDTH    = 58;
const TRAFFIC_PLAYER_RENDER_WIDTH_MOBILE = 44;
const TRAFFIC_CAR_RENDER_WIDTH_MOBILE    = 38;
const TRAFFIC_CAR_HEIGHT_FALLBACK = 64;   // used before sprite loads
const TRAFFIC_SCROLL_SPEED        = 4.0;  // px/frame base scroll speed
const TRAFFIC_SPEED_MAX           = 8.6;  // px/frame speed cap — tough but readable
const TRAFFIC_SPEED_RAMP_FRAMES   = 1800; // frames to reach max speed (~30s) — gentler ramp within the 15s round
const TRAFFIC_ROUND_FRAMES        = 1800; // 15 seconds at 60fps — survive this long to win
const TRAFFIC_SLIDE_SPEED         = 12;   // px/frame for smooth lane slide
const TRAFFIC_VERT_SPEED          = 6;    // px/frame for player up/down input
const TRAFFIC_PLAYER_FRAME_INT    = 10;   // RAF ticks between player sprite toggles
const TRAFFIC_ENEMY_FRAME_INT     = 12;   // RAF ticks between enemy sprite toggles
const TRAFFIC_ROW_SPACING         = 130;  // target px between consecutive rows (screen space)

// Keys held for traffic (up/down need per-frame polling)
const trafficKeys = {};
document.addEventListener('keydown', e => { trafficKeys[e.key] = true; });
document.addEventListener('keyup',   e => { trafficKeys[e.key] = false; });

let trafficRaf = null;

function isTrafficMobile() {
  return isMobileTouchDevice();
}

function buildTrafficLanes(canvas) {
  const canvasWidth = canvas.width;
  let roadLeft  = canvasWidth * TRAFFIC_ROAD_LEFT_RATIO;
  let roadRight = canvasWidth * TRAFFIC_ROAD_RIGHT_RATIO;

  if (isTrafficMobile() && trafficBgImg.naturalWidth && trafficBgImg.naturalHeight) {
    const trafficBgScale = Math.max(canvas.width / trafficBgImg.naturalWidth, canvas.height / trafficBgImg.naturalHeight);
    const trafficBgDrawW = trafficBgImg.naturalWidth * trafficBgScale;
    const trafficBgDrawX = (canvas.width - trafficBgDrawW) / 2;
    roadLeft  = trafficBgDrawX + trafficBgDrawW * TRAFFIC_ROAD_LEFT_RATIO;
    roadRight = trafficBgDrawX + trafficBgDrawW * TRAFFIC_ROAD_RIGHT_RATIO;
  }

  const laneWidth = (roadRight - roadLeft) / TRAFFIC_LANE_COUNT;
  return Array.from({ length: TRAFFIC_LANE_COUNT }, (_, i) =>
    roadLeft + laneWidth * i + laneWidth / 2
  );
}

function trafficSwitchLane(dir) {
  trafficPlayer.lane    = Math.max(0, Math.min(TRAFFIC_LANE_COUNT - 1, trafficPlayer.lane + dir));
  trafficPlayer.targetX = trafficLanes[trafficPlayer.lane] - TRAFFIC_PLAYER_WIDTH / 2;
}

// Returns the current scroll speed based on elapsed frames
function trafficSpeed() {
  return Math.min(
    TRAFFIC_SCROLL_SPEED + (trafficFrameCount / TRAFFIC_SPEED_RAMP_FRAMES) * (TRAFFIC_SPEED_MAX - TRAFFIC_SCROLL_SPEED),
    TRAFFIC_SPEED_MAX
  );
}

// AABB overlap test
function trafficRectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function failTrafficGame() {
  stopTrafficGame();
  currentMode = 'driving';
  miniGamePaused = false;
  debugTrafficPreview = false;
  document.getElementById('traffic-game').classList.add('hidden');
  document.getElementById('traffic-game').classList.remove('touch-active');
  document.querySelector('.road-scene').classList.remove('paused');
  // Stuck-in-traffic penalty
  state.gas    = Math.max(0, state.gas    - 12);
  state.morale = Math.max(0, state.morale - 10);
  setStatusMsg('Stuck in traffic. Lost gas and morale.', 4000);
  eventTick = 0;
  eventTickTarget = 12 + Math.floor(Math.random() * 9);
  startGameLoop();
}

function spawnTrafficRow() {
  const chunk = trafficChunks[trafficChunkIdx];
  const cells = chunk[trafficRowIdx].split(' ');   // ['c','e','c','c']

  cells.forEach((cell, laneIdx) => {
    if (cell !== 'c') return;
    // Each car picks its own random sprite type
    const spriteType = Math.floor(Math.random() * TRAFFIC_CAR_TYPE_COUNT);
    const refSpr = trafficCarSprites[spriteType][0];
    const aspect = refSpr.naturalHeight > 0
      ? refSpr.naturalWidth / refSpr.naturalHeight
      : TRAFFIC_CAR_WIDTH / TRAFFIC_CAR_HEIGHT_FALLBACK;
    const drawH = TRAFFIC_CAR_WIDTH / aspect;
    trafficEnemyCars.push({
      lane:         laneIdx,
      x:            trafficLanes[laneIdx] - TRAFFIC_CAR_WIDTH / 2,
      y:            -drawH,
      w:            TRAFFIC_CAR_WIDTH,
      h:            drawH,
      spriteType,
      currentFrame: 0,
      frameTimer:   0
    });
  });

  // Advance row; cycle to next chunk when exhausted
  trafficRowIdx++;
  if (trafficRowIdx >= chunk.length) {
    trafficRowIdx   = 0;
    trafficChunkIdx = (trafficChunkIdx + 1) % trafficChunks.length;
  }
}

function initTrafficGame() {
  const canvas = document.getElementById('traffic-canvas');
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  trafficLanes = buildTrafficLanes(canvas);

  // Reset player
  const initPlayerSpr = trafficPlayerSprites[0];
  const initPlayerH   = initPlayerSpr.naturalHeight > 0
    ? TRAFFIC_PLAYER_WIDTH / (initPlayerSpr.naturalWidth / initPlayerSpr.naturalHeight)
    : TRAFFIC_PLAYER_WIDTH;

  trafficPlayer.lane         = 1;
  trafficPlayer.targetX      = trafficLanes[1] - TRAFFIC_PLAYER_WIDTH / 2;
  trafficPlayer.x            = trafficPlayer.targetX;
  trafficPlayer.y            = canvas.height - initPlayerH - canvas.height * 0.12;
  trafficPlayer.currentFrame = 0;
  trafficPlayer.frameTimer   = 0;

  // Reset enemy / scroll state
  trafficEnemyCars   = [];
  trafficBgScrollY   = 0;
  trafficChunkIdx    = 0;
  trafficRowIdx      = 0;
  trafficRowTimer   = Math.round(TRAFFIC_ROW_SPACING / TRAFFIC_SCROLL_SPEED); // fire first row immediately
  trafficFrameCount = 0;

  if (debugTrafficPreview) {
    const previewRows = [
      { lane: 0, y: canvas.height * 0.18, spriteType: 0 },
      { lane: 2, y: canvas.height * 0.34, spriteType: 1 },
      { lane: 3, y: canvas.height * 0.52, spriteType: 2 }
    ];
    previewRows.forEach(row => {
      const refSpr = trafficCarSprites[row.spriteType][0];
      const aspect = refSpr.naturalHeight > 0
        ? refSpr.naturalWidth / refSpr.naturalHeight
        : TRAFFIC_CAR_WIDTH / TRAFFIC_CAR_HEIGHT_FALLBACK;
      const drawH = TRAFFIC_CAR_WIDTH / aspect;
      trafficEnemyCars.push({
        lane:         row.lane,
        x:            trafficLanes[row.lane] - TRAFFIC_CAR_WIDTH / 2,
        y:            row.y,
        w:            TRAFFIC_CAR_WIDTH,
        h:            drawH,
        spriteType:   row.spriteType,
        currentFrame: 0,
        frameTimer:   0
      });
    });
  }

  trafficRaf = requestAnimationFrame(trafficLoop);
}

function trafficLoop() {
  if (currentMode !== 'minigame-traffic') return;

  const canvas = document.getElementById('traffic-canvas');
  const ctx    = canvas.getContext('2d');

  // ── Speed ramp ──────────────────────────────────────────────────────────────
  const speed       = trafficSpeed();
  const rowInterval = Math.round(TRAFFIC_ROW_SPACING / speed);

  // Player sprite dimensions (needed for hitbox and clamp)
  const playerSpr0 = trafficPlayerSprites[0];
  const playerH    = playerSpr0.naturalHeight > 0
    ? TRAFFIC_PLAYER_WIDTH / (playerSpr0.naturalWidth / playerSpr0.naturalHeight)
    : TRAFFIC_PLAYER_WIDTH;

  if (!miniGamePaused) {
    // ── Timer & win check ───────────────────────────────────────────────────────
    trafficFrameCount++;
    if (trafficFrameCount >= TRAFFIC_ROUND_FRAMES) {
      winTrafficGame();
      return;
    }

    // ── Update ──────────────────────────────────────────────────────────────────

    // Scroll background
    const trafficBgScale = trafficBgImg.naturalWidth && trafficBgImg.naturalHeight
      ? Math.max(canvas.width / trafficBgImg.naturalWidth, canvas.height / trafficBgImg.naturalHeight)
      : 1;
    const trafficBgDrawH = trafficBgImg.naturalHeight ? Math.round(trafficBgImg.naturalHeight * trafficBgScale) : canvas.height;
    trafficBgScrollY = (trafficBgScrollY + speed) % trafficBgDrawH;

    // Spawn rows on dynamic timer (interval shrinks as speed increases)
    trafficRowTimer++;
    if (trafficRowTimer >= rowInterval) {
      trafficRowTimer = 0;
      spawnTrafficRow();
    }

    // Update enemy cars — move at current speed, animate frames
    for (const car of trafficEnemyCars) {
      car.y += speed;
      car.frameTimer++;
      if (car.frameTimer >= TRAFFIC_ENEMY_FRAME_INT) {
        car.frameTimer   = 0;
        car.currentFrame = car.currentFrame === 0 ? 1 : 0;
      }
    }
    trafficEnemyCars = trafficEnemyCars.filter(c => c.y < canvas.height + 100);

    // Smooth horizontal lane slide
    const dx = trafficPlayer.targetX - trafficPlayer.x;
    trafficPlayer.x += Math.abs(dx) <= TRAFFIC_SLIDE_SPEED
      ? dx
      : Math.sign(dx) * TRAFFIC_SLIDE_SPEED;

    // Manual up/down movement — no auto-drift; player controls their own position
    if (trafficKeys['ArrowUp'])   trafficPlayer.y -= TRAFFIC_VERT_SPEED;
    if (trafficKeys['ArrowDown']) trafficPlayer.y += TRAFFIC_VERT_SPEED;

    // Clamp top — can't drive off the top of the road
    trafficPlayer.y = Math.max(canvas.height * 0.05, trafficPlayer.y);
    // No bottom clamp — player can fall off the bottom (that IS the failure)

    // Player sprite animation
    trafficPlayer.frameTimer++;
    if (trafficPlayer.frameTimer >= TRAFFIC_PLAYER_FRAME_INT) {
      trafficPlayer.frameTimer   = 0;
      trafficPlayer.currentFrame = trafficPlayer.currentFrame === 0 ? 1 : 0;
    }

    // Blocking collision — player cannot pass through traffic cars.
    // Any overlap pushes the player downward to just below that car.
    // Left/right (lane switching) is never blocked — only upward progress is stopped.
    // Cars continue scrolling down normally, so a blocked player drifts toward the bottom.
    const phInX = TRAFFIC_PLAYER_WIDTH * 0.15;
    const phInY = playerH * 0.12;
    const phW   = TRAFFIC_PLAYER_WIDTH - phInX * 2;
    const phH   = playerH - phInY * 2;

    for (const car of trafficEnemyCars) {
      const chInset = 4;
      const carHitX = car.x + chInset;
      const carHitY = car.y + chInset;
      const carHitW = car.w - chInset * 2;
      const carHitH = car.h - chInset * 2;

      // Recompute phY each pass — previous car may have already pushed player down
      const phX = trafficPlayer.x + phInX;
      const phY = trafficPlayer.y + phInY;

      if (trafficRectsOverlap(phX, phY, phW, phH, carHitX, carHitY, carHitW, carHitH)) {
        // Align player hitbox top to car hitbox bottom — blocked, not killed
        trafficPlayer.y = carHitY + carHitH - phInY + 1;
      }
    }

    // Sole failure condition: player pushed off the bottom of the play area
    if (trafficPlayer.y > canvas.height) {
      failTrafficGame();
      return;
    }
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  // Scrolling background — two copies tile seamlessly
  const trafficBgScale = trafficBgImg.naturalWidth && trafficBgImg.naturalHeight
    ? Math.max(canvas.width / trafficBgImg.naturalWidth, canvas.height / trafficBgImg.naturalHeight)
    : 1;
  const trafficBgDrawW = trafficBgImg.naturalWidth ? Math.round(trafficBgImg.naturalWidth * trafficBgScale) : canvas.width;
  const trafficBgDrawH = trafficBgImg.naturalHeight ? Math.round(trafficBgImg.naturalHeight * trafficBgScale) : canvas.height;
  const trafficBgDrawX = Math.round((canvas.width - trafficBgDrawW) / 2);
  ctx.drawImage(trafficBgImg, trafficBgDrawX, Math.round(trafficBgScrollY),                    trafficBgDrawW, trafficBgDrawH);
  ctx.drawImage(trafficBgImg, trafficBgDrawX, Math.round(trafficBgScrollY - trafficBgDrawH),  trafficBgDrawW, trafficBgDrawH);

  // Enemy cars
  for (const car of trafficEnemyCars) {
    const spr = trafficCarSprites[car.spriteType][car.currentFrame];
    const trafficCarRenderW = isTrafficMobile() ? TRAFFIC_CAR_RENDER_WIDTH_MOBILE : TRAFFIC_CAR_RENDER_WIDTH;
    const renderH = spr.naturalHeight > 0 ? trafficCarRenderW / (spr.naturalWidth / spr.naturalHeight) : car.h;
    ctx.drawImage(spr, car.x - (trafficCarRenderW - car.w) / 2, car.y - (renderH - car.h), trafficCarRenderW, renderH);
  }

  // Player car (drawn on top of traffic)
  const playerSpr = trafficPlayerSprites[trafficPlayer.currentFrame];
  const playerAR  = playerSpr.naturalHeight > 0 ? playerSpr.naturalWidth / playerSpr.naturalHeight : 1;
  const trafficPlayerRenderW = isTrafficMobile() ? TRAFFIC_PLAYER_RENDER_WIDTH_MOBILE : TRAFFIC_PLAYER_RENDER_WIDTH;
  const playerRenderH = trafficPlayerRenderW / playerAR;
  ctx.drawImage(playerSpr, trafficPlayer.x - (trafficPlayerRenderW - TRAFFIC_PLAYER_WIDTH) / 2, trafficPlayer.y - (playerRenderH - playerH), trafficPlayerRenderW, playerRenderH);

  // ── Timer HUD ───────────────────────────────────────────────────────────────
  const secsLeft  = Math.ceil((TRAFFIC_ROUND_FRAMES - trafficFrameCount) / 60);
  const timerText = `${secsLeft}`;
  // Colour shifts red as time runs out
  const urgency   = 1 - secsLeft / (TRAFFIC_ROUND_FRAMES / 60);
  const r         = Math.round(255);
  const g         = Math.round(255 * (1 - urgency));
  ctx.font        = 'bold 28px monospace';
  ctx.textAlign   = 'center';
  // Drop shadow for readability over any background
  ctx.fillStyle   = 'rgba(0,0,0,0.6)';
  ctx.fillText(timerText, canvas.width / 2 + 2, 42);
  ctx.fillStyle   = `rgb(${r},${g},0)`;
  ctx.fillText(timerText, canvas.width / 2, 40);
  ctx.textAlign   = 'left'; // reset

  trafficRaf = requestAnimationFrame(trafficLoop);
}

function stopTrafficGame() {
  if (trafficRaf) {
    cancelAnimationFrame(trafficRaf);
    trafficRaf = null;
  }
}

function showTrafficGame() {
  currentMode = 'minigame-traffic';
  clearInterval(gameInterval);
  document.getElementById('traffic-game').classList.toggle('touch-active', isMobileTouchDevice());
  document.getElementById('traffic-game').classList.remove('hidden');
  initTrafficGame();
}

function winTrafficGame() {
  stopTrafficGame();
  currentMode = 'driving';
  miniGamePaused = false;
  debugTrafficPreview = false;
  document.getElementById('traffic-game').classList.add('hidden');
  document.getElementById('traffic-game').classList.remove('touch-active');
  document.querySelector('.road-scene').classList.remove('paused');
  state.morale = Math.min(state.moraleMax, state.morale + 12);
  state.gas    = Math.min(100, state.gas + 6);
  setStatusMsg('You weaved through! Morale up, saved some gas too.', 4000);
  eventTick = 0;
  eventTickTarget = 12 + Math.floor(Math.random() * 9);
  startGameLoop();
}

function exitTrafficGame() {
  stopTrafficGame();
  currentMode = 'driving';
  miniGamePaused = false;
  debugTrafficPreview = false;
  document.getElementById('traffic-game').classList.add('hidden');
  document.getElementById('traffic-game').classList.remove('touch-active');
  document.querySelector('.road-scene').classList.remove('paused');
  eventTick = 0;
  eventTickTarget = 12 + Math.floor(Math.random() * 9);
  startGameLoop();
}

// FIRE button — touchstart for instant response on mobile, click as desktop fallback
const fireBtn = document.getElementById('snack-hunt-fire');
fireBtn.addEventListener('touchstart', e => {
  e.preventDefault();                        // block ghost click & scroll
  if (currentMode === 'minigame-snack') fireProjectile();
}, { passive: false });
fireBtn.addEventListener('click', () => {
  if (currentMode === 'minigame-snack') fireProjectile();
});

// ── Virtual joystick ──────────────────────────────────────────────────────────
// The ring is 100px wide; deadzone is 10px from centre before a direction locks in.
// Nub is clamped to a 28px radius (half ring minus nub radius) so it stays inside.
const joystickRing = document.getElementById('snack-joystick');
const joystickNub  = document.getElementById('snack-joystick-nub');
const JOY_DEAD     = 10;  // px from centre before input registers
const JOY_NUB_MAX  = 22;  // max nub travel from centre (keeps nub inside ring)

let joyActive  = false;
let joyOriginX = 0;
let joyOriginY = 0;
let joyNubMax  = JOY_NUB_MAX;
let joyMoveX   = 0;
let joyMoveY   = 0;

function resetSnackInput() {
  joyActive = false;
  joyOriginX = 0;
  joyOriginY = 0;
  joyNubMax = JOY_NUB_MAX;
  joyMoveX = 0;
  joyMoveY = 0;
  joystickNub.style.transform = 'translate(-50%, -50%)';
  snackKeys['ArrowUp']    = false;
  snackKeys['ArrowDown']  = false;
  snackKeys['ArrowLeft']  = false;
  snackKeys['ArrowRight'] = false;
  snackKeys['w'] = false;
  snackKeys['a'] = false;
  snackKeys['s'] = false;
  snackKeys['d'] = false;
  snackKeys['W'] = false;
  snackKeys['A'] = false;
  snackKeys['S'] = false;
  snackKeys['D'] = false;
}

function joyStart(e) {
  e.preventDefault();
  resetSnackInput();
  joyActive = true;
  const touch = e.changedTouches[0];
  const rect  = joystickRing.getBoundingClientRect();
  joyOriginX  = rect.left + rect.width / 2;
  joyOriginY  = rect.top  + rect.height / 2;
  joyNubMax   = rect.width * 0.25;
  joyMove(e);
}

function joyMove(e) {
  if (!joyActive) return;
  e.preventDefault();
  const touch = e.changedTouches[0];
  let dx = touch.clientX - joyOriginX;
  let dy = touch.clientY - joyOriginY;

  // Clamp nub visually to ring interior
  const dist   = Math.sqrt(dx * dx + dy * dy);
  const clamp  = Math.min(dist, joyNubMax);
  const angle  = Math.atan2(dy, dx);
  joystickNub.style.transform =
    `translate(calc(-50% + ${Math.round(clamp * Math.cos(angle))}px), ` +
               `calc(-50% + ${Math.round(clamp * Math.sin(angle))}px))`;

  // Clear all four directions, then set whichever the stick points to
  snackKeys['ArrowUp']    = false;
  snackKeys['ArrowDown']  = false;
  snackKeys['ArrowLeft']  = false;
  snackKeys['ArrowRight'] = false;

  if (dist > JOY_DEAD) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }
    joyMoveX = dx;
    joyMoveY = dy;
  }
}

function joyEnd(e) {
  e.preventDefault();
  resetSnackInput();
}

joystickRing.addEventListener('touchstart', joyStart, { passive: false });
joystickRing.addEventListener('touchmove',  joyMove,  { passive: false });
joystickRing.addEventListener('touchend',   joyEnd,   { passive: false });
joystickRing.addEventListener('touchcancel',joyEnd,   { passive: false });
window.addEventListener('blur', resetSnackInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetSnackInput();
});

const trafficLeftBtn    = document.getElementById('traffic-left-btn');
const trafficForwardBtn = document.getElementById('traffic-forward-btn');
const trafficRightBtn   = document.getElementById('traffic-right-btn');

function trafficButtonLane(dir) {
  return e => {
    if (!isMobileTouchDevice()) return;
    e.preventDefault();
    if (currentMode === 'minigame-traffic') trafficSwitchLane(dir);
  };
}

function trafficForwardStart(e) {
  if (!isMobileTouchDevice()) return;
  e.preventDefault();
  if (currentMode === 'minigame-traffic') trafficKeys['ArrowUp'] = true;
}

function trafficForwardEnd(e) {
  if (!isMobileTouchDevice()) return;
  e.preventDefault();
  trafficKeys['ArrowUp'] = false;
}

if (trafficLeftBtn && trafficForwardBtn && trafficRightBtn) {
  trafficLeftBtn.addEventListener('touchstart', trafficButtonLane(-1), { passive: false });
  trafficRightBtn.addEventListener('touchstart', trafficButtonLane(1), { passive: false });
  trafficForwardBtn.addEventListener('touchstart', trafficForwardStart, { passive: false });
  trafficForwardBtn.addEventListener('touchend', trafficForwardEnd, { passive: false });
  trafficForwardBtn.addEventListener('touchcancel', trafficForwardEnd, { passive: false });
}

function initSnackHunt() {
  const canvas = document.getElementById('snack-hunt-canvas');
  const ctx    = canvas.getContext('2d');
  resetSnackInput();

  // Use offsetWidth/Height — not window.innerWidth/Height — so canvas resolution
  // matches its actual rendered CSS size. On mobile, window.innerHeight includes
  // browser chrome (URL bar) which is larger than the visible area, causing
  // vertical compression (squished player). offsetHeight is the real display size.
  canvas.width  = canvas.offsetWidth  || window.innerWidth;
  canvas.height = canvas.offsetHeight || window.innerHeight;

  // Must set AFTER resizing — changing canvas dimensions resets the 2D context.
  ctx.imageSmoothingEnabled = false;

  // Start player in centre of screen using fixed reference size
  const sprite0 = playerSprites.down[0];
  const sw = PLAYER_WIDTH;
  const sh = Math.round(PLAYER_WIDTH * (sprite0.naturalHeight || 240) / (sprite0.naturalWidth || 148));
  snackPlayer.x          = (canvas.width  - sw) / 2;
  snackPlayer.y          = (canvas.height - sh) / 2;
  snackPlayer.direction  = 'down';
  snackPlayer.frame      = 0;
  snackPlayer.frameTimer = 0;
  snackProjectiles.length = 0;

  // Spawn one of each snack type at fixed ground-level positions for testing
  snackItems.length = 0;
  snackAnimFrame    = 0;
  snackAnimTimer    = 0;
  snackRespawnTimer = 30; // spawn first snack after half a second
  junkBoss          = null;
  junkBossSpawned   = false;
  snackBossBonus    = 0;

  if (debugSnackPreview) {
    snackItems.push({ type: 'chips',   x: canvas.width * 0.28, y: canvas.height * 0.42, vx: 0, vy: 0 });
    snackItems.push({ type: 'candy',   x: canvas.width * 0.68, y: canvas.height * 0.40, vx: 0, vy: 0 });
    snackItems.push({ type: 'burrito', x: canvas.width * 0.50, y: canvas.height * 0.62, vx: 0, vy: 0 });
    snackHuntFramesLeft = SNACK_HUNT_DURATION;
  }

  // Reset per-session score tally and start the countdown
  snackCollected.chips   = 0;
  snackCollected.candy   = 0;
  snackCollected.burrito = 0;
  snackHuntFramesLeft    = SNACK_HUNT_DURATION;

  function loop() {
    if (currentMode !== 'minigame-snack') { snackHuntRaf = null; return; }

    // ── Bounds clamp ──────────────────────────────────────────────────────
    // Use frame 0 of current direction for a stable reference hitbox size
    const refSpr = playerSprites[snackPlayer.direction === 'left' ? 'right' : snackPlayer.direction][0];
    const cw = PLAYER_WIDTH;
    const ch = Math.round(PLAYER_WIDTH * (refSpr.naturalHeight || 240) / (refSpr.naturalWidth || 148));
    if (!miniGamePaused) {
      // ── Timer: count down, floor at 0 — no auto-exit ─────────────────────
      const prevFramesLeft = snackHuntFramesLeft;
      if (snackHuntFramesLeft > 0) snackHuntFramesLeft--;
      if (!junkBossSpawned && prevFramesLeft > 10 * 60 && snackHuntFramesLeft <= 10 * 60) {
        spawnJunkBoss(canvas.width, canvas.height);
      }
      updateJunkBoss(canvas.width, canvas.height, snackHuntFramesLeft <= 0);

      // ── Movement ──────────────────────────────────────────────────────────
      let moved = false;
      if (snackKeys['ArrowUp']    || snackKeys['w'] || snackKeys['W']) {
        snackPlayer.y         -= snackPlayer.speed;
        snackPlayer.direction  = 'up';
        moved = true;
      }
      if (snackKeys['ArrowDown']  || snackKeys['s'] || snackKeys['S']) {
        snackPlayer.y         += snackPlayer.speed;
        snackPlayer.direction  = 'down';
        moved = true;
      }
      if (snackKeys['ArrowLeft']  || snackKeys['a'] || snackKeys['A']) {
        snackPlayer.x         -= snackPlayer.speed;
        snackPlayer.direction  = 'left';
        moved = true;
      }
      if (snackKeys['ArrowRight'] || snackKeys['d'] || snackKeys['D']) {
        snackPlayer.x         += snackPlayer.speed;
        snackPlayer.direction  = 'right';
        moved = true;
      }
      if (joyMoveX || joyMoveY) {
        snackPlayer.x += joyMoveX * snackPlayer.speed;
        snackPlayer.y += joyMoveY * snackPlayer.speed;
        if (Math.abs(joyMoveX) > Math.abs(joyMoveY)) {
          if (joyMoveX < 0) snackPlayer.direction = 'left';
          else if (joyMoveX > 0) snackPlayer.direction = 'right';
        } else {
          if (joyMoveY < 0) snackPlayer.direction = 'up';
          else if (joyMoveY > 0) snackPlayer.direction = 'down';
        }
        moved = true;
      }

      // ── Walk animation ────────────────────────────────────────────────────
      if (moved) {
        snackPlayer.frameTimer++;
        if (snackPlayer.frameTimer >= WALK_FRAME_INTERVAL) {
          snackPlayer.frameTimer = 0;
          snackPlayer.frame      = snackPlayer.frame === 0 ? 1 : 0;
        }
      } else {
        // Idle — snap back to standing frame
        snackPlayer.frame      = 0;
        snackPlayer.frameTimer = 0;
      }

      snackPlayer.x = Math.max(0, Math.min(canvas.width  - cw, snackPlayer.x));
      snackPlayer.y = Math.max(0, Math.min(canvas.height - ch, snackPlayer.y));

      // ── Projectiles: move & cull ──────────────────────────────────────────
      for (let i = snackProjectiles.length - 1; i >= 0; i--) {
        const p = snackProjectiles[i];
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
          snackProjectiles.splice(i, 1);
        }
      }
    }

    // ── Render ────────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background — cover math: scale to fill canvas, no stretch, no black bars
    if (snackHuntBgImg.naturalWidth) {
      const scale = Math.max(
        canvas.width  / snackHuntBgImg.naturalWidth,
        canvas.height / snackHuntBgImg.naturalHeight
      );
      const bgW = Math.round(snackHuntBgImg.naturalWidth  * scale);
      const bgH = Math.round(snackHuntBgImg.naturalHeight * scale);
      ctx.drawImage(snackHuntBgImg,
        Math.round((canvas.width  - bgW) / 2),
        Math.round((canvas.height - bgH) / 2),
        bgW, bgH
      );
    }

    // Left reuses the right sprite, flipped — all other directions draw normally
    const sprDir  = snackPlayer.direction === 'left' ? 'right' : snackPlayer.direction;
    const drawSpr = playerSprites[sprDir][snackPlayer.frame];

    // Fixed width, aspect-correct height — no squishing between frames.
    // Width is always PLAYER_WIDTH; height derived from this frame's natural ratio.
    const playerRenderWidth = getSnackPlayerRenderWidth();
    const ow    = playerRenderWidth;
    const oh    = Math.round(playerRenderWidth * (refSpr.naturalHeight || 240) / (refSpr.naturalWidth || 148));
    const drawX = snackPlayer.x - (ow - cw) / 2;
    const drawY = snackPlayer.y + (ch - oh); // anchor feet at bottom of ref box

    if (snackPlayer.direction === 'left') {
      ctx.save();
      ctx.translate(drawX + ow, drawY);
      ctx.scale(-1, 1);
      ctx.drawImage(drawSpr, 0, 0, ow, oh);
      ctx.restore();
    } else {
      ctx.drawImage(drawSpr, drawX, drawY, ow, oh);
    }

    // ── Projectiles: draw ─────────────────────────────────────────────────
    ctx.fillStyle = '#f5c518'; // yellow placeholder dot
    snackProjectiles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PROJECTILE_SIZE, 0, Math.PI * 2);
      ctx.fill();
    });

    if (!miniGamePaused) {
      // ── Snacks: move & cull ───────────────────────────────────────────────
      for (let i = snackItems.length - 1; i >= 0; i--) {
        const s  = snackItems[i];
        s.x += s.vx;
        s.y += s.vy;
        const sw  = getSnackWidth(s.type);
        const spr0 = snackSprites[s.type][0];
        const sh  = spr0.naturalWidth ? Math.round(sw * spr0.naturalHeight / spr0.naturalWidth) : sw;
        // Remove when fully off any edge
        if (s.x + sw / 2 < 0 || s.x - sw / 2 > canvas.width ||
            s.y + sh / 2 < 0 || s.y - sh / 2 > canvas.height) {
          snackItems.splice(i, 1);
        }
      }
      // Spawn new snacks only while the timer is still running
      if (snackHuntFramesLeft > 0 && snackItems.length < SNACK_MAX) {
        snackRespawnTimer--;
        if (snackRespawnTimer <= 0) {
          snackItems.push(spawnNewSnack(canvas.width, canvas.height));
          snackRespawnTimer = SNACK_RESPAWN_MIN + Math.floor(Math.random() * (SNACK_RESPAWN_MAX - SNACK_RESPAWN_MIN));
        }
      }

      // ── Projectile–snack collision ────────────────────────────────────────
      outer: for (let pi = snackProjectiles.length - 1; pi >= 0; pi--) {
        const p = snackProjectiles[pi];
        if (junkBoss) {
          const dims = getJunkBossDimensions(junkBoss.hp);
          if (!isFiniteJunkBossValue(dims.w) || !isFiniteJunkBossValue(dims.h)) continue outer;
          const hit  = Math.abs(p.x - junkBoss.x) < dims.w / 2 + PROJECTILE_SIZE &&
                       Math.abs(p.y - junkBoss.y) < dims.h / 2 + PROJECTILE_SIZE;
          if (hit) {
            junkBoss.hitStage = getJunkBossStageIndex(junkBoss.hp);
            junkBoss.hitTimer = JUNK_BOSS_HIT_FLASH_FRAMES;
            junkBoss.hp--;
            snackProjectiles.splice(pi, 1);
            if (junkBoss.hp <= 0) {
              junkBoss = null;
              snackBossBonus += JUNK_BOSS_REWARD;
            }
            continue outer;
          }
        }
        for (let si = snackItems.length - 1; si >= 0; si--) {
          const s    = snackItems[si];
          const sw   = getSnackWidth(s.type);
          const spr0 = snackSprites[s.type][0];
          const sh   = spr0.naturalWidth
            ? Math.round(sw * spr0.naturalHeight / spr0.naturalWidth)
            : sw;
          const hit  = Math.abs(p.x - s.x) < sw / 2 + PROJECTILE_SIZE &&
                       Math.abs(p.y - s.y) < sh / 2 + PROJECTILE_SIZE;
          if (hit) {
            snackCollected[s.type]++;          // record for scoring
            snackItems.splice(si, 1);
            snackProjectiles.splice(pi, 1);
            // Shorten respawn wait after a hit so the game stays active
            if (snackRespawnTimer > 120) snackRespawnTimer = 120;
            continue outer;
          }
        }
      }
    }

    // ── Snack animation timer ─────────────────────────────────────────────
    snackAnimTimer++;
    if (snackAnimTimer >= SNACK_ANIM_INTERVAL) {
      snackAnimTimer = 0;
      snackAnimFrame = snackAnimFrame === 0 ? 1 : 0;
    }

    // ── Snacks: draw ──────────────────────────────────────────────────────
    snackItems.forEach(s => {
      const spr = snackSprites[s.type][snackAnimFrame];
      if (!spr.naturalWidth) return; // skip if not loaded yet
      const sw = getSnackWidth(s.type);
      const sh = Math.round(sw * spr.naturalHeight / spr.naturalWidth);
      ctx.drawImage(spr, Math.round(s.x - sw / 2), Math.round(s.y - sh / 2), sw, sh);
    });
    if (junkBoss) {
      const stage = junkBossSprites[getJunkBossStageIndex(junkBoss.hp)];
      const spr = junkBoss.hitTimer > 0 ? stage.hit : stage.normal[snackAnimFrame];
      const dims = getJunkBossDimensions(junkBoss.hp);
      if (!spr || !spr.naturalWidth || !isFiniteJunkBossValue(junkBoss.x) || !isFiniteJunkBossValue(junkBoss.y) ||
          !isFiniteJunkBossValue(dims.w) || !isFiniteJunkBossValue(dims.h)) {
        console.warn('Snack Hunt boss frame unavailable', { hp: junkBoss.hp, hitTimer: junkBoss.hitTimer });
      } else {
        ctx.drawImage(spr, Math.round(junkBoss.x - dims.w / 2), Math.round(junkBoss.y - dims.h / 2), dims.w, dims.h);
        const hpBarY = Math.round(junkBoss.y - dims.h / 2 - 12);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(Math.round(junkBoss.x - dims.w / 2), hpBarY, dims.w, 6);
        ctx.fillStyle = junkBoss.hp >= 7 ? '#3ddc84' : junkBoss.hp >= 4 ? '#ff9f1c' : '#ff4444';
        ctx.fillRect(Math.round(junkBoss.x - dims.w / 2), hpBarY, Math.round(dims.w * (junkBoss.hp / JUNK_BOSS_HP_MAX)), 6);
      }
    }

    // ── Score / Timer HUD ─────────────────────────────────────────────────
    const totalSnacks  = snackCollected.chips   * SNACK_POINTS.chips
                       + snackCollected.candy   * SNACK_POINTS.candy
                       + snackCollected.burrito * SNACK_POINTS.burrito;
    const secsLeft     = Math.ceil(snackHuntFramesLeft / 60);
    const timerDone    = snackHuntFramesLeft <= 0;
    const timerColor   = timerDone ? '#ff4444' : secsLeft <= 5 ? '#ff4444' : '#fff';
    const scoreText    = `🍟×${snackCollected.chips}  🍬×${snackCollected.candy}  🌯×${snackCollected.burrito}   +${totalSnacks} snacks`;
    const timerText    = timerDone ? `⏱ TIME'S UP` : `⏱ ${secsLeft}s`;

    ctx.save();
    ctx.font         = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur   = 4;
    // Score line
    ctx.fillStyle = '#fff';
    ctx.fillText(scoreText, 10, 10);
    // Timer line below — right-aligned so it doesn't clash with the score
    ctx.fillStyle  = timerColor;
    ctx.textAlign  = 'right';
    ctx.fillText(timerText, canvas.width - 10, 10);
    ctx.restore();

    snackHuntRaf = requestAnimationFrame(loop);
  }

  snackHuntRaf = requestAnimationFrame(loop);
}

function stopSnackHunt() {
  if (snackHuntRaf) { cancelAnimationFrame(snackHuntRaf); snackHuntRaf = null; }
  snackProjectiles.length = 0;
  snackItems.length       = 0;
  junkBoss = null;
  junkBossSpawned = false;
  snackBossBonus = 0;
  for (const k in snackKeys) delete snackKeys[k];
  // Reset joystick visual and state
  joyActive = false;
  joystickNub.style.transform = 'translate(-50%, -50%)';
}

// --- Event system ---
function setStatusMsg(msg, lockMs = 3500) {
  document.getElementById('status-msg').textContent = msg;
  statusLockUntil = Date.now() + lockMs;
}

function triggerEvent(event) {
  // Pause travel
  clearInterval(gameInterval);
  gameInterval = null;
  document.querySelector('.road-scene').classList.add('paused');

  // Populate event box
  document.getElementById('event-desc').textContent = event.desc;
  const choicesEl = document.getElementById('event-choices');
  choicesEl.innerHTML = '';
  event.choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = '► ' + choice.label;
    btn.addEventListener('click', () => resolveEvent(choice.effect));
    choicesEl.appendChild(btn);
  });

  document.getElementById('event-box').classList.remove('hidden');
  document.querySelector('.stats').classList.add('hidden');
  document.querySelector('.progress-section').classList.add('hidden');
  document.getElementById('passenger-row').classList.add('hidden');
}

function resolveEvent(effect) {
  // Apply choice effect (may change currentMode to a mini-game)
  effect();

  // Always close the event box
  document.getElementById('event-box').classList.add('hidden');
  document.querySelector('.stats').classList.remove('hidden');
  document.querySelector('.progress-section').classList.remove('hidden');
  document.getElementById('passenger-row').classList.remove('hidden');
  statusLockUntil += 4000;

  // Only resume driving if the effect didn't launch a mini-game
  if (currentMode === 'driving') {
    document.querySelector('.road-scene').classList.remove('paused');
    eventTick = 0;
    eventTickTarget = 12 + Math.floor(Math.random() * 9);
    startGameLoop();
  }
  // Otherwise the mini-game's own exit handler will restart driving
}

function startGameLoop() {
  if (gameInterval) clearInterval(gameInterval);

  // Per-second drain rates
  const GAS_DRAIN    = 0.55;
  const SNACK_DRAIN  = 0.6;
  const MORALE_BASE  = 0.5;
  const PROGRESS_GAIN = 0.8;

  gameInterval = setInterval(() => {
    // Gas always drains
    state.gas -= GAS_DRAIN;

    // Snacks drain
    state.snacks -= SNACK_DRAIN;
    if (state.snacks < 0) state.snacks = 0;

    // Morale drains faster with no snacks
    const snackPenalty = state.snacks <= 0 ? 0.8 : 0;
    state.morale -= (MORALE_BASE + snackPenalty);
    if (state.morale < 0) state.morale = 0;
    if (state.morale > state.moraleMax) state.morale = state.moraleMax; // cap to current max

    // Progress advances
    state.progress += PROGRESS_GAIN;

    updateTravelUI();
    checkCrashOuts(state.morale);

    // If a crash cutscene just fired, stop processing this tick
    if (isCrashScene) return;

    // Guaranteed milestone: Snack Hunt minigame at ~25% progress
    if (!snackHuntMilestone && state.progress >= 25) {
      snackHuntMilestone = true;
      triggerEvent({
        desc: 'You pull into a gas station. Everyone piles out. There are snacks everywhere.',
        choices: [
          {
            label: 'Go grab snacks (mini-game)',
            effect: () => { showSnackHunt(); }
          },
          {
            label: 'Just pump and go',
            effect: () => {
              state.gas    = Math.min(100, state.gas + 20);
              state.morale -= 8;
              setStatusMsg('Back on the road. Everyone is annoyed you didn\'t stop for snacks.');
            }
          }
        ]
      });
      return;
    }

    // Guaranteed milestone: Traffic minigame at ~50% progress
    if (!trafficMilestone && state.progress >= 50) {
      trafficMilestone = true;
      triggerEvent({
        desc: 'Traffic ahead. It\'s backed up as far as you can see. Everyone\'s already on edge.',
        choices: [
          {
            label: 'Weave through it (mini-game)',
            effect: () => { showTrafficGame(); }
          },
          {
            label: 'Sit and wait it out',
            effect: () => {
              state.gas    = Math.max(0, state.gas    - 10);
              state.morale = Math.max(0, state.morale - 15);
              setStatusMsg('Forty minutes of nothing. The dog ate someone\'s fries.');
            }
          }
        ]
      });
      return;
    }

    // Event pacing — increment tick, fire when target reached
    eventTick++;
    if (eventTick >= eventTickTarget) {
      eventTick = 0;
      eventTickTarget = 12 + Math.floor(Math.random() * 9); // 12–20s for next event
      triggerEvent(drawNextEvent());
      return;
    }

    // Win condition
    if (state.progress >= 100) {
      clearInterval(gameInterval);
      showScreen('screen-win');
      return;
    }

    // Lose conditions
    if (state.gas <= 0) {
      clearInterval(gameInterval);
      document.getElementById('lose-reason').textContent =
        'You ran out of gas on the side of the road.\nNo one is coming to help.';
      showScreen('screen-lose');
      return;
    }
    if (state.morale <= 0) {
      clearInterval(gameInterval);
      document.getElementById('lose-reason').textContent =
        'The family has completely lost it.\nTrip cancelled. No one is speaking to anyone.';
      showScreen('screen-lose');
      return;
    }
  }, 1000);
}

function startDriving() {
  initPassengers();

  // Calculate starting snacks from cart
  let snacks = 10; // base
  for (const [item, qty] of Object.entries(state.cart)) {
    if (snackValue[item]) snacks += snackValue[item] * qty;
  }

  state.gas      = 100;
  state.snacks   = snacks;
  state.morale   = 100;
  state.moraleMax = 100;
  state.progress  = 0;

  showScreen('screen-game');
  updateTravelUI();
  currentMode        = 'driving';
  snackHuntMilestone = false;  // reset so minigames fire fresh each trip
  trafficMilestone   = false;
  eventTick          = 0;
  eventTickTarget    = 12 + Math.floor(Math.random() * 9);
  eventDeck      = []; // fresh shuffle each new game
  lastEventIndex = -1;
  startGameLoop();
}

// --- Button wiring ---
function bindPress(el, handler) {
  el.addEventListener('click', handler);
  el.addEventListener('touchstart', e => {
    e.preventDefault();
    handler(e);
  }, { passive: false });
}

bindPress(document.getElementById('btn-drive'), () => showScreen('screen-name'));
bindPress(document.getElementById('btn-hit-road'), startDriving);
bindPress(document.getElementById('btn-start'), () => {
  resetShop();
  showScreen('screen-shop');
});
bindPress(document.getElementById('btn-how'), () => showScreen('screen-how'));
bindPress(document.getElementById('btn-credits'), () => showScreen('screen-credits'));

document.querySelectorAll('.back-btn').forEach(btn => {
  bindPress(btn, () => {
    if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
    eventTick = 0;
    document.getElementById('event-box').classList.add('hidden');
    document.querySelector('.stats').classList.remove('hidden');
    document.querySelector('.progress-section').classList.remove('hidden');
    document.getElementById('passenger-row').classList.remove('hidden');
    document.querySelector('.road-scene').classList.remove('paused');
    showScreen(btn.dataset.target);
  });
});
