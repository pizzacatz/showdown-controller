import { describe, it, expect, beforeEach } from 'vitest';
import { createSettings, loadBindings, saveBindings, rebind, intentToButton, STORAGE_KEY, PANEL_ID } from '../src/settings.js';
import { DEFAULT_BINDINGS, BUTTON } from '../src/gamepad.js';

const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

describe('bindings storage', () => {
  it('defaults when nothing stored or garbage stored', () => {
    expect(loadBindings(memStorage())).toEqual(DEFAULT_BINDINGS);
    const st = memStorage(); st.setItem(STORAGE_KEY, '{nope');
    expect(loadBindings(st)).toEqual(DEFAULT_BINDINGS);
    st.setItem(STORAGE_KEY, JSON.stringify({ 3: 'NOT_AN_INTENT' }));
    expect(loadBindings(st)).toEqual(DEFAULT_BINDINGS);
  });
  it('round-trips and drops unknown intents', () => {
    const st = memStorage();
    saveBindings(st, { 7: 'CONFIRM', 1: 'BACK', 2: 'BOGUS' });
    expect(loadBindings(st)).toEqual({ 7: 'CONFIRM', 1: 'BACK' });
  });
  it('rebind moves the intent and steals the button', () => {
    const b = rebind(DEFAULT_BINDINGS, 'GIMMICK', BUTTON.Y);   // Y was SKIP_TO_END, RB was GIMMICK
    expect(b[BUTTON.Y]).toBe('GIMMICK');
    expect(b[BUTTON.RB]).toBeUndefined();
    expect(intentToButton(b).SKIP_TO_END).toBeUndefined();     // now unbound
    expect(intentToButton(b).CONFIRM).toBe(BUTTON.A);
  });
});

describe('settings panel', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('opens from the pill, captures the next raw button, saves, and reports labels', () => {
    const st = memStorage();
    const changes = [];
    const s = createSettings({ doc: document, storage: st, onChange: b => changes.push(b) });
    expect(s.labelFor('FORFEIT')).toBe('Select');
    expect(s.labelFor('GIMMICK')).toBe('RB');
    s.open();
    const panel = document.getElementById(PANEL_ID);
    expect(panel).toBeTruthy();
    expect(panel.querySelectorAll('tr[data-intent]').length).toBe(15);
    panel.querySelector('button[data-rebind="GIMMICK"]').click();
    expect(s.isCapturing()).toBe(true);
    expect(s.onRawButton(BUTTON.LT)).toBe(true);
    expect(s.isCapturing()).toBe(false);
    expect(s.labelFor('GIMMICK')).toBe('LT');
    expect(loadBindings(st)[BUTTON.LT]).toBe('GIMMICK');
    expect(changes.length).toBe(1);
    expect(s.onRawButton(BUTTON.A)).toBe(false); // not capturing → not consumed
    panel.querySelector('button[data-reset]').click();
    expect(s.labelFor('GIMMICK')).toBe('RB');
    panel.querySelector('button[data-close]').click();
    expect(document.getElementById(PANEL_ID)).toBe(null);
    expect(s.isOpen()).toBe(false);
  });
});
