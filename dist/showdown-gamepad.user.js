// ==UserScript==
// @name         Showdown Gamepad
// @namespace    https://github.com/pizzacatz/showdown-controller
// @version      0.1.0
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
  var BINDINGS = {
    [BUTTON.A]: "CONFIRM",
    [BUTTON.B]: "BACK",
    [BUTTON.X]: "SWITCH_MENU",
    [BUTTON.Y]: "GIMMICK",
    [BUTTON.BACK]: "TOGGLE_LAYER",
    [BUTTON.UP]: "UP",
    [BUTTON.DOWN]: "DOWN",
    [BUTTON.LEFT]: "LEFT",
    [BUTTON.RIGHT]: "RIGHT"
  };
  var DIRECTIONS = /* @__PURE__ */ new Set(["UP", "DOWN", "LEFT", "RIGHT"]);
  var DEFAULTS = {
    deadzone: 0.5,
    // analog stick threshold on axes 0/1
    repeatDelay: 400,
    // ms held before the first repeat of a direction
    repeatInterval: 120
    // ms between subsequent repeats
  };
  function readIntents(pad, deadzone = DEFAULTS.deadzone) {
    const active = /* @__PURE__ */ new Set();
    if (!pad) return active;
    const buttons = pad.buttons || [];
    for (const [index, intent] of Object.entries(BINDINGS)) {
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
      onStatus = () => {
      },
      deadzone = DEFAULTS.deadzone,
      repeatDelay = DEFAULTS.repeatDelay,
      repeatInterval = DEFAULTS.repeatInterval
    } = options;
    let running = false;
    let frameId = null;
    let prev = /* @__PURE__ */ new Set();
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
      const active = readIntents(pad, deadzone);
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
  var PANE_PRIORITY = ["TARGET", "SWITCH_TARGET", "TEAM", "MOVE", "SWITCH"];
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
  function move(items, columns, index, dir) {
    const n = items.length;
    if (!n) return index;
    const c = Math.max(1, Math.min(columns | 0 || n, n));
    const row = (i) => Math.floor(i / c);
    const lastRow = row(n - 1);
    const rowStart = (r) => r * c;
    const rowEnd = (r) => Math.min(n - 1, r * c + c - 1);
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
        const index = move(items, columnsOf(paneData), state.index, type);
        if (index === state.index) return none;
        const focusId = items[index].id;
        return { state: { ...state, index, focusId, memory: { ...state.memory, [pane]: focusId } }, action: null };
      }
      case "CONFIRM": {
        const item = items[state.index];
        if (!item || item.disabled || item.skip) return none;
        return { state, action: { type: "activate", pane, index: state.index, id: item.id } };
      }
      case "BACK": {
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
    timer: ".timerbutton, .timer"
  };
  var CURSOR_CLASS = "sgp-cursor";
  var STYLE_ID = "sgp-cursor-style";
  var CURSOR_CSS = `
.${CURSOR_CLASS} {
  outline: 3px solid #f5a623 !important;
  outline-offset: -2px !important;
  box-shadow: 0 0 0 3px rgba(245, 166, 35, 0.45), 0 0 12px rgba(245, 166, 35, 0.8) !important;
  position: relative;
  z-index: 2;
}
.${CURSOR_CLASS}:disabled, .${CURSOR_CLASS}.disabled {
  outline-color: #b0b0b0 !important;
  box-shadow: 0 0 0 3px rgba(160, 160, 160, 0.4) !important;
}
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
      else if (kind === "TARGET" || kind === "SWITCH_TARGET") id = `${kind}:${name || "x"}:${value ?? i}`;
      else id = `${kind}:${text || name + ":" + value || i}`;
      return { id, el, disabled: disabledAttr || disabledClass, skip };
    }
    function columnsFor(els) {
      if (!els.length) return 0;
      const tops = els.map((el) => {
        const r = rectOf(el);
        return r ? Math.round(r.top) : 0;
      });
      if (tops.every((t) => t === 0)) return els.length;
      const rows = [];
      for (const t of tops) {
        const row = rows.find((r) => Math.abs(r - t) <= 4);
        if (row === void 0) rows.push(t);
      }
      rows.sort((a, b) => a - b);
      let best = 0;
      for (const r of rows) best = Math.max(best, tops.filter((t) => Math.abs(t - r) <= 4).length);
      return best;
    }
    function pane(kind, els) {
      const visible = els.filter(isVisible);
      if (!visible.length) return null;
      return { items: visible.map((el, i) => itemOf(el, i, kind)), columns: columnsFor(visible) };
    }
    function readScreen() {
      const room = getRoom();
      const controls = room && room.querySelector(SELECTORS.controls);
      const empty = { key: null, panes: {}, controls: {}, room: null };
      if (!controls) return empty;
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
      for (const k of Object.keys(panes)) if (!panes[k]) delete panes[k];
      const has = (sel) => q(sel).some(isVisible);
      const ctl = {
        back: has(SELECTORS.back),
        cancel: has(SELECTORS.cancel),
        gimmick: has(SELECTORS.gimmick),
        selectSwitch: !!q(SELECTORS.selectSwitch).length,
        selectMove: !!q(SELECTORS.selectMove).length
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
      if (!item || item.disabled || item.skip) return false;
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
    function clearCursor() {
      doc.querySelectorAll("." + CURSOR_CLASS).forEach((el) => el.classList.remove(CURSOR_CLASS));
    }
    function setCursor(paneName, index) {
      ensureStyle();
      clearCursor();
      const screen = readScreen();
      const p = screen.panes[paneName];
      const item = p && p.items[index];
      if (!item) return false;
      item.el.classList.add(CURSOR_CLASS);
      return true;
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
      const strip = (s) => (s || "").split(/\s+/).filter((c) => c && c !== CURSOR_CLASS).sort().join(" ");
      const observer = new win.MutationObserver((records) => {
        for (const rec of records) {
          const t = rec.target;
          if (!t || !t.closest) {
            fire();
            return;
          }
          if (rec.type === "attributes" && rec.attributeName === "class" && strip(rec.oldValue) === strip(t.className)) continue;
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
      setCursor,
      clearCursor,
      onControlsChanged,
      isTyping,
      getRoom,
      getControls
    };
  }

  // src/main.js
  var CONFIG = {
    debug: false,
    enabledByDefault: true,
    toggleKey: { key: "G", ctrlKey: true, shiftKey: true },
    // Ctrl+Shift+G — free in the classic client
    deadzone: DEFAULTS.deadzone,
    repeatDelay: DEFAULTS.repeatDelay,
    repeatInterval: DEFAULTS.repeatInterval
  };
  var TAG = "[showdown-gamepad]";
  var log = (...a) => console.log(TAG, ...a);
  var dbg = (...a) => {
    if (CONFIG.debug) console.log(TAG, ...a);
  };
  function start(win = window) {
    const doc = win.document;
    const adapter = createAdapter({ doc, win });
    let state = initialState();
    let enabled2 = CONFIG.enabledByDefault;
    let padSeen = false;
    function paint() {
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
        default:
          break;
      }
    }
    function handleIntent(type) {
      if (type === "TOGGLE_LAYER") {
        setEnabled(!enabled2);
        return;
      }
      if (!enabled2) return;
      if (adapter.isTyping()) {
        dbg("ignored (typing):", type);
        return;
      }
      const screen = adapter.readScreen();
      const { state: next, action } = reduce(state, type, screen);
      state = next;
      paint();
      perform(action);
    }
    const input = createGamepadInput({
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
          adapter.clearCursor();
        } else if (st.type === "nonstandard") {
          log(`ignoring pad with mapping "${st.pad.mapping}" (need "standard"): ${st.pad.id}`);
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
    log("loaded \u2014 press any controller button to activate. Ctrl+Shift+G or Back/Select toggles the layer.");
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
          item: p && p.items[state.index] ? { id: p.items[state.index].id, disabled: p.items[state.index].disabled } : null
        };
      },
      resync,
      get state() {
        return state;
      },
      input
    };
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
