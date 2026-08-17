import { describe, it, expect } from 'vitest';
import { createGamepadInput, readIntents, BUTTON } from '../src/gamepad.js';

function fakePad({ pressed = [], axes = [0, 0], mapping = 'standard', index = 0, id = 'Xbox 360 Controller (STANDARD GAMEPAD)' } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { index, id, mapping, buttons, axes, connected: true };
}

function harness(opts = {}) {
  const events = [];
  const status = [];
  let pads = [null];
  let t = 0;
  const input = createGamepadInput({
    getGamepads: () => pads,
    requestFrame: () => 1,
    cancelFrame: () => {},
    now: () => t,
    onEvent: e => events.push(e),
    onStatus: s => status.push(s),
    ...opts,
  });
  return {
    input, events, status,
    set(p) { pads = Array.isArray(p) ? p : [p]; },
    at(ms) { t = ms; input.poll(ms); },
    types: () => events.map(e => e.type + (e.repeat ? '*' : '')),
  };
}

describe('readIntents', () => {
  it('maps standard buttons to intents', () => {
    const s = readIntents(fakePad({ pressed: [BUTTON.A, BUTTON.UP, BUTTON.BACK] }));
    expect([...s].sort()).toEqual(['CONFIRM', 'TOGGLE_LAYER', 'UP']);
  });
  it('applies the stick deadzone', () => {
    expect([...readIntents(fakePad({ axes: [0.3, 0] }))]).toEqual([]);
    expect([...readIntents(fakePad({ axes: [0.6, 0] }))]).toEqual(['RIGHT']);
    expect([...readIntents(fakePad({ axes: [0, -0.9] }))]).toEqual(['UP']);
  });
  it('resolves diagonals to exactly one direction (dominant axis)', () => {
    expect([...readIntents(fakePad({ axes: [0.7, 0.9] }))]).toEqual(['DOWN']);
    expect([...readIntents(fakePad({ axes: [-0.9, 0.7] }))]).toEqual(['LEFT']);
    expect([...readIntents(fakePad({ axes: [0.8, -0.8] }))]).toEqual(['RIGHT']); // tie → x wins
  });
  it('binds shoulder buttons and Start; leaves triggers and sticks-click unbound', () => {
    expect([...readIntents(fakePad({ pressed: [BUTTON.LB, BUTTON.RB, BUTTON.START] }))].sort()).toEqual(['FORFEIT', 'SKIP_TO_END', 'SKIP_TURN']);
    expect([...readIntents(fakePad({ pressed: [BUTTON.LT, BUTTON.RT, BUTTON.L3, BUTTON.R3] }))]).toEqual([]);
  });
});

describe('createGamepadInput', () => {
  it('reports nothing while no pad is visible (pre-first-press)', () => {
    const h = harness();
    h.at(0); h.at(16);
    expect(h.events).toEqual([]);
    expect(h.status).toEqual([]);
  });

  it('emits connected on first sight and rising edges only', () => {
    const h = harness();
    h.set(fakePad({ pressed: [BUTTON.A] }));
    h.at(0);
    expect(h.status[0]).toMatchObject({ type: 'connected', padIndex: 0 });
    expect(h.types()).toEqual(['CONFIRM']);
    h.at(16); h.at(32);                    // still held → no more events
    expect(h.types()).toEqual(['CONFIRM']);
    h.set(fakePad()); h.at(48);            // released
    h.set(fakePad({ pressed: [BUTTON.A] })); h.at(64);
    expect(h.types()).toEqual(['CONFIRM', 'CONFIRM']);
  });

  it('confirm/back/menu never repeat while held', () => {
    const h = harness();
    h.set(fakePad({ pressed: [BUTTON.B, BUTTON.X, BUTTON.Y] }));
    for (let t = 0; t <= 2000; t += 16) h.at(t);
    expect(h.types().sort()).toEqual(['BACK', 'GIMMICK', 'SWITCH_MENU']);
  });

  it('directions repeat after 400 ms then every 120 ms', () => {
    const h = harness();
    h.set(fakePad({ pressed: [BUTTON.RIGHT] }));
    h.at(0);
    expect(h.types()).toEqual(['RIGHT']);
    h.at(399);
    expect(h.types()).toEqual(['RIGHT']);
    h.at(400);
    expect(h.types()).toEqual(['RIGHT', 'RIGHT*']);
    h.at(519);
    expect(h.types()).toEqual(['RIGHT', 'RIGHT*']);
    h.at(520);
    expect(h.types()).toEqual(['RIGHT', 'RIGHT*', 'RIGHT*']);
    h.at(640); h.at(760);
    expect(h.types().length).toBe(5);
  });

  it('release resets the repeat timer', () => {
    const h = harness();
    h.set(fakePad({ pressed: [BUTTON.DOWN] })); h.at(0); h.at(300);
    h.set(fakePad()); h.at(310);
    h.set(fakePad({ pressed: [BUTTON.DOWN] })); h.at(320);
    h.at(700); // 380 ms after re-press → no repeat yet
    expect(h.types()).toEqual(['DOWN', 'DOWN']);
    h.at(720);
    expect(h.types()).toEqual(['DOWN', 'DOWN', 'DOWN*']);
  });

  it('stick directions repeat like the d-pad', () => {
    const h = harness();
    h.set(fakePad({ axes: [0, 1] })); h.at(0); h.at(400);
    expect(h.types()).toEqual(['DOWN', 'DOWN*']);
  });

  it('refuses non-standard mappings and warns once', () => {
    const h = harness();
    h.set(fakePad({ mapping: '', pressed: [BUTTON.A] }));
    h.at(0); h.at(16);
    expect(h.events).toEqual([]);
    expect(h.status.filter(s => s.type === 'nonstandard').length).toBe(1);
  });

  it('skips null holes and picks the first standard pad', () => {
    const h = harness();
    h.set([null, fakePad({ mapping: '', index: 1 }), fakePad({ index: 2, pressed: [BUTTON.UP] })]);
    h.at(0);
    expect(h.types()).toEqual(['UP']);
    expect(h.status.find(s => s.type === 'connected').padIndex).toBe(2);
  });

  it('reports disconnect and drops held state', () => {
    const h = harness();
    h.set(fakePad({ pressed: [BUTTON.A] })); h.at(0);
    h.set([null]); h.at(16);
    expect(h.status.at(-1)).toMatchObject({ type: 'disconnected' });
    h.set(fakePad({ pressed: [BUTTON.A] })); h.at(32);
    expect(h.types()).toEqual(['CONFIRM', 'CONFIRM']); // re-plugged press counts as a new edge
  });

  it('start/stop drive the frame loop', () => {
    let cb = null;
    const h = harness({ requestFrame: f => { cb = f; return 7; }, cancelFrame: () => { cb = null; } });
    h.input.start();
    expect(h.input.isRunning()).toBe(true);
    expect(typeof cb).toBe('function');
    h.input.stop();
    expect(h.input.isRunning()).toBe(false);
    expect(cb).toBe(null);
  });
});
