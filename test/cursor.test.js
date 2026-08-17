import { describe, it, expect } from 'vitest';
import { initialState, sync, reduce, move } from '../src/cursor.js';

const items = (n, prefix = 'i') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

// Screens modelled on the real client (see docs/dom-recon.md)
const moveScreen = (key = 'turn1', extra = {}) => ({
  key,
  panes: {
    MOVE: { items: [{ id: 'move:Thunderbolt' }, { id: 'move:Surf' }, { id: 'move:Protect' }, { id: 'move:Fake Out' }], columns: 4 },
    SWITCH: { items: [
      { id: 'SWITCH:Pikachu', disabled: true }, { id: 'SWITCH:Charizard', disabled: true },
      { id: 'SWITCH:Blastoise' }, { id: 'SWITCH:Venusaur' }, { id: 'SWITCH:Snorlax' }, { id: 'SWITCH:Gengar' },
    ], columns: 6 },
  },
  controls: { back: false, cancel: false, gimmick: true, selectSwitch: true, selectMove: true, ...extra },
});
const targetScreen = {
  key: 'turn1-target',
  panes: { TARGET: { items: [
    { id: 'TARGET:chooseMoveTarget:2' }, { id: 'TARGET:chooseMoveTarget:1' },
    { id: 'TARGET:x:2', disabled: true, skip: true }, { id: 'TARGET:chooseMoveTarget:-2' },
  ], columns: 2 } },
  controls: { back: true },
};
const teamScreen = (done = 0) => ({
  key: `team${done}`,
  panes: { TEAM: { items: items(6, 'TEAM:').map((it, i) => (i < done ? { ...it, disabled: true } : it)), columns: 6 } },
  controls: { back: done > 0 },
});
const waitScreen = { key: 'wait', panes: {}, controls: { cancel: true } };
const emptyScreen = { key: null, panes: {}, controls: {} };

const run = (state, screen, ...events) => {
  const actions = [];
  for (const e of events) {
    const r = reduce(state, e, screen);
    state = r.state;
    actions.push(r.action);
  }
  return { state, actions, last: actions.at(-1) };
};

describe('move()', () => {
  const g = (n, c) => items(n).map(x => x);
  it('moves ±1 within a row and clamps at row edges', () => {
    const it4 = g(4, 4);
    expect(move(it4, 4, 0, 'RIGHT')).toBe(1);
    expect(move(it4, 4, 3, 'RIGHT')).toBe(3);
    expect(move(it4, 4, 0, 'LEFT')).toBe(0);
    const it4x2 = g(4, 2);
    expect(move(it4x2, 2, 1, 'RIGHT')).toBe(1); // no wrap into next row
    expect(move(it4x2, 2, 2, 'LEFT')).toBe(2);
  });
  it('moves ±columns vertically and clamps', () => {
    const it4x2 = g(4, 2);
    expect(move(it4x2, 2, 0, 'DOWN')).toBe(2);
    expect(move(it4x2, 2, 3, 'UP')).toBe(1);
    expect(move(it4x2, 2, 2, 'DOWN')).toBe(2);
    expect(move(it4x2, 2, 1, 'UP')).toBe(1);
  });
  it('single row: up/down are no-ops', () => {
    expect(move(g(6), 6, 3, 'DOWN')).toBe(3);
    expect(move(g(6), 0, 3, 'UP')).toBe(3); // columns 0 → treated as one row
  });
  it('odd counts: down onto a short last row lands on its last cell', () => {
    const it3 = g(3, 2); // [0 1] [2]
    expect(move(it3, 2, 1, 'DOWN')).toBe(2);
    expect(move(it3, 2, 2, 'UP')).toBe(0);
  });
  it('skips placeholder cells (doubles target grid)', () => {
    const t = targetScreen.panes.TARGET.items;
    expect(move(t, 2, 0, 'DOWN')).toBe(3);   // foe-left ↓ → self slot hidden → ally
    expect(move(t, 2, 1, 'DOWN')).toBe(3);
    expect(move(t, 2, 3, 'UP')).toBe(1);
    expect(move(t, 2, 3, 'LEFT')).toBe(3);   // only a placeholder to the left
    expect(move(t, 2, 1, 'RIGHT')).toBe(1);  // row edge, no wrap to ally
  });
  it('a row of only placeholders is skipped over', () => {
    const it = [{ id: 'a' }, { id: 'b' }, { id: 'x', skip: true }, { id: 'y', skip: true }, { id: 'c' }, { id: 'd' }];
    expect(move(it, 2, 0, 'DOWN')).toBe(4);
    expect(move(it, 2, 5, 'UP')).toBe(1);
  });
});

describe('sync()', () => {
  it('goes INACTIVE with no controls and WAIT when only Cancel exists', () => {
    expect(sync(initialState(), emptyScreen).pane).toBe('INACTIVE');
    expect(sync(initialState(), waitScreen).pane).toBe('WAIT');
  });
  it('picks MOVE over SWITCH on a fresh move screen, cursor on first move', () => {
    const s = sync(initialState(), moveScreen());
    expect(s).toMatchObject({ pane: 'MOVE', index: 0, focusId: 'move:Thunderbolt' });
  });
  it('picks TARGET / TEAM when they are the only panes', () => {
    expect(sync(initialState(), targetScreen).pane).toBe('TARGET');
    expect(sync(initialState(), teamScreen()).pane).toBe('TEAM');
  });
  it('preserves the cursor by identity across a same-screen re-render that reorders items', () => {
    let s = run(sync(initialState(), moveScreen()), moveScreen(), 'RIGHT', 'RIGHT').state; // Protect
    const reordered = moveScreen();
    reordered.panes.MOVE.items = [{ id: 'move:Protect' }, { id: 'move:Thunderbolt' }, { id: 'move:Surf' }, { id: 'move:Fake Out' }];
    s = sync(s, reordered);
    expect(s).toMatchObject({ pane: 'MOVE', index: 0, focusId: 'move:Protect' });
  });
  it('falls back to a clamped index when the focused item vanished', () => {
    let s = run(sync(initialState(), moveScreen()), moveScreen(), 'RIGHT', 'RIGHT', 'RIGHT').state; // idx 3
    const shorter = moveScreen();
    shorter.panes.MOVE.items = [{ id: 'move:Struggle' }];
    s = sync(s, shorter);
    expect(s).toMatchObject({ index: 0, focusId: 'move:Struggle' });
  });
  it('keeps the SWITCH pane across a same-key re-render but resets to MOVE on a new turn', () => {
    let s = run(sync(initialState(), moveScreen('t1')), moveScreen('t1'), 'SWITCH_MENU').state;
    expect(s.pane).toBe('SWITCH');
    s = sync(s, moveScreen('t1'));
    expect(s.pane).toBe('SWITCH');
    s = sync(s, moveScreen('t2'));
    expect(s.pane).toBe('MOVE');
  });
  it('remembers the last move across turns (identity), like the mainline games', () => {
    let s = run(sync(initialState(), moveScreen('t1')), moveScreen('t1'), 'RIGHT').state; // Surf
    s = sync(s, waitScreen);
    s = sync(s, moveScreen('t2'));
    expect(s).toMatchObject({ pane: 'MOVE', focusId: 'move:Surf', index: 1 });
  });
  it('on a NEW screen, steps off an item that just became disabled (team preview slot 2)', () => {
    let s = sync(initialState(), teamScreen(0));           // cursor on slot 0
    s = sync(s, teamScreen(1));                            // slot 0 now chosen/disabled
    expect(s.index).toBe(1);
    expect(s.focusId).toBe('TEAM:1');
  });
  it('on the SAME screen, may stay on a disabled item (0-PP move mid-turn re-render)', () => {
    const scr = moveScreen('t1');
    let s = sync(initialState(), scr);
    const again = moveScreen('t1');
    again.panes.MOVE.items[0] = { id: 'move:Thunderbolt', disabled: true };
    s = sync(s, again);
    expect(s).toMatchObject({ index: 0, focusId: 'move:Thunderbolt' });
  });
});

describe('reduce()', () => {
  it('CONFIRM on a move activates it with identity', () => {
    const { last } = run(initialState(), moveScreen(), 'RIGHT', 'CONFIRM');
    expect(last).toEqual({ type: 'activate', pane: 'MOVE', index: 1, id: 'move:Surf' });
  });
  it('CONFIRM on a disabled or skip item does nothing', () => {
    let r = run(initialState(), moveScreen(), 'SWITCH_MENU', 'LEFT', 'LEFT', 'CONFIRM'); // idx 0 = active mon, disabled
    expect(r.state.index).toBe(0);
    expect(r.last).toBe(null);
    r = run(initialState(), teamScreen(1), 'LEFT', 'CONFIRM'); // cursor may LAND on the chosen (disabled) slot…
    expect(r.state.index).toBe(0);
    expect(r.last).toBe(null);                                  // …but A does nothing there
  });
  it('CONFIRM does nothing while WAITing or INACTIVE', () => {
    expect(run(initialState(), waitScreen, 'CONFIRM').last).toBe(null);
    expect(run(initialState(), emptyScreen, 'CONFIRM').last).toBe(null);
  });
  it('X moves to the switch pane (selectSwitch for mobile layout); B returns to moves and restores the cursor', () => {
    const scr = moveScreen();
    let r = run(initialState(), scr, 'RIGHT', 'RIGHT', 'SWITCH_MENU');
    expect(r.state.pane).toBe('SWITCH');
    expect(r.last).toEqual({ type: 'selectSwitch' });
    expect(r.state.index).toBe(2); // first enabled party slot (0/1 are active)
    r = run(r.state, scr, 'RIGHT', 'BACK');
    expect(r.state).toMatchObject({ pane: 'MOVE', index: 2, focusId: 'move:Protect' });
    expect(r.last).toEqual({ type: 'selectMove' });
    r = run(r.state, scr, 'SWITCH_MENU');
    expect(r.state).toMatchObject({ pane: 'SWITCH', index: 3 }); // remembered
  });
  it('X is a no-op when there is no switch pane; on it already it stays', () => {
    expect(run(initialState(), targetScreen, 'SWITCH_MENU').last).toBe(null);
    const r = run(initialState(), moveScreen(), 'SWITCH_MENU', 'SWITCH_MENU');
    expect(r.state.pane).toBe('SWITCH');
    expect(r.actions[1]).toBe(null);
  });
  it('B from target select / slot 2 emits back (clearChoice)', () => {
    expect(run(initialState(), targetScreen, 'BACK').last).toEqual({ type: 'back' });
    expect(run(initialState(), moveScreen('slot2', { back: true }), 'BACK').last).toEqual({ type: 'back' });
  });
  it('B while waiting emits cancel (undoChoice); B with nothing to go back to is a no-op', () => {
    expect(run(initialState(), waitScreen, 'BACK').last).toEqual({ type: 'cancel' });
    expect(run(initialState(), moveScreen(), 'BACK').last).toBe(null);
    expect(run(initialState(), teamScreen(0), 'BACK').last).toBe(null);
  });
  it('B from switch pane on slot 2 goes to moves first, then a second B goes back a slot', () => {
    const scr = moveScreen('slot2', { back: true });
    let r = run(initialState(), scr, 'SWITCH_MENU', 'BACK');
    expect(r.state.pane).toBe('MOVE');
    expect(r.last).toEqual({ type: 'selectMove' });
    r = run(r.state, scr, 'BACK');
    expect(r.last).toEqual({ type: 'back' });
  });
  it('Y toggles the gimmick without moving the cursor', () => {
    const r = run(initialState(), moveScreen(), 'RIGHT', 'GIMMICK');
    expect(r.last).toEqual({ type: 'gimmick' });
    expect(r.state.index).toBe(1);
    expect(run(initialState(), targetScreen, 'GIMMICK').last).toBe(null);
  });
  it('directions clamp within a pane and never activate anything', () => {
    const r = run(initialState(), moveScreen(), 'LEFT', 'UP', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(r.actions.every(a => a === null)).toBe(true);
    expect(r.state).toMatchObject({ pane: 'MOVE', index: 3 });
    const t = run(initialState(), targetScreen, 'UP', 'LEFT', 'DOWN', 'DOWN', 'DOWN');
    expect(t.actions.every(a => a === null)).toBe(true);
  });
  it('↓ off the move row enters the party list, ↑ off the party row returns (desktop stacked layout)', () => {
    const scr = moveScreen();
    let r = run(initialState(), scr, 'RIGHT', 'DOWN');
    expect(r.state).toMatchObject({ pane: 'SWITCH', index: 2 });      // first switchable mon
    expect(r.last).toEqual({ type: 'selectSwitch' });
    r = run(r.state, scr, 'DOWN');
    expect(r.state.pane).toBe('SWITCH');                               // bottom: no-op
    r = run(r.state, scr, 'RIGHT', 'UP');
    expect(r.state).toMatchObject({ pane: 'MOVE', index: 1 });         // back on Surf
    expect(r.last).toEqual({ type: 'selectMove' });
    r = run(r.state, scr, 'UP');
    expect(r.state).toMatchObject({ pane: 'MOVE', index: 1 });         // top: no-op
    expect(run(initialState(), teamScreen(0), 'DOWN').state.pane).toBe('TEAM'); // no party pane → no-op
  });
  it('POPUP outranks every battle pane; B closes it', () => {
    const scr = { key: 'p', panes: { POPUP: { items: items(3, 'P'), columns: 3 }, MOVE: moveScreen().panes.MOVE }, controls: { closePopup: true } };
    const r = run(initialState(), scr, 'RIGHT', 'BACK');
    expect(r.state.pane).toBe('POPUP');
    expect(r.state.index).toBe(1);
    expect(r.last).toEqual({ type: 'closePopup' });
    expect(run(initialState(), scr, 'CONFIRM').last).toMatchObject({ type: 'activate', pane: 'POPUP', index: 0 });
  });
  it('MENU is a plain pane: navigate and confirm, B/X/Y do nothing', () => {
    const scr = { key: 'm', panes: { MENU: { items: items(5, 'M'), columns: 1 } }, controls: {} };
    const r = run(initialState(), scr, 'DOWN', 'DOWN', 'RIGHT', 'BACK', 'SWITCH_MENU', 'GIMMICK', 'CONFIRM');
    expect(r.state.index).toBe(2);
    expect(r.actions.slice(0, 6).every(a => a === null)).toBe(true);
    expect(r.last).toEqual({ type: 'activate', pane: 'MENU', index: 2, id: 'M2' });
  });
  it('wrap panes (main menu) wrap top↔bottom; battle panes still clamp', () => {
    const wrapScr = { key: 'm', panes: { MENU: { items: items(4, 'M'), columns: 1, wrap: true } }, controls: {} };
    let r = run(initialState(), wrapScr, 'UP');
    expect(r.state.index).toBe(3);
    r = run(r.state, wrapScr, 'DOWN');
    expect(r.state.index).toBe(0);
    expect(move(items(4), 1, 3, 'DOWN', true)).toBe(0);
    expect(move([{ id: 'a' }, { id: 'b', skip: true }, { id: 'c' }], 1, 2, 'DOWN', true)).toBe(0);
    expect(move([{ id: 'a' }, { id: 'b', skip: true }, { id: 'c' }], 1, 0, 'UP', true)).toBe(2);
    expect(run(initialState(), moveScreen(), 'UP').state.index).toBe(0); // clamp
  });
  it('tab intents always emit their action', () => {
    expect(run(initialState(), moveScreen(), 'CLOSE_TAB').last).toEqual({ type: 'closeTab' });
    expect(run(initialState(), emptyScreen, 'PREV_TAB').last).toEqual({ type: 'prevTab' });
    expect(run(initialState(), waitScreen, 'NEXT_TAB').last).toEqual({ type: 'nextTab' });
  });
  it('LB/RB skip turn / skip to end only when the playback buttons are on screen', () => {
    const playing = { key: 'p', panes: {}, controls: { skipTurn: true, goToEnd: true } };
    expect(run(initialState(), playing, 'SKIP_TURN').last).toEqual({ type: 'skipTurn' });
    expect(run(initialState(), playing, 'SKIP_TO_END').last).toEqual({ type: 'goToEnd' });
    expect(run(initialState(), moveScreen(), 'SKIP_TURN').last).toBe(null);
    expect(run(initialState(), moveScreen(), 'SKIP_TO_END').last).toBe(null);
    expect(run(initialState(), waitScreen, 'FORFEIT').last).toBe(null); // handled by main, never by the state machine
  });
  it('target grid: navigation from the first foe to the ally and back', () => {
    let r = run(initialState(), targetScreen, 'DOWN');
    expect(r.state.index).toBe(3);
    r = run(r.state, targetScreen, 'UP', 'RIGHT');
    expect(r.state.index).toBe(1);
    r = run(r.state, targetScreen, 'CONFIRM');
    expect(r.last).toEqual({ type: 'activate', pane: 'TARGET', index: 1, id: 'TARGET:chooseMoveTarget:1' });
  });
  it('unknown events are ignored', () => {
    expect(run(initialState(), moveScreen(), 'NOPE').last).toBe(null);
    expect(run(initialState(), moveScreen(), { type: 'CONFIRM' }).last).toMatchObject({ type: 'activate' });
  });
});
