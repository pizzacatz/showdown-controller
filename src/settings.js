// SETTINGS — persisted button bindings + a small remap panel.
// No Showdown knowledge; plain DOM. Storage is injectable for tests.

import { DEFAULT_BINDINGS, INTENTS, buttonLabel, BUTTON_LABELS } from './gamepad.js';

export const STORAGE_KEY = 'showdown-gamepad.bindings.v1';
export const PANEL_ID = 'sgp-settings';

/** intent → button index (inverse of a bindings map). */
export function intentToButton(bindings) {
  const out = {};
  for (const [btn, intent] of Object.entries(bindings)) out[intent] = Number(btn);
  return out;
}

export function loadBindings(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw);
    const known = new Set(INTENTS.map(i => i.id));
    const out = {};
    for (const [btn, intent] of Object.entries(parsed)) {
      if (Number.isInteger(Number(btn)) && known.has(intent)) out[Number(btn)] = intent;
    }
    return Object.keys(out).length ? out : { ...DEFAULT_BINDINGS };
  } catch (_) {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(storage, bindings) {
  try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch (_) { /* ignore */ }
}

/** Return a new bindings map with `button` assigned to `intent` (unbinding it elsewhere). */
export function rebind(bindings, intent, button) {
  const out = {};
  for (const [b, i] of Object.entries(bindings)) {
    if (i === intent) continue;            // drop the intent's old button
    if (Number(b) === button) continue;    // steal the button from whatever had it
    out[Number(b)] = i;
  }
  out[button] = intent;
  return out;
}

export const PANEL_CSS = `
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

/**
 * createSettings({ doc, storage, onChange })
 *   .bindings           current map (button index → intent)
 *   .labelFor(intent)   'RB' | '—'
 *   .open()/.close()/.toggle()
 *   .isCapturing()      true while waiting for a button press to rebind
 *   .onRawButton(idx)   feed raw pad presses here; returns true if consumed
 */
export function createSettings({ doc = document, storage = (typeof localStorage !== 'undefined' ? localStorage : null), onChange = () => {} } = {}) {
  let bindings = loadBindings(storage);
  let panel = null;
  let listeningFor = null;

  const labelFor = intent => {
    const b = intentToButton(bindings)[intent];
    return b === undefined ? '—' : buttonLabel(b);
  };

  function ensureStyle() {
    if (doc.getElementById(PANEL_ID + '-style')) return;
    const st = doc.createElement('style');
    st.id = PANEL_ID + '-style';
    st.textContent = PANEL_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function render() {
    if (!panel) return;
    const rows = INTENTS.map(({ id, label }) => `
      <tr data-intent="${id}" class="${listeningFor === id ? 'listening' : ''}">
        <td>${label}</td>
        <td class="k">${listeningFor === id ? 'press…' : labelFor(id)}</td>
        <td style="text-align:right"><button type="button" data-rebind="${id}">${listeningFor === id ? 'Cancel' : 'Rebind'}</button></td>
      </tr>`).join('');
    panel.innerHTML = `
      <h3>🎮 Gamepad bindings</h3>
      <table>${rows}</table>
      <div class="foot">
        <button type="button" data-reset>Reset defaults</button>
        <button type="button" data-close>Close</button>
      </div>
      <div class="note">Click Rebind, then press a controller button. Bindings are saved in this browser. Buttons: ${BUTTON_LABELS.join(' ')}.</div>`;
  }

  function open() {
    ensureStyle();
    if (!panel) {
      panel = doc.createElement('div');
      panel.id = PANEL_ID;
      panel.addEventListener('click', e => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.rebind) {
          listeningFor = listeningFor === t.dataset.rebind ? null : t.dataset.rebind;
          render();
        } else if (t.hasAttribute('data-reset')) {
          bindings = { ...DEFAULT_BINDINGS };
          saveBindings(storage, bindings);
          listeningFor = null;
          render();
          onChange(bindings);
        } else if (t.hasAttribute('data-close')) {
          close();
        }
      });
      (doc.body || doc.documentElement).appendChild(panel);
    }
    render();
  }

  function close() {
    listeningFor = null;
    if (panel) { panel.remove(); panel = null; }
  }

  return {
    get bindings() { return bindings; },
    labelFor,
    open, close,
    toggle() { panel ? close() : open(); },
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
    },
  };
}
