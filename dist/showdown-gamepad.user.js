// ==UserScript==
// @name         Showdown Gamepad
// @namespace    https://github.com/pizzacatz/showdown-controller
// @version      0.6.0
// @description  Play Pokémon Showdown battles with an XInput controller: D-pad/stick cursor, A confirm, B back, X switch menu, Y tera/gimmick. Mouse and keyboard keep working.
// @author       pizzacatz
// @license      MIT
// @match        *://play.pokemonshowdown.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/pizzacatz/showdown-controller/main/dist/showdown-gamepad.user.js
// @downloadURL  https://raw.githubusercontent.com/pizzacatz/showdown-controller/main/dist/showdown-gamepad.user.js
// ==/UserScript==

'use strict';
(() => {
  // src/gamepad.js
  var BUTTON = {
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    BACK: 8,
    START: 9,
    L3: 10,
    R3: 11,
    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15
  };
  var BUTTON_LABELS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Select", "Start", "L3", "R3", "Up", "Down", "Left", "Right"];
  var buttonLabel = (i) => BUTTON_LABELS[i] ?? `B${i}`;
  var DEFAULT_BINDINGS = {
    [BUTTON.A]: "CONFIRM",
    [BUTTON.B]: "BACK",
    [BUTTON.X]: "SWITCH_MENU",
    [BUTTON.RB]: "GIMMICK",
    [BUTTON.LB]: "SKIP_TURN",
    [BUTTON.Y]: "SKIP_TO_END",
    [BUTTON.BACK]: "FORFEIT",
    [BUTTON.START]: "TOGGLE_LAYER",
    [BUTTON.RT]: "CLOSE_TAB",
    [BUTTON.L3]: "PREV_TAB",
    [BUTTON.R3]: "NEXT_TAB",
    [BUTTON.UP]: "UP",
    [BUTTON.DOWN]: "DOWN",
    [BUTTON.LEFT]: "LEFT",
    [BUTTON.RIGHT]: "RIGHT"
  };
  var INTENTS = [
    { id: "CONFIRM", label: "Confirm / select" },
    { id: "BACK", label: "Back / cancel" },
    { id: "SWITCH_MENU", label: "Jump to party list" },
    { id: "GIMMICK", label: "Toggle Tera / gimmick" },
    { id: "SKIP_TURN", label: "Skip turn" },
    { id: "SKIP_TO_END", label: "Skip to end" },
    { id: "FORFEIT", label: "Forfeit (press twice)" },
    { id: "TOGGLE_LAYER", label: "Controller layer on/off" },
    { id: "CLOSE_TAB", label: "Close current Showdown tab" },
    { id: "PREV_TAB", label: "Previous tab" },
    { id: "NEXT_TAB", label: "Next tab" },
    { id: "UP", label: "Cursor up" },
    { id: "DOWN", label: "Cursor down" },
    { id: "LEFT", label: "Cursor left" },
    { id: "RIGHT", label: "Cursor right" }
  ];
  var DIRECTIONS = /* @__PURE__ */ new Set(["UP", "DOWN", "LEFT", "RIGHT"]);
  var DEFAULTS = {
    deadzone: 0.5,
    // analog stick threshold on axes 0/1
    repeatDelay: 400,
    // ms held before the first repeat of a direction
    repeatInterval: 120
    // ms between subsequent repeats
  };
  function readIntents(pad, deadzone = DEFAULTS.deadzone, bindings = DEFAULT_BINDINGS) {
    const active = /* @__PURE__ */ new Set();
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
      if (Math.abs(x) >= Math.abs(y)) active.add(x < 0 ? "LEFT" : "RIGHT");
      else active.add(y < 0 ? "UP" : "DOWN");
    }
    return active;
  }
  function selectPad(pads, seenNonStandard, onStatus) {
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      if (pad.mapping !== "standard") {
        const key = `${pad.index}:${pad.id}`;
        if (!seenNonStandard.has(key)) {
          seenNonStandard.add(key);
          onStatus({ type: "nonstandard", pad: { index: pad.index, id: pad.id, mapping: pad.mapping } });
        }
        continue;
      }
      return pad;
    }
    return null;
  }
  function createGamepadInput(options = {}) {
    const {
      getGamepads = () => typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [],
      requestFrame = (cb) => requestAnimationFrame(cb),
      cancelFrame = (id) => cancelAnimationFrame(id),
      now = () => performance.now(),
      onEvent = () => {
      },
      onRawButton = () => {
      },
      onStatus = () => {
      },
      bindings = DEFAULT_BINDINGS,
      deadzone = DEFAULTS.deadzone,
      repeatDelay = DEFAULTS.repeatDelay,
      repeatInterval = DEFAULTS.repeatInterval
    } = options;
    let running = false;
    let frameId = null;
    let prev = /* @__PURE__ */ new Set();
    let prevRaw = [];
    const heldSince = /* @__PURE__ */ new Map();
    const nextRepeat = /* @__PURE__ */ new Map();
    const seenNonStandard = /* @__PURE__ */ new Set();
    let currentPadIndex = null;
    function emit(type, repeat, padIndex) {
      onEvent({ type, repeat, padIndex });
    }
    function poll(t = now()) {
      let pads;
      try {
        pads = getGamepads();
      } catch (_) {
        pads = null;
      }
      const pad = selectPad(pads, seenNonStandard, onStatus);
      if (!pad) {
        if (currentPadIndex !== null) {
          onStatus({ type: "disconnected", padIndex: currentPadIndex });
          currentPadIndex = null;
        }
        prev = /* @__PURE__ */ new Set();
        prevRaw = [];
        heldSince.clear();
        nextRepeat.clear();
        return false;
      }
      if (currentPadIndex !== pad.index) {
        currentPadIndex = pad.index;
        onStatus({ type: "connected", padIndex: pad.index, id: pad.id });
        prev = /* @__PURE__ */ new Set();
        heldSince.clear();
        nextRepeat.clear();
      }
      const rawNow = (pad.buttons || []).map((b) => !!(b && (b.pressed || b.value > 0.5)));
      for (let i = 0; i < rawNow.length; i++) if (rawNow[i] && !prevRaw[i]) onRawButton(i, pad.index);
      prevRaw = rawNow;
      const active = readIntents(pad, deadzone, typeof bindings === "function" ? bindings() : bindings);
      for (const intent of active) {
        if (!prev.has(intent)) {
          emit(intent, false, pad.index);
          if (DIRECTIONS.has(intent)) {
            heldSince.set(intent, t);
            nextRepeat.set(intent, t + repeatDelay);
          }
        } else if (DIRECTIONS.has(intent)) {
          const due = nextRepeat.get(intent);
          if (due !== void 0 && t >= due) {
            emit(intent, true, pad.index);
            nextRepeat.set(intent, t + repeatInterval);
          }
        }
      }
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
        if (frameId !== null) {
          cancelFrame(frameId);
          frameId = null;
        }
        prev = /* @__PURE__ */ new Set();
        heldSince.clear();
        nextRepeat.clear();
        if (currentPadIndex !== null) {
          onStatus({ type: "disconnected", padIndex: currentPadIndex });
          currentPadIndex = null;
        }
      },
      poll,
      isRunning: () => running,
      get padIndex() {
        return currentPadIndex;
      }
    };
  }

  // src/cursor.js
  var PANE_PRIORITY = ["POPUP", "TARGET", "SWITCH_TARGET", "TEAM", "MOVE", "SWITCH", "PLAYBACK", "MENU"];
  function initialState() {
    return { pane: "INACTIVE", index: 0, focusId: null, screenKey: null, memory: {} };
  }
  function availablePanes(screen) {
    const out = [];
    for (const name of PANE_PRIORITY) {
      const p = screen && screen.panes && screen.panes[name];
      if (p && p.items && p.items.length) out.push(name);
    }
    return out;
  }
  function clamp(i, n) {
    if (n <= 0) return 0;
    return Math.max(0, Math.min(n - 1, i));
  }
  function columnsOf(pane) {
    const n = pane.items.length;
    const c = pane.columns | 0;
    return c > 0 ? Math.min(c, n) : n;
  }
  function nearest(items, i, ok) {
    if (!items.length) return -1;
    i = clamp(i, items.length);
    if (ok(items[i])) return i;
    for (let d = 1; d < items.length; d++) {
      if (i + d < items.length && ok(items[i + d])) return i + d;
      if (i - d >= 0 && ok(items[i - d])) return i - d;
    }
    return -1;
  }
  var landable = (it) => !it.skip;
  var enabled = (it) => !it.skip && !it.disabled;
  var nearestLandable = (items, i) => nearest(items, i, landable);
  function sync(state, screen) {
    const avail = availablePanes(screen);
    const controls = screen && screen.controls || {};
    const memory = { ...state.memory || {} };
    if (state.pane && state.focusId && !["WAIT", "INACTIVE"].includes(state.pane)) {
      memory[state.pane] = state.focusId;
    }
    if (!avail.length) {
      const pane2 = controls.cancel ? "WAIT" : "INACTIVE";
      return { ...state, pane: pane2, index: 0, focusId: null, screenKey: screen ? screen.key : null, memory };
    }
    const sameScreen = state.screenKey === (screen.key ?? null);
    const pane = sameScreen && avail.includes(state.pane) ? state.pane : avail[0];
    const items = screen.panes[pane].items;
    const wantId = pane === state.pane ? state.focusId : memory[pane];
    let index = -1;
    if (wantId != null) index = items.findIndex((it) => it.id === wantId);
    if (index < 0) index = pane === state.pane ? clamp(state.index, items.length) : 0;
    const want = sameScreen ? landable : enabled;
    let landed = nearest(items, index, want);
    if (landed < 0) landed = nearestLandable(items, index);
    index = landed < 0 ? 0 : landed;
    return {
      ...state,
      pane,
      index,
      focusId: items[index] ? items[index].id : null,
      screenKey: screen.key ?? null,
      memory
    };
  }
  function move(items, columns, index, dir, wrap = false) {
    const n = items.length;
    if (!n) return index;
    const c = Math.max(1, Math.min(columns | 0 || n, n));
    const row = (i) => Math.floor(i / c);
    const lastRow = row(n - 1);
    const rowStart = (r) => r * c;
    const rowEnd = (r) => Math.min(n - 1, r * c + c - 1);
    if (wrap && (dir === "UP" || dir === "DOWN")) {
      const col = index - rowStart(row(index));
      const rowsN = lastRow + 1;
      for (let k = 1; k <= rowsN; k++) {
        const r = ((row(index) + (dir === "DOWN" ? k : -k)) % rowsN + rowsN) % rowsN;
        const i = Math.min(rowStart(r) + col, rowEnd(r));
        if (!items[i].skip) return i;
      }
      return index;
    }
    if (dir === "LEFT" || dir === "RIGHT") {
      const step = dir === "LEFT" ? -1 : 1;
      const r = row(index);
      let i = index + step;
      while (i >= rowStart(r) && i <= rowEnd(r)) {
        if (!items[i].skip) return i;
        i += step;
      }
      return index;
    }
    if (dir === "UP" || dir === "DOWN") {
      const r = row(index);
      const targetRow = dir === "UP" ? r - 1 : r + 1;
      if (targetRow < 0 || targetRow > lastRow) return index;
      const col = index - rowStart(r);
      const start2 = rowStart(targetRow), end = rowEnd(targetRow);
      let i = clamp(start2 + col, n);
      if (i > end) i = end;
      if (!items[i].skip) return i;
      for (let d = 1; d <= c; d++) {
        if (i + d <= end && !items[i + d].skip) return i + d;
        if (i - d >= start2 && !items[i - d].skip) return i - d;
      }
      const next = move(items, columns, i, dir);
      return next === i ? index : next;
    }
    return index;
  }
  function reduce(state, event, screen) {
    state = sync(state, screen);
    const type = typeof event === "string" ? event : event && event.type;
    const controls = screen && screen.controls || {};
    const pane = state.pane;
    const paneData = screen && screen.panes && screen.panes[pane];
    const items = paneData ? paneData.items : [];
    const none = { state, action: null };
    switch (type) {
      case "UP":
      case "DOWN":
      case "LEFT":
      case "RIGHT": {
        if (!items.length) return none;
        const index = move(items, columnsOf(paneData), state.index, type, !!paneData.wrap);
        if (index === state.index) {
          const avail = availablePanes(screen);
          if (type === "DOWN" && pane === "MOVE" && avail.includes("SWITCH")) {
            return { state: switchPane(state, screen, "SWITCH"), action: controls.selectSwitch ? { type: "selectSwitch" } : null };
          }
          if (type === "UP" && pane === "SWITCH" && avail.includes("MOVE")) {
            return { state: switchPane(state, screen, "MOVE"), action: controls.selectMove ? { type: "selectMove" } : null };
          }
          return none;
        }
        const focusId = items[index].id;
        return { state: { ...state, index, focusId, memory: { ...state.memory, [pane]: focusId } }, action: null };
      }
      case "CONFIRM": {
        const item = items[state.index];
        if (!item || item.disabled || item.skip) return none;
        return { state, action: { type: "activate", pane, index: state.index, id: item.id } };
      }
      case "BACK": {
        if (pane === "POPUP") return controls.closePopup ? { state, action: { type: "closePopup" } } : none;
        if (pane === "WAIT") return controls.cancel ? { state, action: { type: "cancel" } } : none;
        if (pane === "SWITCH" && availablePanes(screen).includes("MOVE")) {
          return { state: switchPane(state, screen, "MOVE"), action: controls.selectMove ? { type: "selectMove" } : null };
        }
        if (controls.back) return { state, action: { type: "back" } };
        return none;
      }
      case "SWITCH_MENU": {
        if (pane !== "SWITCH" && availablePanes(screen).includes("SWITCH")) {
          return { state: switchPane(state, screen, "SWITCH"), action: controls.selectSwitch ? { type: "selectSwitch" } : null };
        }
        return none;
      }
      case "GIMMICK":
        return controls.gimmick ? { state, action: { type: "gimmick" } } : none;
      case "SKIP_TURN":
        return controls.skipTurn ? { state, action: { type: "skipTurn" } } : none;
      case "SKIP_TO_END":
        return controls.goToEnd ? { state, action: { type: "goToEnd" } } : none;
      case "CLOSE_TAB":
        return { state, action: { type: "closeTab" } };
      case "PREV_TAB":
        return { state, action: { type: "prevTab" } };
      case "NEXT_TAB":
        return { state, action: { type: "nextTab" } };
      default:
        return none;
    }
  }
  function switchPane(state, screen, pane) {
    const items = screen.panes[pane].items;
    const memory = { ...state.memory };
    if (state.focusId && state.pane !== "WAIT" && state.pane !== "INACTIVE") memory[state.pane] = state.focusId;
    let index = memory[pane] != null ? items.findIndex((it) => it.id === memory[pane]) : -1;
    if (index < 0) index = nearest(items, 0, enabled);
    if (index < 0) index = nearestLandable(items, 0);
    if (index < 0) index = 0;
    return { ...state, pane, index, focusId: items[index] ? items[index].id : null, memory };
  }

  // src/showdown-dom.js
  var SELECTORS = {
    room: '.ps-room[id^="room-battle-"], .ps-room[id^="room-game-"]',
    controls: ".battle-controls",
    whatdo: ".whatdo",
    moveButtons: ".movecontrols .movemenu button.movebutton",
    targetButtons: 'button[name="chooseMoveTarget"]',
    switchTargetButtons: 'button[name="chooseSwitchTarget"]',
    teamPreviewButtons: 'button[name="chooseTeamPreview"]',
    switchMenu: ".switchcontrols .switchmenu",
    switchMenuAny: ".switchmenu",
    back: 'button[name="clearChoice"]',
    cancel: 'button[name="undoChoice"]',
    gimmick: '.megaevo-box input[type="checkbox"], label.megaevo input[type="checkbox"]',
    selectSwitch: 'button[name="selectSwitch"]',
    selectMove: 'button[name="selectMove"]',
    skipTurn: 'button[name="skipTurn"]',
    goToEnd: 'button[name="goToEnd"]',
    timer: ".timerbutton, .timer",
    // Playback + end-of-battle buttons. Upload/download replay are left out on
    // purpose (outward-facing); QoL Battle Tools already automates them.
    playback: 'button[name="pause"], button[name="play"], button[name="instantReplay"], button[name="rewindTurn"], button[name="skipTurn"], button[name="goToEnd"], button[name="closeAndMainMenu"], button[name="closeAndRematch"]',
    // Modal popups (format picker, team picker, confirmations, errors). Topmost = last in DOM.
    popup: ".ps-popup",
    popupClose: 'button[name="close"]',
    // Main menu (room id '' → element #room-). Includes injected buttons (Ghost Clicker) since they are plain buttons too.
    mainMenu: ".mainmenu",
    mainMenuRoom: "#room-",
    // Only the battle group of the main menu: format selector, injected quick-
    // select buttons (Ghost Clicker), team selector, Battle! / Cancel search.
    mainMenuBattleForm: "form.battleform",
    menuGroup: ".menugroup",
    roomTabClose: 'button[name="closeRoom"]',
    roomTabs: ".maintabbar a.roomtab[href]",
    // one per open tab, DOM order = visual order; .cur = current
    headings: { MOVE: ".moveselect button", SWITCH: ".switchselect button", TEAM: ".switchselect button" },
    qolForfeit: 'button[data-qol="forfeit"]'
    // QoL Battle Tools' arm-then-confirm forfeit button, if installed
  };
  var CURSOR_CLASS = "sgp-cursor";
  var PANE_CLASS = "sgp-pane";
  var DISABLED_CLASS = "sgp-disabled";
  var HEADING_CLASS = "sgp-heading";
  var HINT_CLASS = "sgp-hint";
  var BADGE_ID = "sgp-status";
  var STYLE_ID = "sgp-cursor-style";
  var CURSOR_CSS = `
/* ---- Visual language (see docs/ui-design.md) --------------------------------
   Layer 1  item cursor   : two-tone ring (white inner, orange outer). The ONLY
                            high-contrast element; slow two-state pulse.
   Layer 2  active group  : soft orange tray behind the row + tinted heading.
   Layer 3  not selectable: gray translucent overlay + desaturation. The ring
                            still draws on top when the cursor lands there.
   One accent (orange). No blue (Showdown uses it for Water/Ice moves, links,
   the Switch heading), no red/yellow/green (HP-bar states). Red is reserved
   for the armed-forfeit state of the status pill.
------------------------------------------------------------------------------ */
.${CURSOR_CLASS} {
  outline: 2px solid #fff !important;          /* inner ring */
  outline-offset: -2px !important;
  box-shadow: 0 0 0 3px #ff8c00 !important;    /* outer ring */
  position: relative;
  z-index: 2;
  animation: sgp-pulse 1.6s steps(1, end) infinite;
}
@keyframes sgp-pulse {
  0%   { box-shadow: 0 0 0 3px #ff8c00; }
  50%  { box-shadow: 0 0 0 4px #ff8c00; }
  100% { box-shadow: 0 0 0 3px #ff8c00; }
}
@media (prefers-reduced-motion: reduce) { .${CURSOR_CLASS} { animation: none; } }

/* Not selectable (0 PP, active/fainted mon, chosen team slot, disabled target). */
.${DISABLED_CLASS} { position: relative; filter: saturate(0.35); }
.${DISABLED_CLASS}::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: rgba(110, 110, 110, 0.42);
}
.dark .${DISABLED_CLASS}::after { background: rgba(0, 0, 0, 0.45); }

/* Active group: a tray behind the row (overlay sized to the union of the
   pane's buttons, painted BELOW the buttons via isolation + negative z-index)
   and the row's heading (Attack / Switch) tinted. */
.battle-controls { isolation: isolate; }
.${PANE_CLASS} {
  position: absolute; pointer-events: none; z-index: -1;
  background: rgba(255, 140, 0, 0.22); border-radius: 8px;
}
.dark .${PANE_CLASS} { background: rgba(255, 140, 0, 0.25); }
.${HEADING_CLASS} { color: #d97400 !important; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
.dark .${HEADING_CLASS} { color: #ffa640 !important; }

/* Button hints, e.g. "(RB)" next to Terastallize \u2014 same accent and radius as the ring. */
.${HINT_CLASS} {
  font: bold 9px/1 Verdana, sans-serif; color: #fff; background: #ff8c00;
  border-radius: 4px; padding: 2px 5px; margin-left: 4px; vertical-align: middle;
  pointer-events: none;
}
/* Standalone forfeit hint (by the Timer button) when no forfeit button exists to attach to. */
.${HINT_CLASS}.sgp-hint-forfeit { position: absolute; right: 78px; top: 9px; margin: 0; z-index: 3; }

/* Status pill: accent = on, gray = waiting, red = off / forfeit armed. */
#${BADGE_ID} {
  position: fixed; right: 8px; bottom: 8px; z-index: 9999;
  font: 11px/1.4 Verdana, sans-serif; color: #fff;
  background: rgba(60, 60, 60, 0.9); border-radius: 12px; padding: 3px 10px;
  cursor: pointer; user-select: none;
}
#${BADGE_ID}[data-state="on"] { background: #c96f00; }
#${BADGE_ID}[data-state="off"] { background: #a52a2a; }
`;
  function textOf(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim();
    }
    return (el.textContent || "").trim();
  }
  function createAdapter(options = {}) {
    const doc = options.doc || document;
    const win = options.win || window;
    const isVisible = options.isVisible || ((el) => !!(el && (el.offsetParent || el.getClientRects().length)));
    const rectOf = options.rectOf || ((el) => el.getBoundingClientRect());
    function getRoom() {
      const app = win.app;
      if (app && app.curRoom && app.curRoom.$el && app.curRoom.$el[0]) {
        const el = app.curRoom.$el[0];
        if (el.querySelector(SELECTORS.controls)) return el;
      }
      for (const el of doc.querySelectorAll(SELECTORS.room)) {
        if (el.style.display !== "none" && el.querySelector(SELECTORS.controls)) return el;
      }
      return null;
    }
    function getControls() {
      const room = getRoom();
      return room ? room.querySelector(SELECTORS.controls) : null;
    }
    function itemOf(el, i, kind) {
      const name = el.getAttribute("name");
      const value = el.getAttribute("value");
      const text = textOf(el);
      const disabledAttr = !!el.disabled;
      const disabledClass = el.classList.contains("disabled") || name === "chooseDisabled";
      const skip = !name && (!text || el.style && el.style.visibility === "hidden");
      let id;
      if (kind === "MOVE") id = `move:${el.dataset.move || text || i}`;
      else if (kind === "PLAYBACK") id = `PLAYBACK:${name || text || i}`;
      else if (kind === "POPUP" || kind === "MENU") id = `${kind}:${name || "x"}:${value ?? ""}:${text || i}`;
      else if (kind === "TARGET" || kind === "SWITCH_TARGET") id = `${kind}:${name || "x"}:${value ?? i}`;
      else id = `${kind}:${text || name + ":" + value || i}`;
      return { id, el, disabled: disabledAttr || disabledClass, skip };
    }
    function pane(kind, els) {
      const visible = els.filter(isVisible);
      if (!visible.length) return null;
      const rects = visible.map((el) => rectOf(el) || { top: 0, left: 0, width: 0, height: 0 });
      if (rects.every((r) => !r.top && !r.left && !r.width)) {
        return { items: visible.map((el, i) => itemOf(el, i, kind)), columns: visible.length };
      }
      const rows = [];
      visible.forEach((el, i) => {
        const r = rects[i];
        let row = rows.find((rw) => Math.abs(rw.top - r.top) <= 4);
        if (!row) {
          row = { top: r.top, cells: [] };
          rows.push(row);
        }
        row.cells.push({ el, left: r.left, i });
      });
      rows.sort((a, b) => a.top - b.top);
      rows.forEach((rw) => rw.cells.sort((a, b) => a.left - b.left || a.i - b.i));
      const columns = Math.max(...rows.map((rw) => rw.cells.length));
      const items = [];
      rows.forEach((rw, ri) => {
        rw.cells.forEach((c) => items.push(itemOf(c.el, c.i, kind)));
        for (let c = rw.cells.length; c < columns; c++) items.push({ id: `${kind}:pad:${ri}:${c}`, el: null, disabled: true, skip: true });
      });
      return { items, columns };
    }
    function getPopup() {
      const pops = Array.from(doc.querySelectorAll(SELECTORS.popup)).filter(isVisible);
      return pops.length ? pops[pops.length - 1] : null;
    }
    function getMainMenu() {
      const app = win.app;
      let roomEl = null;
      if (app && app.curRoom && app.curRoom.$el && app.curRoom.$el[0]) roomEl = app.curRoom.$el[0];
      else {
        const el = doc.querySelector(SELECTORS.mainMenuRoom);
        if (el && el.style.display !== "none") roomEl = el;
      }
      if (!roomEl || roomEl.id && roomEl.id !== "room-") return null;
      return roomEl.querySelector(SELECTORS.mainMenu);
    }
    function readScreen() {
      const popup = getPopup();
      if (popup) {
        const p = pane("POPUP", Array.from(popup.querySelectorAll("button")));
        return { key: `popup|${popup.id || ""}|${p ? p.items.length : 0}`, panes: p ? { POPUP: p } : {}, controls: { closePopup: true }, room: null, popup };
      }
      const room = getRoom();
      const controls = room && room.querySelector(SELECTORS.controls);
      if (!controls) {
        const menu = getMainMenu();
        if (menu) {
          const groups = [];
          for (const form of menu.querySelectorAll(SELECTORS.mainMenuBattleForm)) {
            const g = form.closest(SELECTORS.menuGroup) || form;
            if (!groups.includes(g)) groups.push(g);
          }
          if (!groups.length) {
            const g = menu.querySelector(SELECTORS.menuGroup);
            if (g) groups.push(g);
          }
          const els = groups.flatMap((g) => Array.from(g.querySelectorAll("button, .roomlist a.blocklink")));
          const p = pane("MENU", els);
          if (p) {
            p.wrap = true;
            return { key: `menu|${p.items.length}`, panes: { MENU: p }, controls: {}, room: null, menu };
          }
        }
        return { key: null, panes: {}, controls: {}, room: null };
      }
      const panes = {};
      const q = (sel) => Array.from(controls.querySelectorAll(sel));
      if (q(SELECTORS.targetButtons).length) {
        const menus = q(SELECTORS.switchMenuAny).filter((m) => m.querySelector(SELECTORS.targetButtons) || m.querySelector("button[disabled]"));
        const els = menus.flatMap((m) => Array.from(m.querySelectorAll("button")));
        panes.TARGET = pane("TARGET", els);
      } else if (q(SELECTORS.switchTargetButtons).length) {
        const menu = q(SELECTORS.switchTargetButtons)[0].closest(SELECTORS.switchMenuAny) || controls;
        panes.SWITCH_TARGET = pane("SWITCH_TARGET", Array.from(menu.querySelectorAll("button")));
      } else if (q(SELECTORS.teamPreviewButtons).length) {
        const menu = q(SELECTORS.teamPreviewButtons)[0].closest(SELECTORS.switchMenuAny) || controls;
        panes.TEAM = pane("TEAM", Array.from(menu.querySelectorAll("button")));
      } else {
        const moves = q(SELECTORS.moveButtons);
        if (moves.length) panes.MOVE = pane("MOVE", moves);
        const switchMenu = q(SELECTORS.switchMenu)[0];
        if (switchMenu) panes.SWITCH = pane("SWITCH", Array.from(switchMenu.querySelectorAll("button")));
      }
      const playback = q(SELECTORS.playback);
      if (playback.length) panes.PLAYBACK = pane("PLAYBACK", playback);
      for (const k of Object.keys(panes)) if (!panes[k]) delete panes[k];
      const has = (sel) => q(sel).some(isVisible);
      const ctl = {
        back: has(SELECTORS.back),
        cancel: has(SELECTORS.cancel),
        gimmick: has(SELECTORS.gimmick),
        selectSwitch: !!q(SELECTORS.selectSwitch).length,
        selectMove: !!q(SELECTORS.selectMove).length,
        // Playback controls exist only while the battle display lags the log.
        skipTurn: q(SELECTORS.skipTurn).some((el) => isVisible(el) && !el.disabled),
        goToEnd: q(SELECTORS.goToEnd).some((el) => isVisible(el) && !el.disabled)
      };
      const whatdo = controls.querySelector(SELECTORS.whatdo);
      let prompt = "";
      if (whatdo) {
        const clone = whatdo.cloneNode(true);
        clone.querySelectorAll(SELECTORS.timer).forEach((n) => n.remove());
        prompt = (clone.textContent || "").replace(/\s+/g, " ").trim();
      }
      let turn = "";
      try {
        const app = win.app;
        const r = app && app.rooms && app.rooms[room.id.replace(/^room-/, "")];
        if (r && r.battle) turn = String(r.battle.turn);
      } catch (_) {
      }
      const key = `${room.id}|${turn}|${Object.keys(panes).sort().join(",")}|${prompt}`;
      return { key, panes, controls: ctl, room };
    }
    function isTyping() {
      const el = doc.activeElement;
      if (!el) return false;
      const tag = (el.tagName || "").toUpperCase();
      if (tag === "TEXTAREA" || tag === "INPUT" && !/^(checkbox|radio|button|submit|range)$/i.test(el.type || "")) {
        return (el.value || "").length > 0;
      }
      if (el.isContentEditable === true) return (el.textContent || "").trim().length > 0;
      return false;
    }
    function clickEl(el) {
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }
    function activate(paneName, index, id) {
      if (isTyping()) return false;
      const screen = readScreen();
      const p = screen.panes[paneName];
      const item = p && p.items[index];
      if (!item || item.disabled || item.skip || !item.el) return false;
      if (id != null && item.id !== id) return false;
      return clickEl(item.el);
    }
    function clickControl(sel) {
      if (isTyping()) return false;
      const controls = getControls();
      if (!controls) return false;
      const el = Array.from(controls.querySelectorAll(sel)).find(isVisible);
      return clickEl(el);
    }
    const back = () => clickControl(SELECTORS.back);
    const cancel = () => clickControl(SELECTORS.cancel);
    const selectSwitch = () => clickControl(SELECTORS.selectSwitch);
    const selectMove = () => clickControl(SELECTORS.selectMove);
    const skipTurn = () => clickControl(SELECTORS.skipTurn);
    function closeTab() {
      if (isTyping()) return false;
      const app = win.app;
      const cur = app && app.curRoom;
      if (!cur || !cur.id) return false;
      if (typeof app.leaveRoom === "function") {
        app.leaveRoom(cur.id);
        return true;
      }
      const btn = Array.from(doc.querySelectorAll(SELECTORS.roomTabClose)).find((b) => b.value === cur.id);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }
    function switchTab(dir) {
      if (isTyping()) return false;
      const app = win.app;
      if (!app || typeof app.focusRoom !== "function") return false;
      const root = app.root || "/";
      const ids = [];
      for (const a of doc.querySelectorAll(SELECTORS.roomTabs)) {
        const href = a.getAttribute("href") || "";
        const id = href.startsWith(root) ? href.slice(root.length) : href.replace(/^\//, "");
        if (id === "rooms" || ids.includes(id)) continue;
        ids.push(id);
      }
      if (ids.length < 2) return false;
      const curId = app.curRoom ? app.curRoom.id : "";
      let idx = ids.indexOf(curId);
      if (idx < 0) idx = 0;
      const next = ids[((idx + dir) % ids.length + ids.length) % ids.length];
      app.focusRoom(next);
      return true;
    }
    function closePopup() {
      if (isTyping()) return false;
      const popup = getPopup();
      if (!popup) return false;
      const btn = Array.from(popup.querySelectorAll(SELECTORS.popupClose)).find(isVisible);
      if (btn) {
        btn.click();
        return true;
      }
      const app = win.app;
      if (app && typeof app.dismissPopups === "function") {
        app.dismissPopups();
        return true;
      }
      return false;
    }
    const goToEnd = () => clickControl(SELECTORS.goToEnd);
    function battleEnded() {
      const room = getRoom();
      if (!room) return true;
      const app = win.app;
      const r = app && app.rooms && app.rooms[room.id.replace(/^room-/, "")];
      if (r && (r.battleEnded || r.battle && r.battle.ended)) return true;
      return !!room.querySelector('button[name="closeAndMainMenu"], button[name="closeAndRematch"]');
    }
    function forfeit() {
      if (isTyping()) return false;
      const room = getRoom();
      if (!room) return false;
      const roomId = room.id.replace(/^room-/, "");
      const app = win.app;
      const r = app && app.rooms && app.rooms[roomId];
      if (r && typeof r.send === "function") {
        r.send("/forfeit");
        return true;
      }
      if (app && typeof app.send === "function") {
        app.send("/forfeit", roomId);
        return true;
      }
      return false;
    }
    function gimmick() {
      if (isTyping()) return false;
      const controls = getControls();
      if (!controls) return false;
      const input = Array.from(controls.querySelectorAll(SELECTORS.gimmick)).find((el) => isVisible(el) || isVisible(el.parentElement));
      if (!input) return false;
      input.click();
      return true;
    }
    function ensureStyle() {
      if (doc.getElementById(STYLE_ID)) return;
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CURSOR_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    function setStatus(state, text) {
      ensureStyle();
      let el = doc.getElementById(BADGE_ID);
      if (!el) {
        el = doc.createElement("div");
        el.id = BADGE_ID;
        (doc.body || doc.documentElement).appendChild(el);
      }
      el.dataset.state = state;
      el.textContent = text;
    }
    function clearCursor() {
      doc.querySelectorAll("." + CURSOR_CLASS).forEach((el) => el.classList.remove(CURSOR_CLASS));
      doc.querySelectorAll("." + DISABLED_CLASS).forEach((el) => el.classList.remove(DISABLED_CLASS));
      doc.querySelectorAll("." + HEADING_CLASS).forEach((el) => el.classList.remove(HEADING_CLASS));
      doc.querySelectorAll("." + PANE_CLASS).forEach((el) => el.remove());
    }
    function setCursor(paneName, index) {
      ensureStyle();
      clearCursor();
      const screen = readScreen();
      const p = screen.panes[paneName];
      const item = p && p.items[index];
      if (!item || !item.el) return false;
      item.el.classList.add(CURSOR_CLASS);
      for (const pn of Object.values(screen.panes)) {
        for (const it of pn.items) if (it.disabled && !it.skip && it.el) it.el.classList.add(DISABLED_CLASS);
      }
      const controlsEl = item.el.closest(SELECTORS.controls);
      const hsel = SELECTORS.headings[paneName];
      if (controlsEl && hsel) {
        const h = controlsEl.querySelector(hsel);
        if (h) h.classList.add(HEADING_CLASS);
      }
      const controls = item.el.closest(SELECTORS.controls);
      if (controls) {
        const rects = p.items.filter((it) => it.el && (!it.skip || it.el.style.visibility === "hidden")).map((it) => rectOf(it.el)).filter((r) => r && r.width > 0);
        if (rects.length) {
          const cr = rectOf(controls);
          const pad = 4;
          const left = Math.min(...rects.map((r) => r.left)) - cr.left - pad;
          const top = Math.min(...rects.map((r) => r.top)) - cr.top - pad;
          const right = Math.max(...rects.map((r) => r.left + r.width)) - cr.left + pad;
          const bottom = Math.max(...rects.map((r) => r.top + r.height)) - cr.top + pad;
          const box = doc.createElement("div");
          box.className = PANE_CLASS;
          box.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;`;
          controls.appendChild(box);
        }
      }
      return true;
    }
    function paintHints(labels) {
      ensureStyle();
      const controls = getControls();
      if (!controls) return;
      const targets = [];
      const gim = Array.from(controls.querySelectorAll(SELECTORS.gimmick)).find((el) => isVisible(el) || isVisible(el.parentElement));
      if (gim && labels.gimmick) targets.push([gim.closest("label") || gim.parentElement, labels.gimmick]);
      for (const [key, sel] of [["skipTurn", SELECTORS.skipTurn], ["goToEnd", SELECTORS.goToEnd]]) {
        if (!labels[key]) continue;
        controls.querySelectorAll(sel).forEach((el) => {
          if (isVisible(el) && !el.disabled) targets.push([el, labels[key]]);
        });
      }
      let forfeitHost = null;
      if (labels.forfeit && !battleEnded()) {
        const room = getRoom();
        const qol = room && Array.from(room.querySelectorAll(SELECTORS.qolForfeit)).find(isVisible);
        forfeitHost = qol || controls;
        targets.push([forfeitHost, labels.forfeit, forfeitHost === controls ? "sgp-hint-forfeit" : ""]);
      }
      const wanted = /* @__PURE__ */ new Set();
      for (const [host, label, extraClass = "", suffix = ""] of targets) {
        const cls = HINT_CLASS + (extraClass ? " " + extraClass : "");
        let hint = Array.from(host.children).find((c) => c.classList && c.classList.contains(HINT_CLASS) && (extraClass ? c.classList.contains(extraClass) : !c.classList.contains("sgp-hint-forfeit")));
        if (!hint) {
          hint = doc.createElement("span");
          hint.className = cls;
          host.appendChild(hint);
        }
        const text = `(${label})${suffix ? " " + suffix : ""}`;
        if (hint.textContent !== text) hint.textContent = text;
        wanted.add(hint);
      }
      const scope = forfeitHost && forfeitHost !== controls ? getRoom() : controls;
      (scope || controls).querySelectorAll("." + HINT_CLASS).forEach((h) => {
        if (!wanted.has(h)) h.remove();
      });
    }
    function clearHints() {
      doc.querySelectorAll("." + HINT_CLASS).forEach((h) => h.remove());
    }
    function onControlsChanged(cb) {
      let scheduled = false;
      const raf = win.requestAnimationFrame ? (f) => win.requestAnimationFrame(f) : (f) => setTimeout(f, 16);
      const fire = () => {
        if (scheduled) return;
        scheduled = true;
        raf(() => {
          scheduled = false;
          cb();
        });
      };
      const OURS = /* @__PURE__ */ new Set([CURSOR_CLASS, PANE_CLASS, DISABLED_CLASS, HEADING_CLASS]);
      const strip = (s) => (s || "").split(/\s+/).filter((c) => c && !OURS.has(c)).sort().join(" ");
      const isHint = (n) => n && n.nodeType === 1 && (n.classList.contains(HINT_CLASS) || n.classList.contains(PANE_CLASS));
      const observer = new win.MutationObserver((records) => {
        for (const rec of records) {
          const t = rec.target;
          if (!t || !t.closest) {
            fire();
            return;
          }
          if (rec.type === "attributes" && rec.attributeName === "class" && strip(rec.oldValue) === strip(t.className)) continue;
          if (rec.type === "childList" && [...rec.addedNodes, ...rec.removedNodes].every(isHint)) continue;
          if (rec.type === "characterData" && isHint(t.parentNode)) continue;
          if (t.closest(SELECTORS.controls)) {
            fire();
            return;
          }
          if (rec.type === "attributes" && t.matches && t.matches(".ps-room")) {
            fire();
            return;
          }
          if (rec.type === "childList" && (t === doc.body || t.matches?.(".ps-room, .battle-controls"))) {
            fire();
            return;
          }
          if (t.closest(SELECTORS.popup) || t.closest(SELECTORS.mainMenu)) {
            fire();
            return;
          }
        }
      });
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["style", "class", "disabled"]
      });
      return () => observer.disconnect();
    }
    return {
      readScreen,
      activate,
      back,
      cancel,
      gimmick,
      selectSwitch,
      selectMove,
      skipTurn,
      goToEnd,
      forfeit,
      closePopup,
      battleEnded,
      closeTab,
      switchTab,
      setCursor,
      clearCursor,
      paintHints,
      clearHints,
      setStatus,
      onControlsChanged,
      isTyping,
      getRoom,
      getControls
    };
  }

  // src/settings.js
  var STORAGE_KEY = "showdown-gamepad.bindings.v1";
  var PANEL_ID = "sgp-settings";
  function intentToButton(bindings) {
    const out = {};
    for (const [btn, intent] of Object.entries(bindings)) out[intent] = Number(btn);
    return out;
  }
  function loadBindings(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_BINDINGS };
      const parsed = JSON.parse(raw);
      const known = new Set(INTENTS.map((i) => i.id));
      const out = {};
      for (const [btn, intent] of Object.entries(parsed)) {
        if (Number.isInteger(Number(btn)) && known.has(intent)) out[Number(btn)] = intent;
      }
      return Object.keys(out).length ? out : { ...DEFAULT_BINDINGS };
    } catch (_) {
      return { ...DEFAULT_BINDINGS };
    }
  }
  function saveBindings(storage, bindings) {
    try {
      storage && storage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch (_) {
    }
  }
  function rebind(bindings, intent, button) {
    const out = {};
    for (const [b, i] of Object.entries(bindings)) {
      if (i === intent) continue;
      if (Number(b) === button) continue;
      out[Number(b)] = i;
    }
    out[button] = intent;
    return out;
  }
  var PANEL_CSS = `
#${PANEL_ID} {
  position: fixed; right: 8px; bottom: 34px; z-index: 10000; width: 300px;
  font: 12px/1.4 Verdana, sans-serif; color: #eee; background: #222; border: 1px solid #555;
  border-radius: 8px; padding: 10px 12px; box-shadow: 0 4px 16px rgba(0,0,0,.5);
}
#${PANEL_ID} h3 { margin: 0 0 8px; font-size: 13px; color: #fff; }
#${PANEL_ID} table { width: 100%; border-collapse: collapse; }
#${PANEL_ID} td { padding: 3px 2px; vertical-align: middle; }
#${PANEL_ID} td.k { width: 46px; text-align: center; font-weight: bold; color: #ff8c00; }
#${PANEL_ID} button { font: 11px Verdana, sans-serif; padding: 2px 8px; border-radius: 4px; border: 1px solid #777; background: #333; color: #eee; cursor: pointer; }
#${PANEL_ID} button:hover { background: #444; }
#${PANEL_ID} tr.listening td.k { color: #fff; background: #b35a00; border-radius: 4px; }
#${PANEL_ID} .foot { margin-top: 8px; display: flex; gap: 6px; justify-content: space-between; }
#${PANEL_ID} .note { color: #aaa; font-size: 11px; margin-top: 6px; }
`;
  function createSettings({ doc = document, storage = typeof localStorage !== "undefined" ? localStorage : null, onChange = () => {
  } } = {}) {
    let bindings = loadBindings(storage);
    let panel = null;
    let listeningFor = null;
    const labelFor = (intent) => {
      const b = intentToButton(bindings)[intent];
      return b === void 0 ? "\u2014" : buttonLabel(b);
    };
    function ensureStyle() {
      if (doc.getElementById(PANEL_ID + "-style")) return;
      const st = doc.createElement("style");
      st.id = PANEL_ID + "-style";
      st.textContent = PANEL_CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }
    function render() {
      if (!panel) return;
      const rows = INTENTS.map(({ id, label }) => `
      <tr data-intent="${id}" class="${listeningFor === id ? "listening" : ""}">
        <td>${label}</td>
        <td class="k">${listeningFor === id ? "press\u2026" : labelFor(id)}</td>
        <td style="text-align:right"><button type="button" data-rebind="${id}">${listeningFor === id ? "Cancel" : "Rebind"}</button></td>
      </tr>`).join("");
      panel.innerHTML = `
      <h3>\u{1F3AE} Gamepad bindings</h3>
      <table>${rows}</table>
      <div class="foot">
        <button type="button" data-reset>Reset defaults</button>
        <button type="button" data-close>Close</button>
      </div>
      <div class="note">Click Rebind, then press a controller button. Bindings are saved in this browser. Buttons: ${BUTTON_LABELS.join(" ")}.</div>`;
    }
    function open() {
      ensureStyle();
      if (!panel) {
        panel = doc.createElement("div");
        panel.id = PANEL_ID;
        panel.addEventListener("click", (e) => {
          const t = e.target.closest("button");
          if (!t) return;
          if (t.dataset.rebind) {
            listeningFor = listeningFor === t.dataset.rebind ? null : t.dataset.rebind;
            render();
          } else if (t.hasAttribute("data-reset")) {
            bindings = { ...DEFAULT_BINDINGS };
            saveBindings(storage, bindings);
            listeningFor = null;
            render();
            onChange(bindings);
          } else if (t.hasAttribute("data-close")) {
            close();
          }
        });
        (doc.body || doc.documentElement).appendChild(panel);
      }
      render();
    }
    function close() {
      listeningFor = null;
      if (panel) {
        panel.remove();
        panel = null;
      }
    }
    return {
      get bindings() {
        return bindings;
      },
      labelFor,
      open,
      close,
      toggle() {
        panel ? close() : open();
      },
      isOpen: () => !!panel,
      isCapturing: () => !!listeningFor,
      onRawButton(index) {
        if (!listeningFor) return false;
        bindings = rebind(bindings, listeningFor, index);
        saveBindings(storage, bindings);
        listeningFor = null;
        render();
        onChange(bindings);
        return true;
      }
    };
  }

  // src/main.js
  var CONFIG = {
    debug: false,
    enabledByDefault: true,
    toggleKey: { key: "G", ctrlKey: true, shiftKey: true },
    // Ctrl+Shift+G — free in the classic client
    // Button bindings live in src/gamepad.js (DEFAULT_BINDINGS) and can be
    // remapped in-page: click the 🎮 status pill → Rebind. Stored in localStorage.
    deadzone: DEFAULTS.deadzone,
    repeatDelay: DEFAULTS.repeatDelay,
    repeatInterval: DEFAULTS.repeatInterval,
    forfeitConfirmMs: 4e3
    // Start once arms, Start again within this window forfeits
  };
  var TAG = "[showdown-gamepad]";
  var log = (...a) => console.log(TAG, ...a);
  var dbg = (...a) => {
    if (CONFIG.debug) console.log(TAG, ...a);
  };
  function start(win = window) {
    const doc = win.document;
    const adapter = createAdapter({ doc, win });
    const settings = createSettings({ doc, storage: safeStorage(win), onChange: () => {
      log("bindings updated");
      paint();
    } });
    let state = initialState();
    let enabled2 = CONFIG.enabledByDefault;
    let padSeen = false;
    let forfeitArmedAt = 0;
    let forfeitTimer = null;
    const L = (intent) => settings.labelFor(intent);
    const forfeitHint = () => adapter.battleEnded() ? "battle over" : `(${L("FORFEIT")}) forfeit`;
    function status() {
      if (forfeitArmedAt) {
        adapter.setStatus("off", `\u{1F3AE} FORFEIT armed \u2014 press ${L("FORFEIT")} again to concede, anything else to cancel`);
        return;
      }
      if (!padSeen) adapter.setStatus("waiting", "\u{1F3AE} Gamepad: press any button on the controller \xB7 click here for bindings");
      else if (!enabled2) adapter.setStatus("off", `\u{1F3AE} Gamepad OFF \u2014 ${L("TOGGLE_LAYER")} or Ctrl+Shift+G to enable`);
      else if (state.pane === "WAIT") adapter.setStatus("on", `\u{1F3AE} Gamepad ON \u2014 waiting for opponent (${L("BACK")} = cancel) \xB7 ${forfeitHint()}`);
      else if (state.pane === "INACTIVE") adapter.setStatus("on", `\u{1F3AE} Gamepad ON \u2014 nothing selectable on screen \xB7 ${forfeitHint()}`);
      else if (state.pane === "POPUP") adapter.setStatus("on", `\u{1F3AE} Gamepad ON \u2014 popup (${L("BACK")} = close)`);
      else if (state.pane === "MENU") adapter.setStatus("on", `\u{1F3AE} Gamepad ON \u2014 main menu \xB7 (${L("CLOSE_TAB")}) close tab`);
      else adapter.setStatus("on", `\u{1F3AE} Gamepad ON \u2014 ${state.pane.toLowerCase().replace("_", " ")} \xB7 ${forfeitHint()}`);
    }
    function hints() {
      if (!enabled2 || !padSeen) {
        adapter.clearHints();
        return;
      }
      adapter.paintHints({ gimmick: L("GIMMICK"), skipTurn: L("SKIP_TURN"), goToEnd: L("SKIP_TO_END"), forfeit: L("FORFEIT") });
    }
    function paint() {
      status();
      hints();
      if (!enabled2 || !padSeen) {
        adapter.clearCursor();
        return;
      }
      if (state.pane === "WAIT" || state.pane === "INACTIVE") {
        adapter.clearCursor();
        return;
      }
      adapter.setCursor(state.pane, state.index);
    }
    function resync() {
      const screen = adapter.readScreen();
      const next = sync(state, screen);
      if (next.pane !== state.pane || next.index !== state.index || next.focusId !== state.focusId) {
        dbg("sync \u2192", next.pane, next.index, next.focusId);
      }
      state = next;
      paint();
    }
    function setEnabled(on) {
      enabled2 = !!on;
      log(enabled2 ? "controller layer ON" : "controller layer OFF (mouse/keyboard unaffected)");
      paint();
    }
    function perform(action) {
      if (!action) return;
      dbg("action", action);
      switch (action.type) {
        case "activate":
          adapter.activate(action.pane, action.index, action.id);
          break;
        case "back":
          adapter.back();
          break;
        case "cancel":
          adapter.cancel();
          break;
        case "gimmick":
          adapter.gimmick();
          break;
        case "selectSwitch":
          adapter.selectSwitch();
          break;
        case "selectMove":
          adapter.selectMove();
          break;
        case "skipTurn":
          adapter.skipTurn();
          break;
        case "goToEnd":
          adapter.goToEnd();
          break;
        case "closePopup":
          adapter.closePopup();
          break;
        case "closeTab":
          adapter.closeTab();
          break;
        case "prevTab":
          adapter.switchTab(-1);
          break;
        case "nextTab":
          adapter.switchTab(1);
          break;
        default:
          break;
      }
    }
    function disarmForfeit() {
      forfeitArmedAt = 0;
      if (forfeitTimer) {
        win.clearTimeout(forfeitTimer);
        forfeitTimer = null;
      }
    }
    function handleForfeit() {
      if (!adapter.getRoom() || adapter.battleEnded()) {
        dbg("forfeit: no live battle");
        return;
      }
      const now = win.performance.now();
      if (forfeitArmedAt && now - forfeitArmedAt <= CONFIG.forfeitConfirmMs) {
        disarmForfeit();
        const ok = adapter.forfeit();
        log(ok ? "forfeit sent" : "forfeit: client API unavailable");
        paint();
        return;
      }
      forfeitArmedAt = now;
      forfeitTimer = win.setTimeout(() => {
        disarmForfeit();
        paint();
      }, CONFIG.forfeitConfirmMs);
      log(`forfeit armed \u2014 press ${L("FORFEIT")} again within ${CONFIG.forfeitConfirmMs / 1e3}s to concede`);
      paint();
    }
    function handleIntent(type) {
      if (settings.isCapturing()) return;
      if (type === "TOGGLE_LAYER") {
        disarmForfeit();
        setEnabled(!enabled2);
        return;
      }
      if (!enabled2) return;
      if (adapter.isTyping()) {
        dbg("ignored (typing):", type);
        return;
      }
      if (type === "FORFEIT") {
        handleForfeit();
        return;
      }
      if (forfeitArmedAt) {
        disarmForfeit();
        paint();
      }
      const screen = adapter.readScreen();
      const { state: next, action } = reduce(state, type, screen);
      state = next;
      paint();
      perform(action);
    }
    const input = createGamepadInput({
      bindings: () => settings.bindings,
      onRawButton: (idx) => {
        if (settings.onRawButton(idx)) dbg("rebound via raw button", idx);
      },
      deadzone: CONFIG.deadzone,
      repeatDelay: CONFIG.repeatDelay,
      repeatInterval: CONFIG.repeatInterval,
      getGamepads: () => win.navigator.getGamepads(),
      requestFrame: (cb) => win.requestAnimationFrame(cb),
      cancelFrame: (id) => win.cancelAnimationFrame(id),
      now: () => win.performance.now(),
      onEvent: (ev) => {
        dbg("intent", ev.type, ev.repeat ? "(repeat)" : "");
        handleIntent(ev.type);
      },
      onStatus: (st) => {
        if (st.type === "connected") {
          padSeen = true;
          log(`controller connected: ${st.id} (index ${st.padIndex})`);
          resync();
        } else if (st.type === "disconnected") {
          log("controller disconnected \u2014 mouse control only");
          padSeen = false;
          adapter.clearCursor();
          adapter.setStatus("waiting", "\u{1F3AE} Gamepad: controller disconnected");
        } else if (st.type === "nonstandard") {
          log(`ignoring pad with mapping "${st.pad.mapping}" (need "standard"): ${st.pad.id}`);
          adapter.setStatus("off", `\u{1F3AE} Gamepad: pad not in "standard" mapping (${st.pad.id.slice(0, 40)}) \u2014 see console`);
        }
      }
    });
    win.addEventListener("gamepadconnected", () => {
      input.start();
    });
    win.addEventListener("gamepaddisconnected", () => {
      const any = Array.from(win.navigator.getGamepads() || []).some(Boolean);
      if (!any) input.stop();
    });
    if (Array.from(win.navigator.getGamepads?.() || []).some(Boolean)) input.start();
    adapter.onControlsChanged(resync);
    win.addEventListener("keydown", (e) => {
      const k = CONFIG.toggleKey;
      if (e.key.toUpperCase() === k.key && !!e.ctrlKey === !!k.ctrlKey && !!e.shiftKey === !!k.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setEnabled(!enabled2);
      }
    }, true);
    doc.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("#" + BADGE_ID)) settings.toggle();
    }, true);
    log(`loaded \u2014 press any controller button to activate. ${L("TOGGLE_LAYER")} or Ctrl+Shift+G toggles the layer; click the \u{1F3AE} pill to remap buttons.`);
    status();
    win.__showdownGamepad = {
      inject(intent) {
        padSeen = true;
        handleIntent(intent);
        return this.debug();
      },
      enable(on) {
        padSeen = true;
        setEnabled(on);
        resync();
      },
      debug() {
        resync();
        const screen = adapter.readScreen();
        const p = screen.panes[state.pane];
        return {
          enabled: enabled2,
          pane: state.pane,
          index: state.index,
          focusId: state.focusId,
          panes: Object.fromEntries(Object.entries(screen.panes).map(([k, v]) => [k, { n: v.items.length, columns: v.columns }])),
          controls: screen.controls,
          item: p && p.items[state.index] ? { id: p.items[state.index].id, disabled: p.items[state.index].disabled } : null,
          ids: p ? p.items.map((i) => i.id + (i.disabled ? "!" : "") + (i.skip ? "*" : "")) : []
        };
      },
      resync,
      settings,
      get state() {
        return state;
      },
      input
    };
  }
  function safeStorage(win) {
    try {
      return win.localStorage;
    } catch (_) {
      return null;
    }
  }
  if (typeof window !== "undefined" && !window.__showdownGamepadNoAutostart) {
    const boot = () => {
      try {
        start(window);
      } catch (e) {
        console.error(TAG, "failed to start", e);
      }
    };
    if (document.body) boot();
    else document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();
