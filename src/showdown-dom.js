// ADAPTER LAYER — the ONLY file that knows Showdown's markup.
//
// Targets the classic (Backbone/jQuery) client at play.pokemonshowdown.com.
// Selectors verified against oldclient/client-battle.js and a live local
// server render (see docs/dom-recon.md). The client re-renders the whole
// contents of `.battle-controls` on every request update; the container
// itself persists, and every button carries a `name` attribute that the
// room view dispatches on (`this[target.name](target.value, target)`), so a
// synthetic `.click()` on the button is exactly what a mouse click does.

export const SELECTORS = {
  room: '.ps-room[id^="room-battle-"], .ps-room[id^="room-game-"]',
  controls: '.battle-controls',
  whatdo: '.whatdo',
  moveButtons: '.movecontrols .movemenu button.movebutton',
  targetButtons: 'button[name="chooseMoveTarget"]',
  switchTargetButtons: 'button[name="chooseSwitchTarget"]',
  teamPreviewButtons: 'button[name="chooseTeamPreview"]',
  switchMenu: '.switchcontrols .switchmenu',
  switchMenuAny: '.switchmenu',
  back: 'button[name="clearChoice"]',
  cancel: 'button[name="undoChoice"]',
  gimmick: '.megaevo-box input[type="checkbox"], label.megaevo input[type="checkbox"]',
  selectSwitch: 'button[name="selectSwitch"]',
  selectMove: 'button[name="selectMove"]',
  skipTurn: 'button[name="skipTurn"]',
  goToEnd: 'button[name="goToEnd"]',
  timer: '.timerbutton, .timer',
};

export const CURSOR_CLASS = 'sgp-cursor';
export const BADGE_ID = 'sgp-status';
export const STYLE_ID = 'sgp-cursor-style';
export const CURSOR_CSS = `
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
#${BADGE_ID} {
  position: fixed; right: 8px; bottom: 8px; z-index: 9999;
  font: 11px/1.4 Verdana, sans-serif; color: #fff;
  background: rgba(40, 40, 40, 0.85); border-radius: 12px; padding: 3px 10px;
  pointer-events: none; opacity: 0.9;
}
#${BADGE_ID}[data-state="on"] { background: rgba(30, 120, 60, 0.9); }
#${BADGE_ID}[data-state="off"] { background: rgba(120, 40, 40, 0.9); }
`;

function textOf(el) {
  // First text node = the label (move name / Pokémon name); avoids PP text.
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim();
  }
  return (el.textContent || '').trim();
}

/**
 * Create the adapter. Everything DOM-ish is injectable for jsdom tests:
 *   doc, win, isVisible(el), rectOf(el)
 */
export function createAdapter(options = {}) {
  const doc = options.doc || document;
  const win = options.win || window;
  // "Visible" = takes part in layout. visibility:hidden placeholders still
  // occupy a grid cell and are kept as `skip` items so the grid stays true.
  const isVisible = options.isVisible || (el => !!(el && (el.offsetParent || el.getClientRects().length)));
  const rectOf = options.rectOf || (el => el.getBoundingClientRect());

  // ---- room / container --------------------------------------------------

  function getRoom() {
    // Prefer the client's own notion of the current room.
    const app = win.app;
    if (app && app.curRoom && app.curRoom.$el && app.curRoom.$el[0]) {
      const el = app.curRoom.$el[0];
      if (el.querySelector(SELECTORS.controls)) return el;
    }
    // Fallback: the visible battle room.
    for (const el of doc.querySelectorAll(SELECTORS.room)) {
      if (el.style.display !== 'none' && el.querySelector(SELECTORS.controls)) return el;
    }
    return null;
  }

  function getControls() {
    const room = getRoom();
    return room ? room.querySelector(SELECTORS.controls) : null;
  }

  // ---- reading -----------------------------------------------------------

  function itemOf(el, i, kind) {
    const name = el.getAttribute('name');
    const value = el.getAttribute('value');
    const text = textOf(el);
    const disabledAttr = !!el.disabled;
    const disabledClass = el.classList.contains('disabled') || name === 'chooseDisabled';
    // Layout placeholders (target grid) are unnamed and empty/hidden.
    const skip = !name && (!text || (el.style && el.style.visibility === 'hidden'));
    let id;
    if (kind === 'MOVE') id = `move:${el.dataset.move || text || i}`;
    else if (kind === 'TARGET' || kind === 'SWITCH_TARGET') id = `${kind}:${name || 'x'}:${value ?? i}`;
    else id = `${kind}:${text || (name + ':' + value) || i}`;
    return { id, el, disabled: disabledAttr || disabledClass, skip };
  }

  /** Column count from geometry: number of items sharing the first row's top. */
  function columnsFor(els) {
    if (!els.length) return 0;
    const tops = els.map(el => { const r = rectOf(el); return r ? Math.round(r.top) : 0; });
    if (tops.every(t => t === 0)) return els.length; // no layout info (jsdom / hidden)
    const rows = [];
    for (const t of tops) {
      const row = rows.find(r => Math.abs(r - t) <= 4);
      if (row === undefined) rows.push(t);
    }
    rows.sort((a, b) => a - b);
    let best = 0;
    for (const r of rows) best = Math.max(best, tops.filter(t => Math.abs(t - r) <= 4).length);
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
    const q = sel => Array.from(controls.querySelectorAll(sel));

    // Sub-screens are mutually exclusive in the client; detect in priority order.
    if (q(SELECTORS.targetButtons).length) {
      // Every button in the target switchmenus, including disabled placeholders.
      const menus = q(SELECTORS.switchMenuAny).filter(m => m.querySelector(SELECTORS.targetButtons) || m.querySelector('button[disabled]'));
      const els = menus.flatMap(m => Array.from(m.querySelectorAll('button')));
      panes.TARGET = pane('TARGET', els);
    } else if (q(SELECTORS.switchTargetButtons).length) {
      const menu = q(SELECTORS.switchTargetButtons)[0].closest(SELECTORS.switchMenuAny) || controls;
      panes.SWITCH_TARGET = pane('SWITCH_TARGET', Array.from(menu.querySelectorAll('button')));
    } else if (q(SELECTORS.teamPreviewButtons).length) {
      const menu = q(SELECTORS.teamPreviewButtons)[0].closest(SELECTORS.switchMenuAny) || controls;
      panes.TEAM = pane('TEAM', Array.from(menu.querySelectorAll('button')));
    } else {
      const moves = q(SELECTORS.moveButtons);
      if (moves.length) panes.MOVE = pane('MOVE', moves);
      const switchMenu = q(SELECTORS.switchMenu)[0];
      if (switchMenu) panes.SWITCH = pane('SWITCH', Array.from(switchMenu.querySelectorAll('button')));
    }
    for (const k of Object.keys(panes)) if (!panes[k]) delete panes[k];

    const has = sel => q(sel).some(isVisible);
    const ctl = {
      back: has(SELECTORS.back),
      cancel: has(SELECTORS.cancel),
      gimmick: has(SELECTORS.gimmick),
      selectSwitch: !!q(SELECTORS.selectSwitch).length,
      selectMove: !!q(SELECTORS.selectMove).length,
      // Playback controls exist only while the battle display lags the log.
      skipTurn: q(SELECTORS.skipTurn).some(el => isVisible(el) && !el.disabled),
      goToEnd: q(SELECTORS.goToEnd).some(el => isVisible(el) && !el.disabled),
    };

    // Screen key: changes on a new request/turn/sub-screen, not on a
    // same-request re-render (timer tick etc.).
    const whatdo = controls.querySelector(SELECTORS.whatdo);
    let prompt = '';
    if (whatdo) {
      const clone = whatdo.cloneNode(true);
      clone.querySelectorAll(SELECTORS.timer).forEach(n => n.remove());
      prompt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    let turn = '';
    try {
      const app = win.app;
      const r = app && app.rooms && app.rooms[room.id.replace(/^room-/, '')];
      if (r && r.battle) turn = String(r.battle.turn);
    } catch (_) { /* ignore */ }
    const key = `${room.id}|${turn}|${Object.keys(panes).sort().join(',')}|${prompt}`;

    return { key, panes, controls: ctl, room };
  }

  // ---- acting ------------------------------------------------------------

  /**
   * Typing guard. The classic client focuses the (empty) chat textarea
   * whenever a battle room gains focus, so "a text field is focused" alone
   * would block the controller almost always. Match the client's own
   * keyboard-shortcut rule (client.js `safeLocation`): a focused text field
   * counts as typing only once it contains text.
   */
  function isTyping() {
    const el = doc.activeElement;
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && !/^(checkbox|radio|button|submit|range)$/i.test(el.type || ''))) {
      return (el.value || '').length > 0;
    }
    if (el.isContentEditable === true) return (el.textContent || '').trim().length > 0;
    return false;
  }

  function clickEl(el) {
    if (!el || el.disabled) return false;
    el.click();
    return true;
  }

  /** Activate items[index] of `pane`, verifying identity if `id` is given. */
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
  const skipTurn = () => clickControl(SELECTORS.skipTurn);
  const goToEnd = () => clickControl(SELECTORS.goToEnd);

  /**
   * Forfeit the CURRENT battle room via the client's room API (same path the
   * client's own forfeit popup takes; in a Bo3 game room this concedes the
   * game, not the set). The caller is responsible for arm-then-confirm.
   */
  function forfeit() {
    if (isTyping()) return false;
    const room = getRoom();
    if (!room) return false;
    const roomId = room.id.replace(/^room-/, '');
    const app = win.app;
    const r = app && app.rooms && app.rooms[roomId];
    if (r && typeof r.send === 'function') { r.send('/forfeit'); return true; }
    if (app && typeof app.send === 'function') { app.send('/forfeit', roomId); return true; }
    return false;
  }
  function gimmick() {
    // Toggle the first visible gimmick checkbox (tera / mega / z / dmax) via
    // a real click on the input, so the client's own change handlers run.
    if (isTyping()) return false;
    const controls = getControls();
    if (!controls) return false;
    const input = Array.from(controls.querySelectorAll(SELECTORS.gimmick)).find(el => isVisible(el) || isVisible(el.parentElement));
    if (!input) return false;
    input.click();
    return true;
  }

  // ---- cursor highlight --------------------------------------------------

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CURSOR_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }

  /** On-page status pill (bottom-right): 'waiting' | 'on' | 'off'. */
  function setStatus(state, text) {
    ensureStyle();
    let el = doc.getElementById(BADGE_ID);
    if (!el) {
      el = doc.createElement('div');
      el.id = BADGE_ID;
      (doc.body || doc.documentElement).appendChild(el);
    }
    el.dataset.state = state;
    el.textContent = text;
  }

  function clearCursor() {
    doc.querySelectorAll('.' + CURSOR_CLASS).forEach(el => el.classList.remove(CURSOR_CLASS));
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

  // ---- change notification ---------------------------------------------

  /**
   * Call cb() (debounced to one animation frame) whenever anything inside a
   * `.battle-controls` changes, or a room is shown/hidden. Rooms are created
   * dynamically, so we observe the document and filter.
   */
  function onControlsChanged(cb) {
    let scheduled = false;
    const raf = win.requestAnimationFrame ? f => win.requestAnimationFrame(f) : f => setTimeout(f, 16);
    const fire = () => {
      if (scheduled) return;
      scheduled = true;
      raf(() => { scheduled = false; cb(); });
    };
    // Ignore class mutations that only add/remove our own cursor class,
    // otherwise painting the cursor would re-trigger the observer forever.
    const strip = s => (s || '').split(/\s+/).filter(c => c && c !== CURSOR_CLASS).sort().join(' ');
    const observer = new win.MutationObserver(records => {
      for (const rec of records) {
        const t = rec.target;
        if (!t || !t.closest) { fire(); return; }
        if (rec.type === 'attributes' && rec.attributeName === 'class' && strip(rec.oldValue) === strip(t.className)) continue;
        if (t.closest(SELECTORS.controls)) { fire(); return; }
        if (rec.type === 'attributes' && t.matches && t.matches('.ps-room')) { fire(); return; }
        if (rec.type === 'childList' && (t === doc.body || t.matches?.('.ps-room, .battle-controls'))) { fire(); return; }
      }
    });
    observer.observe(doc.body || doc.documentElement, {
      childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'disabled'],
    });
    return () => observer.disconnect();
  }

  return {
    readScreen, activate, back, cancel, gimmick, selectSwitch, selectMove, skipTurn, goToEnd, forfeit,
    setCursor, clearCursor, setStatus, onControlsChanged, isTyping, getRoom, getControls,
  };
}
