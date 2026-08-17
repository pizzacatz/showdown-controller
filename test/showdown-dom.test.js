// Adapter tests against real client markup captured by tools/recon.js from a
// local Showdown server (test/fixtures/*.html). jsdom has no layout, so
// visibility/geometry are injected: every element is "visible" and columns
// come from a rect stub keyed on the button's horizontal position class.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAdapter, CURSOR_CLASS, PANE_CLASS, HINT_CLASS, DISABLED_CLASS, HEADING_CLASS, STYLE_ID } from '../src/showdown-dom.js';

const fixture = name => readFileSync(path.join(process.cwd(), 'test', 'fixtures', `${name}.html`), 'utf8');

function mountRoom(name, { roomId = 'battle-gen9doublescustomgame-1' } = {}) {
  document.body.innerHTML = `<div class="ps-room" id="room-${roomId}">${fixture(name)}<div class="battle-log-add"><form class="chatbox"><textarea class="textbox"></textarea></form></div></div>`;
  return document.getElementById(`room-${roomId}`);
}

// Geometry stub: the classic desktop layout puts each menu on one row, and
// the target grid on two rows (foes, then allies). Emulate with data from
// the recon JSON: everything in the same .switchmenu/.movemenu shares a top.
function rectOf(el) {
  const menu = el.closest('.switchmenu, .movemenu');
  if (!menu) return { top: 0, left: 0, width: 0, height: 0 };
  const menus = [...document.querySelectorAll('.switchmenu, .movemenu')];
  return { top: 100 + menus.indexOf(menu) * 40, left: 0, width: 100, height: 30 };
}
const adapter = () => createAdapter({ doc: document, win: window, isVisible: () => true, rectOf });

describe('readScreen', () => {
  beforeEach(() => { document.body.innerHTML = ''; delete window.app; });

  it('returns an empty screen with no battle room', () => {
    document.body.innerHTML = '<div class="ps-room" id="room-lobby"></div>';
    const s = adapter().readScreen();
    expect(s.panes).toEqual({});
    expect(s.key).toBe(null);
  });

  it('reads team preview: 6 items, one row, ids by name', () => {
    mountRoom('01-teampreview');
    const s = adapter().readScreen();
    expect(Object.keys(s.panes)).toEqual(['TEAM']);
    expect(s.panes.TEAM.items.map(i => i.id)).toEqual(['TEAM:Pikachu', 'TEAM:Charizard', 'TEAM:Blastoise', 'TEAM:Venusaur', 'TEAM:Snorlax', 'TEAM:Gengar']);
    expect(s.panes.TEAM.columns).toBe(6);
    expect(s.controls).toMatchObject({ back: false, cancel: false, gimmick: false, selectSwitch: true });
  });

  it('team preview slot 2: chosen lead is disabled, Back is present', () => {
    mountRoom('02-teampreview-cursor');
    const s = adapter().readScreen();
    expect(s.panes.TEAM.items[0]).toMatchObject({ disabled: false });
    // 02 was captured before CONFIRM; use the fixture with the Back button instead:
    mountRoom('12-script-slot2');
    expect(adapter().readScreen().controls.back).toBe(true);
  });

  it('reads move select: MOVE (4, one row) + SWITCH (6) with active mons disabled, gimmick present', () => {
    mountRoom('03-move-select');
    const s = adapter().readScreen();
    expect(Object.keys(s.panes).sort()).toEqual(['MOVE', 'SWITCH']);
    expect(s.panes.MOVE.items.map(i => i.id)).toEqual(['move:Flamethrower', 'move:Heat Wave', 'move:Protect', 'move:Air Slash']);
    expect(s.panes.MOVE.items.every(i => !i.disabled && !i.skip)).toBe(true);
    expect(s.panes.MOVE.columns).toBe(4);
    expect(s.panes.SWITCH.items.map(i => i.disabled)).toEqual([true, true, false, false, false, false]);
    expect(s.panes.SWITCH.items[2].id).toBe('SWITCH:Blastoise');
    expect(s.controls).toMatchObject({ back: false, cancel: false, gimmick: true, selectSwitch: true, selectMove: true });
  });

  it('reads target select as a 2-row grid including the hidden self placeholder', () => {
    mountRoom('04-target-select');
    const s = adapter().readScreen();
    expect(Object.keys(s.panes)).toEqual(['TARGET']);
    const t = s.panes.TARGET;
    expect(t.columns).toBe(2);
    expect(t.items.map(i => i.id)).toEqual(['TARGET:chooseMoveTarget:2', 'TARGET:chooseMoveTarget:1', 'TARGET:x:2', 'TARGET:chooseMoveTarget:-2']);
    expect(t.items.map(i => !!i.skip)).toEqual([false, false, true, false]);
    expect(s.controls.back).toBe(true);
  });

  it('reads the waiting state: no panes, Cancel present', () => {
    mountRoom('07-waiting');
    const s = adapter().readScreen();
    expect(s.panes).toEqual({});
    expect(s.controls.cancel).toBe(true);
  });

  it('screen key ignores the timer button but changes between sub-screens', () => {
    mountRoom('03-move-select');
    const a = adapter();
    const k1 = a.readScreen().key;
    document.querySelector('.timerbutton').textContent = 'Timer 1:30';
    expect(a.readScreen().key).toBe(k1);
    mountRoom('12-script-slot2');
    expect(adapter().readScreen().key).not.toBe(k1);
  });

  it('prefers app.curRoom when the client exposes it', () => {
    mountRoom('03-move-select', { roomId: 'battle-x-1' });
    const other = document.createElement('div');
    other.className = 'ps-room'; other.id = 'room-battle-x-2';
    other.innerHTML = fixture('07-waiting');
    document.body.appendChild(other);
    window.app = { curRoom: { $el: [other] }, rooms: {} };
    expect(adapter().readScreen().panes).toEqual({});
    delete window.app;
    expect(Object.keys(adapter().readScreen().panes).sort()).toEqual(['MOVE', 'SWITCH']);
  });
});

describe('acting', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('activate clicks the real button and verifies identity', () => {
    mountRoom('03-move-select');
    const a = adapter();
    const clicked = [];
    document.querySelector('.battle-controls').addEventListener('click', e => clicked.push(`${e.target.name}=${e.target.value}`));
    expect(a.activate('MOVE', 1, 'move:Heat Wave')).toBe(true);
    expect(a.activate('MOVE', 1, 'move:Flamethrower')).toBe(false); // stale identity → refuse
    expect(a.activate('SWITCH', 0)).toBe(false);                    // disabled (active mon)
    expect(a.activate('SWITCH', 2)).toBe(true);
    expect(a.activate('MOVE', 9)).toBe(false);
    expect(clicked).toEqual(['chooseMove=2', 'chooseSwitch=2']);
  });

  it('never activates a disabled move button', () => {
    mountRoom('03-move-select');
    const btn = document.querySelector('button[name="chooseMove"][value="1"]');
    btn.disabled = true; btn.removeAttribute('name'); // how the client renders disabled moves
    const a = adapter();
    const s = a.readScreen();
    expect(s.panes.MOVE.items[0]).toMatchObject({ id: 'move:Flamethrower', disabled: true });
    expect(a.activate('MOVE', 0)).toBe(false);
  });

  it('back / cancel / selectSwitch / selectMove click the named controls', () => {
    const clicked = [];
    const listen = e => clicked.push(e.target.name);
    document.body.addEventListener('click', listen);
    mountRoom('04-target-select');
    const a = adapter();
    expect(a.back()).toBe(true);
    expect(a.cancel()).toBe(false);
    mountRoom('07-waiting');
    expect(a.cancel()).toBe(true);
    mountRoom('03-move-select');
    expect(a.selectSwitch()).toBe(true);
    expect(a.selectMove()).toBe(true);
    expect(clicked).toEqual(['clearChoice', 'undoChoice', 'selectSwitch', 'selectMove']);
    document.body.removeEventListener('click', listen);
  });

  it('skipTurn / goToEnd: detected only when present and enabled; clicked by name', () => {
    // Playback-lag markup from client-battle.js updateControls()
    document.body.innerHTML = `<div class="ps-room" id="room-battle-x-9"><div class="battle-controls"><p><button class="button" name="skipTurn"><i class="fa fa-step-forward"></i><br>Skip turn</button> <button class="button" name="goToEnd"><i class="fa fa-fast-forward"></i><br>Skip to end</button></p></div></div>`;
    const a = adapter();
    expect(a.readScreen().controls).toMatchObject({ skipTurn: true, goToEnd: true, cancel: false });
    const clicked = [];
    document.body.addEventListener('click', e => clicked.push(e.target.name));
    expect(a.skipTurn()).toBe(true);
    expect(a.goToEnd()).toBe(true);
    expect(clicked).toEqual(['skipTurn', 'goToEnd']);
    // Battle-end variant renders them disabled and unnamed
    document.body.innerHTML = `<div class="ps-room" id="room-battle-x-9"><div class="battle-controls"><p><button class="button disabled" disabled>Skip turn</button><button class="button disabled" disabled>Skip to end</button></p></div></div>`;
    expect(a.readScreen().controls).toMatchObject({ skipTurn: false, goToEnd: false });
    expect(a.skipTurn()).toBe(false);
    mountRoom('03-move-select');
    expect(a.readScreen().controls).toMatchObject({ skipTurn: false, goToEnd: false });
  });

  it('playback buttons form a PLAYBACK pane the cursor can select', () => {
    document.body.innerHTML = `<div class="ps-room" id="room-battle-x-9"><div class="battle-controls"><p><button class="button" name="skipTurn">Skip turn</button> <button class="button" name="goToEnd">Skip to end</button></p></div></div>`;
    const a = adapter();
    const s = a.readScreen();
    expect(Object.keys(s.panes)).toEqual(['PLAYBACK']);
    expect(s.panes.PLAYBACK.items.map(i => i.id)).toEqual(['PLAYBACK:skipTurn', 'PLAYBACK:goToEnd']);
    const clicked = [];
    document.body.addEventListener('click', e => clicked.push(e.target.name), { once: true });
    expect(a.activate('PLAYBACK', 1, 'PLAYBACK:goToEnd')).toBe(true);
    expect(clicked).toEqual(['goToEnd']);
    // Post-battle: pause/first/prev/skip/end are all in the pane; replay/main-menu buttons are not.
    document.body.innerHTML = `<div class="ps-room" id="room-battle-x-9"><div class="battle-controls"><div class="controls"><p><button name="pause">Pause</button><button name="instantReplay">First</button><button name="rewindTurn">Prev</button><button name="skipTurn">Skip</button><button name="goToEnd">End</button></p><p><button name="saveReplay">Upload</button><button name="closeAndMainMenu">Main menu</button></p></div></div></div>`;
    expect(a.readScreen().panes.PLAYBACK.items.map(i => i.id)).toEqual(['PLAYBACK:pause', 'PLAYBACK:instantReplay', 'PLAYBACK:rewindTurn', 'PLAYBACK:skipTurn', 'PLAYBACK:goToEnd']);
  });

  it('forfeit sends /forfeit to the current room through the client API', () => {
    mountRoom('03-move-select', { roomId: 'battle-gen9vgc-77' });
    const sent = [];
    window.app = { rooms: { 'battle-gen9vgc-77': { send: c => sent.push(['room', c]) } }, send: (c, r) => sent.push(['app', c, r]) };
    const a = adapter();
    expect(a.forfeit()).toBe(true);
    expect(sent).toEqual([['room', '/forfeit']]);
    window.app = { rooms: {}, send: (c, r) => sent.push(['app', c, r]) };
    expect(a.forfeit()).toBe(true);
    expect(sent[1]).toEqual(['app', '/forfeit', 'battle-gen9vgc-77']);
    delete window.app;
    expect(a.forfeit()).toBe(false);
    document.body.innerHTML = '';
    expect(a.forfeit()).toBe(false);
  });

  it('gimmick toggles the tera checkbox via a click', () => {
    mountRoom('03-move-select');
    const a = adapter();
    const box = document.querySelector('input[name="terastallize"]');
    expect(box.checked).toBe(false);
    expect(a.gimmick()).toBe(true);
    expect(box.checked).toBe(true);
    a.gimmick();
    expect(box.checked).toBe(false);
  });

  it('typing guard: only a text field WITH content counts as typing', () => {
    mountRoom('03-move-select');
    const a = adapter();
    const ta = document.querySelector('textarea');
    ta.focus();
    expect(a.isTyping()).toBe(false);          // empty chat box (client auto-focuses it)
    ta.value = 'gg';
    expect(a.isTyping()).toBe(true);
    expect(a.activate('MOVE', 0)).toBe(false);
    expect(a.back()).toBe(false);
    expect(a.gimmick()).toBe(false);
    ta.value = '';
    expect(a.activate('MOVE', 0)).toBe(true);
    ta.blur();
    document.querySelector('input[name="terastallize"]').focus(); // checkbox focus is not typing
    expect(a.isTyping()).toBe(false);
  });
});

describe('cursor highlight', () => {
  beforeEach(() => { document.body.innerHTML = ''; document.getElementById(STYLE_ID)?.remove(); });

  it('paints exactly one element, injects the style once, and clears', () => {
    mountRoom('03-move-select');
    const a = adapter();
    expect(a.setCursor('MOVE', 2)).toBe(true);
    expect(document.querySelectorAll('.' + CURSOR_CLASS).length).toBe(1);
    expect(document.querySelector('.' + CURSOR_CLASS).dataset.move).toBe('Protect');
    a.setCursor('SWITCH', 3);
    expect(document.querySelectorAll('.' + CURSOR_CLASS).length).toBe(1);
    expect(document.querySelectorAll('#' + STYLE_ID).length).toBe(1);
    a.clearCursor();
    expect(document.querySelectorAll('.' + CURSOR_CLASS).length).toBe(0);
    expect(document.querySelectorAll('.' + PANE_CLASS).length).toBe(0);
    expect(a.setCursor('MOVE', 42)).toBe(false);
  });

  it('dims every non-selectable button and tints the active heading', () => {
    mountRoom('03-move-select');
    const a = adapter();
    a.setCursor('MOVE', 0);
    const dimmed = [...document.querySelectorAll('.' + DISABLED_CLASS)].map(el => el.getAttribute('value'));
    expect(dimmed).toEqual(['Charizard,active', 'Pikachu,active']);   // party slots in battle
    expect(document.querySelector('.moveselect button').classList.contains(HEADING_CLASS)).toBe(true);
    expect(document.querySelector('.switchselect button').classList.contains(HEADING_CLASS)).toBe(false);
    a.setCursor('SWITCH', 2);
    expect(document.querySelector('.moveselect button').classList.contains(HEADING_CLASS)).toBe(false);
    expect(document.querySelector('.switchselect button').classList.contains(HEADING_CLASS)).toBe(true);
    expect(document.querySelectorAll('.' + DISABLED_CLASS).length).toBe(2);
    a.clearCursor();
    expect(document.querySelectorAll('.' + DISABLED_CLASS + ', .' + HEADING_CLASS).length).toBe(0);
    mountRoom('04-target-select');
    a.setCursor('TARGET', 0);
    expect(document.querySelectorAll('.' + DISABLED_CLASS).length).toBe(0); // hidden placeholder is skip, not dimmed
  });

  it('draws one overlay box around the pane the cursor is in (union of both target rows)', () => {
    mountRoom('03-move-select');
    const a = adapter();
    a.setCursor('MOVE', 0);
    let boxes = [...document.querySelectorAll('.' + PANE_CLASS)];
    expect(boxes.length).toBe(1);
    expect(boxes[0].parentElement.classList.contains('battle-controls')).toBe(true);
    expect(boxes[0].style.top).toBe('96px');      // rect stub: movemenu row at 100 − 4px pad
    a.setCursor('SWITCH', 2);
    boxes = [...document.querySelectorAll('.' + PANE_CLASS)];
    expect(boxes.length).toBe(1);                 // old box removed
    expect(boxes[0].style.top).toBe('136px');     // second menu row
    mountRoom('04-target-select');
    a.setCursor('TARGET', 0);
    boxes = [...document.querySelectorAll('.' + PANE_CLASS)];
    expect(boxes.length).toBe(1);
    expect(boxes[0].style.height).toBe('78px');   // spans rows at 100 and 140 (+30 tall, +4 pad each side)
  });

  it('paints button hints idempotently and removes them on clear', () => {
    mountRoom('03-move-select');
    const a = adapter();
    a.paintHints({ gimmick: 'RB', skipTurn: 'LB', goToEnd: 'Y' });
    const hints = [...document.querySelectorAll('.' + HINT_CLASS)];
    expect(hints.length).toBe(1);
    expect(hints[0].textContent).toBe('(RB)');
    expect(hints[0].closest('label.megaevo')).toBeTruthy();
    a.paintHints({ gimmick: 'RB' });
    expect(document.querySelectorAll('.' + HINT_CLASS).length).toBe(1); // no duplicates
    a.paintHints({ gimmick: 'LT' });
    expect(document.querySelector('.' + HINT_CLASS).textContent).toBe('(LT)');
    // Hints don't leak into item identity
    expect(a.readScreen().panes.MOVE.items[0].id).toBe('move:Flamethrower');
    document.body.innerHTML = `<div class="ps-room" id="room-battle-x-9"><div class="battle-controls"><p><button name="skipTurn">Skip turn</button> <button name="goToEnd">Skip to end</button></p></div></div>`;
    a.paintHints({ skipTurn: 'LB', goToEnd: 'Y' });
    expect([...document.querySelectorAll('.' + HINT_CLASS)].map(h => h.textContent)).toEqual(['(LB)', '(Y)']);
    expect(a.readScreen().panes.PLAYBACK.items.map(i => i.id)).toEqual(['PLAYBACK:skipTurn', 'PLAYBACK:goToEnd']);
    a.clearHints();
    expect(document.querySelectorAll('.' + HINT_CLASS).length).toBe(0);
  });

  it('always-on forfeit hint: floats in the controls, or attaches to QoL Battle Tools\' Forfeit button', () => {
    mountRoom('03-move-select');
    const a = adapter();
    a.paintHints({ gimmick: 'RB', forfeit: 'Select' });
    let f = document.querySelector('.sgp-hint-forfeit');
    expect(f.textContent).toBe('(Select)');
    expect(f.parentElement.classList.contains('battle-controls')).toBe(true);
    a.paintHints({ gimmick: 'RB', forfeit: 'Select' });
    expect(document.querySelectorAll('.sgp-hint-forfeit').length).toBe(1);
    // QoL toolbar appears (as the sibling script renders it, inside .battle-controls)
    const bar = document.createElement('div'); bar.className = 'qol-battle-toolbar';
    bar.innerHTML = '<button data-qol="forfeit">Forfeit</button>';
    document.querySelector('.battle-controls').appendChild(bar);
    a.paintHints({ gimmick: 'RB', forfeit: 'Select' });
    expect(document.querySelectorAll('.sgp-hint-forfeit').length).toBe(0);
    f = document.querySelector('button[data-qol="forfeit"] .' + HINT_CLASS);
    expect(f.textContent).toBe('(Select)');
    // QoL re-labels its button (textContent wipes children) → next paint restores the tag
    document.querySelector('button[data-qol="forfeit"]').textContent = 'Confirm forfeit?';
    a.paintHints({ gimmick: 'RB', forfeit: 'Select' });
    expect(document.querySelectorAll('button[data-qol="forfeit"] .' + HINT_CLASS).length).toBe(1);
    expect(document.querySelectorAll('.' + HINT_CLASS).length).toBe(2);
  });
});

describe('onControlsChanged', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fires (debounced) on controls re-render, not on chat log growth or on our own cursor class', async () => {
    mountRoom('03-move-select');
    const a = adapter();
    let fires = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = cb => setTimeout(cb, 0);
    const off = a.onControlsChanged(() => fires++);
    const tick = () => new Promise(r => setTimeout(r, 5));

    document.querySelector('.battle-log-add').appendChild(document.createElement('div'));
    await tick();
    expect(fires).toBe(0);

    a.setCursor('MOVE', 1); a.setCursor('MOVE', 2);
    a.paintHints({ gimmick: 'RB' }); a.paintHints({ gimmick: 'LT' }); a.clearHints();
    await tick();
    expect(fires).toBe(0);

    const controls = document.querySelector('.battle-controls');
    controls.innerHTML = fixture('07-waiting').replace(/^.*?<div class="controls">/s, '<div class="controls">').replace(/<\/div>\s*$/, '');
    controls.appendChild(document.createElement('p'));
    await tick();
    expect(fires).toBe(1); // several mutations → one debounced callback

    off();
    controls.appendChild(document.createElement('p'));
    await tick();
    expect(fires).toBe(1);
    window.requestAnimationFrame = raf;
  });
});
