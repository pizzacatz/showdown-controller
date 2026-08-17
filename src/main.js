// Entry point: wires INPUT → NAVIGATION → ADAPTER.
import { createGamepadInput, DEFAULTS as INPUT_DEFAULTS } from './gamepad.js';
import { initialState, reduce, sync } from './cursor.js';
import { createAdapter, BADGE_ID } from './showdown-dom.js';
import { createSettings } from './settings.js';

const CONFIG = {
  debug: false,
  enabledByDefault: true,
  toggleKey: { key: 'G', ctrlKey: true, shiftKey: true }, // Ctrl+Shift+G — free in the classic client
  // Button bindings live in src/gamepad.js (DEFAULT_BINDINGS) and can be
  // remapped in-page: click the 🎮 status pill → Rebind. Stored in localStorage.
  deadzone: INPUT_DEFAULTS.deadzone,
  repeatDelay: INPUT_DEFAULTS.repeatDelay,
  repeatInterval: INPUT_DEFAULTS.repeatInterval,
  forfeitConfirmMs: 4000, // Start once arms, Start again within this window forfeits
};

const TAG = '[showdown-gamepad]';
const log = (...a) => console.log(TAG, ...a);
const dbg = (...a) => { if (CONFIG.debug) console.log(TAG, ...a); };

export function start(win = window) {
  const doc = win.document;
  const adapter = createAdapter({ doc, win });
  const settings = createSettings({ doc, storage: safeStorage(win), onChange: () => { log('bindings updated'); paint(); } });
  let state = initialState();
  let enabled = CONFIG.enabledByDefault;
  let padSeen = false;
  let forfeitArmedAt = 0;
  let forfeitTimer = null;

  const L = intent => settings.labelFor(intent);
  const forfeitHint = () => (adapter.battleEnded() ? 'battle over' : `(${L('FORFEIT')}) forfeit`);

  function status() {
    if (forfeitArmedAt) { adapter.setStatus('off', `🎮 FORFEIT armed — press ${L('FORFEIT')} again to concede, anything else to cancel`); return; }
    if (!padSeen) adapter.setStatus('waiting', '🎮 Gamepad: press any button on the controller · click here for bindings');
    else if (!enabled) adapter.setStatus('off', `🎮 Gamepad OFF — ${L('TOGGLE_LAYER')} or Ctrl+Shift+G to enable`);
    else if (state.pane === 'WAIT') adapter.setStatus('on', `🎮 Gamepad ON — waiting for opponent (${L('BACK')} = cancel) · ${forfeitHint()}`);
    else if (state.pane === 'INACTIVE') adapter.setStatus('on', `🎮 Gamepad ON — nothing selectable on screen · ${forfeitHint()}`);
    else if (state.pane === 'POPUP') adapter.setStatus('on', `🎮 Gamepad ON — popup (${L('BACK')} = close)`);
    else if (state.pane === 'MENU') adapter.setStatus('on', `🎮 Gamepad ON — main menu · (${L('CLOSE_TAB')}) close tab`);
    else adapter.setStatus('on', `🎮 Gamepad ON — ${state.pane.toLowerCase().replace('_', ' ')} · ${forfeitHint()}`);
  }

  function hints() {
    if (!enabled || !padSeen) { adapter.clearHints(); return; }
    adapter.paintHints({ gimmick: L('GIMMICK'), skipTurn: L('SKIP_TURN'), goToEnd: L('SKIP_TO_END'), forfeit: L('FORFEIT') });
  }

  function paint() {
    status();
    hints();
    if (!enabled || !padSeen) { adapter.clearCursor(); return; }
    if (state.pane === 'WAIT' || state.pane === 'INACTIVE') { adapter.clearCursor(); return; }
    adapter.setCursor(state.pane, state.index);
  }

  function resync() {
    const screen = adapter.readScreen();
    const next = sync(state, screen);
    if (next.pane !== state.pane || next.index !== state.index || next.focusId !== state.focusId) {
      dbg('sync →', next.pane, next.index, next.focusId);
    }
    state = next;
    paint();
  }

  function setEnabled(on) {
    enabled = !!on;
    log(enabled ? 'controller layer ON' : 'controller layer OFF (mouse/keyboard unaffected)');
    paint();
  }

  function perform(action) {
    if (!action) return;
    dbg('action', action);
    switch (action.type) {
      case 'activate': adapter.activate(action.pane, action.index, action.id); break;
      case 'back': adapter.back(); break;
      case 'cancel': adapter.cancel(); break;
      case 'gimmick': adapter.gimmick(); break;
      case 'selectSwitch': adapter.selectSwitch(); break;
      case 'selectMove': adapter.selectMove(); break;
      case 'skipTurn': adapter.skipTurn(); break;
      case 'goToEnd': adapter.goToEnd(); break;
      case 'closePopup': adapter.closePopup(); break;
      case 'closeTab': adapter.closeTab(); break;
      case 'prevTab': adapter.switchTab(-1); break;
      case 'nextTab': adapter.switchTab(1); break;
      default: break;
    }
  }

  function disarmForfeit() {
    forfeitArmedAt = 0;
    if (forfeitTimer) { win.clearTimeout(forfeitTimer); forfeitTimer = null; }
  }

  function handleForfeit() {
    if (!adapter.getRoom() || adapter.battleEnded()) { dbg('forfeit: no live battle'); return; }
    const now = win.performance.now();
    if (forfeitArmedAt && now - forfeitArmedAt <= CONFIG.forfeitConfirmMs) {
      disarmForfeit();
      const ok = adapter.forfeit();
      log(ok ? 'forfeit sent' : 'forfeit: client API unavailable');
      paint();
      return;
    }
    forfeitArmedAt = now;
    forfeitTimer = win.setTimeout(() => { disarmForfeit(); paint(); }, CONFIG.forfeitConfirmMs);
    log(`forfeit armed — press ${L('FORFEIT')} again within ${CONFIG.forfeitConfirmMs / 1000}s to concede`);
    paint();
  }

  function handleIntent(type) {
    if (settings.isCapturing()) return; // that press was consumed by the remap panel
    if (type === 'TOGGLE_LAYER') { disarmForfeit(); setEnabled(!enabled); return; }
    if (!enabled) return;
    if (adapter.isTyping()) { dbg('ignored (typing):', type); return; }
    if (type === 'FORFEIT') { handleForfeit(); return; }
    if (forfeitArmedAt) { disarmForfeit(); paint(); } // any other button cancels the arm
    const screen = adapter.readScreen();
    const { state: next, action } = reduce(state, type, screen);
    state = next;
    paint();
    perform(action);
  }

  const input = createGamepadInput({
    bindings: () => settings.bindings,
    onRawButton: idx => { if (settings.onRawButton(idx)) dbg('rebound via raw button', idx); },
    deadzone: CONFIG.deadzone,
    repeatDelay: CONFIG.repeatDelay,
    repeatInterval: CONFIG.repeatInterval,
    getGamepads: () => win.navigator.getGamepads(),
    requestFrame: cb => win.requestAnimationFrame(cb),
    cancelFrame: id => win.cancelAnimationFrame(id),
    now: () => win.performance.now(),
    onEvent: ev => { dbg('intent', ev.type, ev.repeat ? '(repeat)' : ''); handleIntent(ev.type); },
    onStatus: st => {
      if (st.type === 'connected') { padSeen = true; log(`controller connected: ${st.id} (index ${st.padIndex})`); resync(); }
      else if (st.type === 'disconnected') { log('controller disconnected — mouse control only'); padSeen = false; adapter.clearCursor(); adapter.setStatus('waiting', '🎮 Gamepad: controller disconnected'); }
      else if (st.type === 'nonstandard') { log(`ignoring pad with mapping "${st.pad.mapping}" (need "standard"): ${st.pad.id}`); adapter.setStatus('off', `🎮 Gamepad: pad not in "standard" mapping (${st.pad.id.slice(0, 40)}) — see console`); }
    },
  });

  // Pads are invisible to getGamepads() until the first button press; the
  // browser fires gamepadconnected at that moment. Never warn before then.
  win.addEventListener('gamepadconnected', () => { input.start(); });
  win.addEventListener('gamepaddisconnected', () => {
    const any = Array.from(win.navigator.getGamepads() || []).some(Boolean);
    if (!any) input.stop();
  });
  if (Array.from(win.navigator.getGamepads?.() || []).some(Boolean)) input.start();

  adapter.onControlsChanged(resync);

  // Keyboard escape hatch: Ctrl+Shift+G toggles the layer.
  win.addEventListener('keydown', e => {
    const k = CONFIG.toggleKey;
    if (e.key.toUpperCase() === k.key && !!e.ctrlKey === !!k.ctrlKey && !!e.shiftKey === !!k.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      setEnabled(!enabled);
    }
  }, true);

  // Clicking the status pill opens the bindings panel.
  doc.addEventListener('click', e => {
    if (e.target && e.target.closest && e.target.closest('#' + BADGE_ID)) settings.toggle();
  }, true);

  log(`loaded — press any controller button to activate. ${L('TOGGLE_LAYER')} or Ctrl+Shift+G toggles the layer; click the 🎮 pill to remap buttons.`);
  status();

  // Test / debugging hook. Lets tools/recon.js and the console drive the
  // layer without a physical pad. Never used by the script itself.
  win.__showdownGamepad = {
    inject(intent) { padSeen = true; handleIntent(intent); return this.debug(); },
    enable(on) { padSeen = true; setEnabled(on); resync(); },
    debug() {
      resync();
      const screen = adapter.readScreen();
      const p = screen.panes[state.pane];
      return {
        enabled, pane: state.pane, index: state.index, focusId: state.focusId,
        panes: Object.fromEntries(Object.entries(screen.panes).map(([k, v]) => [k, { n: v.items.length, columns: v.columns }])),
        controls: screen.controls,
        item: p && p.items[state.index] ? { id: p.items[state.index].id, disabled: p.items[state.index].disabled } : null,
        ids: p ? p.items.map(i => i.id + (i.disabled ? '!' : '') + (i.skip ? '*' : '')) : [],
      };
    },
    resync,
    settings,
    get state() { return state; },
    input,
  };
}

function safeStorage(win) {
  try { return win.localStorage; } catch (_) { return null; }
}

// Auto-start when running as a userscript (not when imported by tests).
if (typeof window !== 'undefined' && !window.__showdownGamepadNoAutostart) {
  const boot = () => { try { start(window); } catch (e) { console.error(TAG, 'failed to start', e); } };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot, { once: true });
}
