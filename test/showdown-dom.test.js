// Adapter tests against real client markup captured by tools/recon.js from a
// local Showdown server (test/fixtures/*.html). jsdom has no layout, so
// visibility/geometry are injected: every element is "visible" and columns
// come from a rect stub keyed on the button's horizontal position class.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAdapter, CURSOR_CLASS, STYLE_ID } from '../src/showdown-dom.js';

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
    expect(a.setCursor('MOVE', 42)).toBe(false);
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
