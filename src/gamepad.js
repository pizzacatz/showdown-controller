// INPUT LAYER — polls the Gamepad API and emits normalized intent events.
// Knows nothing about Showdown. Fully injectable (getGamepads / requestFrame /
// now) so it can be unit tested with a fake pad and a fake clock.

export const BUTTON = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

export const BUTTON_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];
export const buttonLabel = i => BUTTON_LABELS[i] ?? `B${i}`;

// Standard-mapping button index → intent. Users can remap (see settings.js);
// these are the defaults. FORFEIT is arm-then-confirm in main.js — a single
// press never forfeits.
export const DEFAULT_BINDINGS = {
  [BUTTON.A]: 'CONFIRM',
  [BUTTON.B]: 'BACK',
  [BUTTON.X]: 'SWITCH_MENU',
  [BUTTON.RB]: 'GIMMICK',
  [BUTTON.LB]: 'SKIP_TURN',
  [BUTTON.Y]: 'SKIP_TO_END',
  [BUTTON.BACK]: 'FORFEIT',
  [BUTTON.START]: 'TOGGLE_LAYER',
  [BUTTON.RT]: 'CLOSE_TAB',
  [BUTTON.L3]: 'PREV_TAB',
  [BUTTON.R3]: 'NEXT_TAB',
  [BUTTON.UP]: 'UP',
  [BUTTON.DOWN]: 'DOWN',
  [BUTTON.LEFT]: 'LEFT',
  [BUTTON.RIGHT]: 'RIGHT',
};
export const BINDINGS = DEFAULT_BINDINGS;

export const INTENTS = [
  { id: 'CONFIRM', label: 'Confirm / select' },
  { id: 'BACK', label: 'Back / cancel' },
  { id: 'SWITCH_MENU', label: 'Jump to party list' },
  { id: 'GIMMICK', label: 'Toggle Tera / gimmick' },
  { id: 'SKIP_TURN', label: 'Skip turn' },
  { id: 'SKIP_TO_END', label: 'Skip to end' },
  { id: 'FORFEIT', label: 'Forfeit (press twice)' },
  { id: 'TOGGLE_LAYER', label: 'Controller layer on/off' },
  { id: 'CLOSE_TAB', label: 'Close current Showdown tab' },
  { id: 'PREV_TAB', label: 'Previous tab' },
  { id: 'NEXT_TAB', label: 'Next tab' },
  { id: 'UP', label: 'Cursor up' },
  { id: 'DOWN', label: 'Cursor down' },
  { id: 'LEFT', label: 'Cursor left' },
  { id: 'RIGHT', label: 'Cursor right' },
];

export const DIRECTIONS = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);

export const DEFAULTS = {
  deadzone: 0.5,        // analog stick threshold on axes 0/1
  repeatDelay: 400,     // ms held before the first repeat of a direction
  repeatInterval: 120,  // ms between subsequent repeats
};

/**
 * Compute the set of intents currently "pressed" on a pad.
 * Directions from the stick are mutually exclusive (dominant axis wins).
 */
export function readIntents(pad, deadzone = DEFAULTS.deadzone, bindings = DEFAULT_BINDINGS) {
  const active = new Set();
  if (!pad) return active;
  const buttons = pad.buttons || [];
  for (const [index, intent] of Object.entries(bindings)) {
    const b = buttons[index];
    if (b && (b.pressed || b.value > 0.5)) active.add(intent);
  }
  const axes = pad.axes || [];
  const x = axes[0] || 0;
  const y = axes[1] || 0;
  if (Math.abs(x) >= deadzone || Math.abs(y) >= deadzone) {
    if (Math.abs(x) >= Math.abs(y)) active.add(x < 0 ? 'LEFT' : 'RIGHT');
    else active.add(y < 0 ? 'UP' : 'DOWN');
  }
  return active;
}

/**
 * Pick the pad to listen to: the first non-null pad with the standard
 * mapping. Non-standard pads are reported via onStatus once and ignored.
 */
export function selectPad(pads, seenNonStandard, onStatus) {
  if (!pads) return null;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (!pad) continue;
    if (pad.mapping !== 'standard') {
      const key = `${pad.index}:${pad.id}`;
      if (!seenNonStandard.has(key)) {
        seenNonStandard.add(key);
        onStatus({ type: 'nonstandard', pad: { index: pad.index, id: pad.id, mapping: pad.mapping } });
      }
      continue;
    }
    return pad;
  }
  return null;
}

/**
 * Create the poller.
 *  getGamepads(): array-like of Gamepad|null (defaults to navigator.getGamepads)
 *  requestFrame(cb) / cancelFrame(id): scheduling (defaults to rAF)
 *  now(): ms clock (defaults to performance.now)
 *  onEvent({ type, repeat, padIndex }): intent callback
 *  onRawButton(index): any button rising edge, before bindings (for remapping UI)
 *  onStatus({ type, ... }): 'connected' | 'disconnected' | 'nonstandard'
 *  bindings: object or () => object (button index → intent), default DEFAULT_BINDINGS
 */
export function createGamepadInput(options = {}) {
  const {
    getGamepads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []),
    requestFrame = cb => requestAnimationFrame(cb),
    cancelFrame = id => cancelAnimationFrame(id),
    now = () => performance.now(),
    onEvent = () => {},
    onRawButton = () => {},
    onStatus = () => {},
    bindings = DEFAULT_BINDINGS,
    deadzone = DEFAULTS.deadzone,
    repeatDelay = DEFAULTS.repeatDelay,
    repeatInterval = DEFAULTS.repeatInterval,
  } = options;

  let running = false;
  let frameId = null;
  let prev = new Set();                // intents pressed last frame
  let prevRaw = [];                     // raw pressed booleans last frame
  const heldSince = new Map();          // direction → timestamp of press
  const nextRepeat = new Map();         // direction → timestamp of next repeat
  const seenNonStandard = new Set();
  let currentPadIndex = null;

  function emit(type, repeat, padIndex) {
    onEvent({ type, repeat, padIndex });
  }

  /** One polling step. Exposed for tests; the loop calls it each frame. */
  function poll(t = now()) {
    let pads;
    try { pads = getGamepads(); } catch (_) { pads = null; }
    const pad = selectPad(pads, seenNonStandard, onStatus);

    if (!pad) {
      if (currentPadIndex !== null) {
        onStatus({ type: 'disconnected', padIndex: currentPadIndex });
        currentPadIndex = null;
      }
      // Release everything so a re-plugged pad doesn't inherit held state.
      prev = new Set(); prevRaw = []; heldSince.clear(); nextRepeat.clear();
      return false;
    }
    if (currentPadIndex !== pad.index) {
      currentPadIndex = pad.index;
      onStatus({ type: 'connected', padIndex: pad.index, id: pad.id });
      prev = new Set(); heldSince.clear(); nextRepeat.clear();
    }

    // Raw rising edges (any button) — used by the remap UI.
    const rawNow = (pad.buttons || []).map(b => !!(b && (b.pressed || b.value > 0.5)));
    for (let i = 0; i < rawNow.length; i++) if (rawNow[i] && !prevRaw[i]) onRawButton(i, pad.index);
    prevRaw = rawNow;

    const active = readIntents(pad, deadzone, typeof bindings === 'function' ? bindings() : bindings);

    // Rising edges
    for (const intent of active) {
      if (!prev.has(intent)) {
        emit(intent, false, pad.index);
        if (DIRECTIONS.has(intent)) {
          heldSince.set(intent, t);
          nextRepeat.set(intent, t + repeatDelay);
        }
      } else if (DIRECTIONS.has(intent)) {
        // Held direction: repeat on schedule
        const due = nextRepeat.get(intent);
        if (due !== undefined && t >= due) {
          emit(intent, true, pad.index);
          nextRepeat.set(intent, t + repeatInterval);
        }
      }
    }
    // Falling edges: clear repeat timers
    for (const intent of prev) {
      if (!active.has(intent)) {
        heldSince.delete(intent);
        nextRepeat.delete(intent);
      }
    }
    prev = active;
    return true;
  }

  function loop() {
    if (!running) return;
    poll();
    frameId = requestFrame(loop);
  }

  return {
    start() {
      if (running) return;
      running = true;
      frameId = requestFrame(loop);
    },
    stop() {
      running = false;
      if (frameId !== null) { cancelFrame(frameId); frameId = null; }
      prev = new Set(); heldSince.clear(); nextRepeat.clear();
      if (currentPadIndex !== null) {
        onStatus({ type: 'disconnected', padIndex: currentPadIndex });
        currentPadIndex = null;
      }
    },
    poll,
    isRunning: () => running,
    get padIndex() { return currentPadIndex; },
  };
}
