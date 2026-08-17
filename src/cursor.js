// NAVIGATION LAYER — pure. No DOM, no gamepad.
//
// A `screen` describes what the adapter currently sees:
//   {
//     key:   string|null,          // changes when the request/turn/sub-screen changes
//     panes: {                     // only panes that are on screen and non-empty
//       MOVE?:          { items: Item[], columns: number },
//       TARGET?:        { items, columns },
//       SWITCH?:        { items, columns },
//       SWITCH_TARGET?: { items, columns },
//       TEAM?:          { items, columns },
//       PLAYBACK?:      { items, columns },
//     },
//     controls: { back, cancel, gimmick, selectSwitch, selectMove }  // booleans
//   }
//   Item = { id: string, disabled?: boolean, skip?: boolean }
//     disabled: cursor may land on it, CONFIRM does nothing (e.g. 0-PP move)
//     skip:     cursor never lands on it (invisible layout placeholder)
//
// State: { pane, index, focusId, screenKey, memory }
//   memory remembers the last focused id per pane so X/B round-trips return
//   the cursor to where it was.
//
// reduce(state, event, screen) → { state, action|null }
//   action: { type: 'activate', pane, index, id }
//         | { type: 'back' }         (Showdown "Back" = clearChoice)
//         | { type: 'cancel' }       (Showdown "Cancel" = undoChoice)
//         | { type: 'gimmick' }
//         | { type: 'selectSwitch' } | { type: 'selectMove' }
//         | { type: 'skipTurn' } | { type: 'goToEnd' }   (playback controls)
//         | { type: 'closePopup' }
//         | { type: 'closeTab' } | { type: 'prevTab' } | { type: 'nextTab' }
//   Pane option `wrap: true` (main menu) makes UP/DOWN wrap at the ends.

// PLAYBACK = pause / first turn / prev turn / skip turn / skip to end buttons
// (shown while the battle animation lags the log, and after the battle).
// POPUP = a modal .ps-popup (format/team picker, confirmations) — always wins.
// MENU  = the main menu buttons (only when no battle room is showing).
export const PANE_PRIORITY = ['POPUP', 'TARGET', 'SWITCH_TARGET', 'TEAM', 'MOVE', 'SWITCH', 'PLAYBACK', 'MENU'];

export function initialState() {
  return { pane: 'INACTIVE', index: 0, focusId: null, screenKey: null, memory: {} };
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

/**
 * Nearest index to `i` satisfying `ok`, searching forward then backward.
 * -1 if none.
 */
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
const landable = it => !it.skip;
const enabled = it => !it.skip && !it.disabled;
const nearestLandable = (items, i) => nearest(items, i, landable);

/**
 * Bring `state` in line with `screen`. Call after every re-render.
 * - Keeps the current pane if it still exists on the same screen; picks the
 *   highest-priority pane otherwise.
 * - Restores the cursor by item identity, then by clamped index.
 */
export function sync(state, screen) {
  const avail = availablePanes(screen);
  const controls = (screen && screen.controls) || {};
  const memory = { ...(state.memory || {}) };
  if (state.pane && state.focusId && !['WAIT', 'INACTIVE'].includes(state.pane)) {
    memory[state.pane] = state.focusId;
  }

  if (!avail.length) {
    const pane = controls.cancel ? 'WAIT' : 'INACTIVE';
    return { ...state, pane, index: 0, focusId: null, screenKey: screen ? screen.key : null, memory };
  }

  // Same screen re-rendered (timer tick, PP update): keep the pane the user
  // is in. New request/turn/sub-screen: reset to the primary pane (mainline
  // resets to Fight each turn).
  const sameScreen = state.screenKey === (screen.key ?? null);
  const pane = sameScreen && avail.includes(state.pane) ? state.pane : avail[0];

  const items = screen.panes[pane].items;
  const wantId = pane === state.pane ? state.focusId : memory[pane];
  let index = -1;
  if (wantId != null) index = items.findIndex(it => it.id === wantId);
  if (index < 0) index = pane === state.pane ? clamp(state.index, items.length) : 0;
  // On a NEW screen (e.g. team preview slot 2, next turn) don't leave the
  // cursor parked on something that just became unusable — the slot you
  // just picked, a move that ran out of PP. Same-screen re-renders keep it.
  const want = sameScreen ? landable : enabled;
  let landed = nearest(items, index, want);
  if (landed < 0) landed = nearestLandable(items, index);
  index = landed < 0 ? 0 : landed;

  return {
    ...state, pane, index,
    focusId: items[index] ? items[index].id : null,
    screenKey: screen.key ?? null,
    memory,
  };
}

/** Grid movement over a flat list with a column count. Returns new index or the same index. */
export function move(items, columns, index, dir, wrap = false) {
  const n = items.length;
  if (!n) return index;
  const c = Math.max(1, Math.min(columns | 0 || n, n));
  const row = i => Math.floor(i / c);
  const lastRow = row(n - 1);
  const rowStart = r => r * c;
  const rowEnd = r => Math.min(n - 1, r * c + c - 1);

  if (wrap && (dir === 'UP' || dir === 'DOWN')) {
    // Wrap-around lists (main menu): step row by row, skipping placeholders,
    // and jump to the other end when running off the top/bottom.
    const col = index - rowStart(row(index));
    const rowsN = lastRow + 1;
    for (let k = 1; k <= rowsN; k++) {
      const r = (((row(index) + (dir === 'DOWN' ? k : -k)) % rowsN) + rowsN) % rowsN;
      const i = Math.min(rowStart(r) + col, rowEnd(r));
      if (!items[i].skip) return i;
    }
    return index;
  }

  if (dir === 'LEFT' || dir === 'RIGHT') {
    // Row-bounded: clamp at the row edge instead of wrapping into the next
    // row (a wrap from the last foe target to the ally would be a misclick).
    const step = dir === 'LEFT' ? -1 : 1;
    const r = row(index);
    let i = index + step;
    while (i >= rowStart(r) && i <= rowEnd(r)) {
      if (!items[i].skip) return i;
      i += step;
    }
    return index;
  }

  if (dir === 'UP' || dir === 'DOWN') {
    const r = row(index);
    const targetRow = dir === 'UP' ? r - 1 : r + 1;
    if (targetRow < 0 || targetRow > lastRow) return index;
    const col = index - rowStart(r);
    const start = rowStart(targetRow), end = rowEnd(targetRow);
    let i = clamp(start + col, n);
    if (i > end) i = end;
    if (!items[i].skip) return i;
    // Placeholder cell: nearest landable in that row by column distance
    for (let d = 1; d <= c; d++) {
      if (i + d <= end && !items[i + d].skip) return i + d;
      if (i - d >= start && !items[i - d].skip) return i - d;
    }
    // Row is entirely placeholders: try the row beyond it
    const next = move(items, columns, i, dir);
    return next === i ? index : next;
  }
  return index;
}

export function reduce(state, event, screen) {
  state = sync(state, screen);
  const type = typeof event === 'string' ? event : event && event.type;
  const controls = (screen && screen.controls) || {};
  const pane = state.pane;
  const paneData = screen && screen.panes && screen.panes[pane];
  const items = paneData ? paneData.items : [];
  const none = { state, action: null };

  switch (type) {
    case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT': {
      if (!items.length) return none;
      const index = move(items, columnsOf(paneData), state.index, type, !!paneData.wrap);
      if (index === state.index) {
        // Moves and party are stacked on the desktop layout: ↓ off the bottom
        // of the moves enters the party list, ↑ off its top returns.
        const avail = availablePanes(screen);
        if (type === 'DOWN' && pane === 'MOVE' && avail.includes('SWITCH')) {
          return { state: switchPane(state, screen, 'SWITCH'), action: controls.selectSwitch ? { type: 'selectSwitch' } : null };
        }
        if (type === 'UP' && pane === 'SWITCH' && avail.includes('MOVE')) {
          return { state: switchPane(state, screen, 'MOVE'), action: controls.selectMove ? { type: 'selectMove' } : null };
        }
        return none;
      }
      const focusId = items[index].id;
      return { state: { ...state, index, focusId, memory: { ...state.memory, [pane]: focusId } }, action: null };
    }
    case 'CONFIRM': {
      const item = items[state.index];
      if (!item || item.disabled || item.skip) return none;
      return { state, action: { type: 'activate', pane, index: state.index, id: item.id } };
    }
    case 'BACK': {
      if (pane === 'POPUP') return controls.closePopup ? { state, action: { type: 'closePopup' } } : none;
      if (pane === 'WAIT') return controls.cancel ? { state, action: { type: 'cancel' } } : none;
      // Leaving the switch list returns to the moves first (mainline: B closes the Pokémon menu).
      if (pane === 'SWITCH' && availablePanes(screen).includes('MOVE')) {
        return { state: switchPane(state, screen, 'MOVE'), action: controls.selectMove ? { type: 'selectMove' } : null };
      }
      if (controls.back) return { state, action: { type: 'back' } };
      return none;
    }
    case 'SWITCH_MENU': {
      if (pane !== 'SWITCH' && availablePanes(screen).includes('SWITCH')) {
        return { state: switchPane(state, screen, 'SWITCH'), action: controls.selectSwitch ? { type: 'selectSwitch' } : null };
      }
      return none;
    }
    case 'GIMMICK':
      return controls.gimmick ? { state, action: { type: 'gimmick' } } : none;
    case 'SKIP_TURN':
      return controls.skipTurn ? { state, action: { type: 'skipTurn' } } : none;
    case 'SKIP_TO_END':
      return controls.goToEnd ? { state, action: { type: 'goToEnd' } } : none;
    case 'CLOSE_TAB': return { state, action: { type: 'closeTab' } };
    case 'PREV_TAB': return { state, action: { type: 'prevTab' } };
    case 'NEXT_TAB': return { state, action: { type: 'nextTab' } };
    default:
      return none;
  }
}

function switchPane(state, screen, pane) {
  const items = screen.panes[pane].items;
  const memory = { ...state.memory };
  if (state.focusId && state.pane !== 'WAIT' && state.pane !== 'INACTIVE') memory[state.pane] = state.focusId;
  let index = memory[pane] != null ? items.findIndex(it => it.id === memory[pane]) : -1;
  if (index < 0) index = nearest(items, 0, enabled);   // first usable entry (skip active/fainted mons)
  if (index < 0) index = nearestLandable(items, 0);
  if (index < 0) index = 0;
  return { ...state, pane, index, focusId: items[index] ? items[index].id : null, memory };
}
