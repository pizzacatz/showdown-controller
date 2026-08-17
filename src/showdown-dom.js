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
  // Playback + end-of-battle buttons. Upload/download replay are left out on
  // purpose (outward-facing); QoL Battle Tools already automates them.
  playback: 'button[name="pause"], button[name="play"], button[name="instantReplay"], button[name="rewindTurn"], button[name="skipTurn"], button[name="goToEnd"], button[name="closeAndMainMenu"], button[name="closeAndRematch"]',
  // Modal popups (format picker, team picker, confirmations, errors). Topmost = last in DOM.
  popup: '.ps-popup',
  popupClose: 'button[name="close"]',
  // Main menu (room id '' → element #room-). Includes injected buttons (Ghost Clicker) since they are plain buttons too.
  mainMenu: '.mainmenu',
  mainMenuRoom: '#room-',
  // Only the battle group of the main menu: format selector, injected quick-
  // select buttons (Ghost Clicker), team selector, Battle! / Cancel search.
  mainMenuBattleForm: 'form.battleform',
  menuGroup: '.menugroup',
  roomTabClose: 'button[name="closeRoom"]',
  roomTabs: '.maintabbar a.roomtab[href]', // one per open tab, DOM order = visual order; .cur = current
  headings: { MOVE: '.moveselect button', SWITCH: '.switchselect button', TEAM: '.switchselect button' },
  qolForfeit: 'button[data-qol="forfeit"]', // QoL Battle Tools' arm-then-confirm forfeit button, if installed
};

export const CURSOR_CLASS = 'sgp-cursor';
export const PANE_CLASS = 'sgp-pane';
export const DISABLED_CLASS = 'sgp-disabled';
export const HEADING_CLASS = 'sgp-heading';
export const HINT_CLASS = 'sgp-hint';
export const BADGE_ID = 'sgp-status';
export const STYLE_ID = 'sgp-cursor-style';
export const CURSOR_CSS = `
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

/* Button hints, e.g. "(RB)" next to Terastallize — same accent and radius as the ring. */
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
    else if (kind === 'PLAYBACK') id = `PLAYBACK:${name || text || i}`;
    else if (kind === 'POPUP' || kind === 'MENU') id = `${kind}:${name || 'x'}:${value ?? ''}:${text || i}`;
    else if (kind === 'TARGET' || kind === 'SWITCH_TARGET') id = `${kind}:${name || 'x'}:${value ?? i}`;
    else id = `${kind}:${text || (name + ':' + value) || i}`;
    return { id, el, disabled: disabledAttr || disabledClass, skip };
  }

  /**
   * Build a rectangular grid from geometry: group visible elements into rows
   * by their top edge (4px tolerance), order rows top→bottom and cells
   * left→right, pad short rows with `skip` placeholders so the flat list is
   * row-major with a single column count. Without layout info (jsdom,
   * hidden) it degrades to one row in DOM order.
   */
  function pane(kind, els) {
    const visible = els.filter(isVisible);
    if (!visible.length) return null;
    const rects = visible.map(el => rectOf(el) || { top: 0, left: 0, width: 0, height: 0 });
    if (rects.every(r => !r.top && !r.left && !r.width)) {
      return { items: visible.map((el, i) => itemOf(el, i, kind)), columns: visible.length };
    }
    const rows = [];
    visible.forEach((el, i) => {
      const r = rects[i];
      let row = rows.find(rw => Math.abs(rw.top - r.top) <= 4);
      if (!row) { row = { top: r.top, cells: [] }; rows.push(row); }
      row.cells.push({ el, left: r.left, i });
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach(rw => rw.cells.sort((a, b) => a.left - b.left || a.i - b.i));
    const columns = Math.max(...rows.map(rw => rw.cells.length));
    const items = [];
    rows.forEach((rw, ri) => {
      rw.cells.forEach(c => items.push(itemOf(c.el, c.i, kind)));
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
    else { const el = doc.querySelector(SELECTORS.mainMenuRoom); if (el && el.style.display !== 'none') roomEl = el; }
    if (!roomEl || (roomEl.id && roomEl.id !== 'room-')) return null;
    return roomEl.querySelector(SELECTORS.mainMenu);
  }

  function readScreen() {
    // Modal popup on top of everything: only its buttons are reachable.
    const popup = getPopup();
    if (popup) {
      const p = pane('POPUP', Array.from(popup.querySelectorAll('button')));
      return { key: `popup|${popup.id || ''}|${p ? p.items.length : 0}`, panes: p ? { POPUP: p } : {}, controls: { closePopup: true }, room: null, popup };
    }
    const room = getRoom();
    const controls = room && room.querySelector(SELECTORS.controls);
    if (!controls) {
      // Main menu?
      const menu = getMainMenu();
      if (menu) {
        // The battle group(s): the search form (format / quick-select / team /
        // Battle!) and, while you have games running, the "Games" group the
        // client shows in its place (links to your battles + "Add game").
        const groups = [];
        for (const form of menu.querySelectorAll(SELECTORS.mainMenuBattleForm)) {
          const g = form.closest(SELECTORS.menuGroup) || form;
          if (!groups.includes(g)) groups.push(g);
        }
        if (!groups.length) { const g = menu.querySelector(SELECTORS.menuGroup); if (g) groups.push(g); }
        const els = groups.flatMap(g => Array.from(g.querySelectorAll('button, .roomlist a.blocklink')));
        const p = pane('MENU', els);
        if (p) { p.wrap = true; return { key: `menu|${p.items.length}`, panes: { MENU: p }, controls: {}, room: null, menu }; }
      }
      return { key: null, panes: {}, controls: {}, room: null };
    }

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
    // Playback controls can coexist with the above (e.g. after the battle).
    const playback = q(SELECTORS.playback);
    if (playback.length) panes.PLAYBACK = pane('PLAYBACK', playback);
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
  /**
   * Close the current Showdown tab (room). Uses the client's leaveRoom, which
   * runs the room's own requestLeave() — for a live battle that opens the
   * client's Forfeit popup instead of silently leaving. The main menu can't
   * be closed. Fallback: click the tab's × button.
   */
  function closeTab() {
    if (isTyping()) return false;
    const app = win.app;
    const cur = app && app.curRoom;
    if (!cur || !cur.id) return false;
    if (typeof app.leaveRoom === 'function') { app.leaveRoom(cur.id); return true; }
    const btn = Array.from(doc.querySelectorAll(SELECTORS.roomTabClose)).find(b => b.value === cur.id);
    if (btn) { btn.click(); return true; }
    return false;
  }

  /**
   * Focus the previous (-1) / next (+1) tab, wrapping. Walks the top tab bar
   * (Home, Teambuilder, Ladder, battles, chats…) rather than app.roomList,
   * which only holds chat/battle rooms. Skips the "+" (rooms) tab.
   */
  function switchTab(dir) {
    if (isTyping()) return false;
    const app = win.app;
    if (!app || typeof app.focusRoom !== 'function') return false;
    const root = (app.root || '/');
    const ids = [];
    for (const a of doc.querySelectorAll(SELECTORS.roomTabs)) {
      const href = a.getAttribute('href') || '';
      const id = href.startsWith(root) ? href.slice(root.length) : href.replace(/^\//, '');
      if (id === 'rooms' || ids.includes(id)) continue;
      ids.push(id);
    }
    if (ids.length < 2) return false;
    const curId = app.curRoom ? app.curRoom.id : '';
    let idx = ids.indexOf(curId);
    if (idx < 0) idx = 0;
    const next = ids[((idx + dir) % ids.length + ids.length) % ids.length];
    app.focusRoom(next);
    return true;
  }

  /** Close the topmost popup: its own Close button if it has one, else the client's dismissPopups(). */
  function closePopup() {
    if (isTyping()) return false;
    const popup = getPopup();
    if (!popup) return false;
    const btn = Array.from(popup.querySelectorAll(SELECTORS.popupClose)).find(isVisible);
    if (btn) { btn.click(); return true; }
    const app = win.app;
    if (app && typeof app.dismissPopups === 'function') { app.dismissPopups(); return true; }
    return false;
  }
  const goToEnd = () => clickControl(SELECTORS.goToEnd);

  /** True when the current battle room's battle is over (or there is no battle room). */
  function battleEnded() {
    const room = getRoom();
    if (!room) return true;
    const app = win.app;
    const r = app && app.rooms && app.rooms[room.id.replace(/^room-/, '')];
    if (r && (r.battleEnded || (r.battle && r.battle.ended))) return true;
    // Without the client API: end-of-battle controls are a reliable signal.
    return !!room.querySelector('button[name="closeAndMainMenu"], button[name="closeAndRematch"]');
  }

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
    doc.querySelectorAll('.' + DISABLED_CLASS).forEach(el => el.classList.remove(DISABLED_CLASS));
    doc.querySelectorAll('.' + HEADING_CLASS).forEach(el => el.classList.remove(HEADING_CLASS));
    doc.querySelectorAll('.' + PANE_CLASS).forEach(el => el.remove());
  }

  function setCursor(paneName, index) {
    ensureStyle();
    clearCursor();
    const screen = readScreen();
    const p = screen.panes[paneName];
    const item = p && p.items[index];
    if (!item || !item.el) return false;
    item.el.classList.add(CURSOR_CLASS);
    // Layer 3: dim every non-selectable button in every visible pane.
    for (const pn of Object.values(screen.panes)) {
      for (const it of pn.items) if (it.disabled && !it.skip && it.el) it.el.classList.add(DISABLED_CLASS);
    }
    // Layer 2b: tint the active group's heading (Attack / Switch / Choose Lead).
    const controlsEl = item.el.closest(SELECTORS.controls);
    const hsel = SELECTORS.headings[paneName];
    if (controlsEl && hsel) { const h = controlsEl.querySelector(hsel); if (h) h.classList.add(HEADING_CLASS); }
    // Layer 2a: tray behind the pane — an overlay around the union of the pane's visible
    // buttons, positioned inside .battle-controls (which is position:absolute
    // in the client, so it is the offset parent).
    const controls = item.el.closest(SELECTORS.controls);
    if (controls) {
      const rects = p.items.filter(it => it.el && (!it.skip || it.el.style.visibility === 'hidden')).map(it => rectOf(it.el)).filter(r => r && r.width > 0);
      if (rects.length) {
        const cr = rectOf(controls);
        const pad = 4;
        const left = Math.min(...rects.map(r => r.left)) - cr.left - pad;
        const top = Math.min(...rects.map(r => r.top)) - cr.top - pad;
        const right = Math.max(...rects.map(r => r.left + r.width)) - cr.left + pad;
        const bottom = Math.max(...rects.map(r => r.top + r.height)) - cr.top + pad;
        const box = doc.createElement('div');
        box.className = PANE_CLASS;
        box.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;`;
        controls.appendChild(box);
      }
    }
    return true;
  }

  /**
   * Show "(RB)"-style hints next to on-screen controls. `labels` maps
   * control → button label, e.g. { gimmick: 'RB', skipTurn: 'LB', goToEnd: 'Y' }.
   * Idempotent: existing hints are updated in place, so re-painting after a
   * re-render doesn't churn the DOM.
   */
  function paintHints(labels) {
    ensureStyle();
    const controls = getControls();
    if (!controls) return;
    const targets = [];
    const gim = Array.from(controls.querySelectorAll(SELECTORS.gimmick)).find(el => isVisible(el) || isVisible(el.parentElement));
    if (gim && labels.gimmick) targets.push([gim.closest('label') || gim.parentElement, labels.gimmick]);
    for (const [key, sel] of [['skipTurn', SELECTORS.skipTurn], ['goToEnd', SELECTORS.goToEnd]]) {
      if (!labels[key]) continue;
      controls.querySelectorAll(sel).forEach(el => { if (isVisible(el) && !el.disabled) targets.push([el, labels[key]]); });
    }
    // Always-on forfeit hint: attach to QoL Battle Tools' Forfeit button when
    // present (it lives in the same room), else float it top-right of the controls.
    let forfeitHost = null;
    if (labels.forfeit && !battleEnded()) {
      const room = getRoom();
      const qol = room && Array.from(room.querySelectorAll(SELECTORS.qolForfeit)).find(isVisible);
      forfeitHost = qol || controls;
      targets.push([forfeitHost, labels.forfeit, forfeitHost === controls ? 'sgp-hint-forfeit' : '']);
    }
    const wanted = new Set();
    for (const [host, label, extraClass = '', suffix = ''] of targets) {
      const cls = HINT_CLASS + (extraClass ? ' ' + extraClass : '');
      let hint = Array.from(host.children).find(c => c.classList && c.classList.contains(HINT_CLASS) && (extraClass ? c.classList.contains(extraClass) : !c.classList.contains('sgp-hint-forfeit')));
      if (!hint) { hint = doc.createElement('span'); hint.className = cls; host.appendChild(hint); }
      const text = `(${label})${suffix ? ' ' + suffix : ''}`;
      if (hint.textContent !== text) hint.textContent = text;
      wanted.add(hint);
    }
    const scope = forfeitHost && forfeitHost !== controls ? getRoom() : controls;
    (scope || controls).querySelectorAll('.' + HINT_CLASS).forEach(h => { if (!wanted.has(h)) h.remove(); });
  }

  function clearHints() {
    doc.querySelectorAll('.' + HINT_CLASS).forEach(h => h.remove());
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
    const OURS = new Set([CURSOR_CLASS, PANE_CLASS, DISABLED_CLASS, HEADING_CLASS]);
    const strip = s => (s || '').split(/\s+/).filter(c => c && !OURS.has(c)).sort().join(' ');
    const isHint = n => n && n.nodeType === 1 && (n.classList.contains(HINT_CLASS) || n.classList.contains(PANE_CLASS));
    const observer = new win.MutationObserver(records => {
      for (const rec of records) {
        const t = rec.target;
        if (!t || !t.closest) { fire(); return; }
        if (rec.type === 'attributes' && rec.attributeName === 'class' && strip(rec.oldValue) === strip(t.className)) continue;
        if (rec.type === 'childList' && [...rec.addedNodes, ...rec.removedNodes].every(isHint)) continue;
        if (rec.type === 'characterData' && isHint(t.parentNode)) continue;
        if (t.closest(SELECTORS.controls)) { fire(); return; }
        if (rec.type === 'attributes' && t.matches && t.matches('.ps-room')) { fire(); return; }
        if (rec.type === 'childList' && (t === doc.body || t.matches?.('.ps-room, .battle-controls'))) { fire(); return; }
        if (t.closest(SELECTORS.popup) || t.closest(SELECTORS.mainMenu)) { fire(); return; }
      }
    });
    observer.observe(doc.body || doc.documentElement, {
      childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'disabled'],
    });
    return () => observer.disconnect();
  }

  return {
    readScreen, activate, back, cancel, gimmick, selectSwitch, selectMove, skipTurn, goToEnd, forfeit, closePopup, battleEnded, closeTab, switchTab,
    setCursor, clearCursor, paintHints, clearHints, setStatus, onControlsChanged, isTyping, getRoom, getControls,
  };
}
