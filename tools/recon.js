#!/usr/bin/env node
// DOM recon + end-to-end check against a LOCAL Pokémon Showdown server
// (never the public one).
//
// Drives two headless Chrome pages through a Doubles Custom Game battle and
// dumps `.battle-controls` at every interesting stage (team preview, move
// select, target select, switch, waiting, ...) into tools/out/. Also records
// button geometry so we can verify the row/column layout the adapter derives
// from getBoundingClientRect().
//
// Usage:
//   node tools/recon.js [--url http://localhost:8081/] [--chrome /usr/bin/google-chrome]
//                       [--script dist/showdown-gamepad.user.js] [--headful]
//
// With --script, the built userscript is injected into player A's page before
// the client loads, and the recon drives it via the exposed test hook
// (window.__showdownGamepad) — the end-to-end check that the whole layer
// works against the real client.
//
// Local server setup this was written against: Showdown-Offline
// (pokemon-showdown with noguestsecurity + noipchecks, classic client served
// on :8081 with /showdown proxied to the sim server on :8000).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) =>
    a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []
  ).filter(x => x.length)
);
const URL = args.url || 'http://localhost:8081/';
const CHROME = args.chrome || '/usr/bin/google-chrome';
const HEADFUL = !!args.headful;
const SCRIPT = args.script ? fs.readFileSync(args.script, 'utf8') : null;
const OUT = path.resolve('tools/out');
fs.mkdirSync(OUT, { recursive: true });

const FORMAT = 'gen9doublescustomgame';
// Fresh names each run so we don't auto-rejoin battles from earlier runs.
const RUN = (Date.now() % 100000).toString(36);
const NAMES = [`ReconA${RUN}`, `ReconB${RUN}`];
// Packed team: name|species|item|ability|moves|nature|evs|gender|ivs|shiny|level|happiness,ball,hidden,gigantamax,dynamaxlvl,tera
const TEAM = [
  'Pikachu||lightball|static|thunderbolt,surf,protect,fakeout||||||50|,,,,,Electric',
  'Charizard||charcoal|blaze|flamethrower,heatwave,protect,airslash||||||50|,,,,,Fire',
  'Blastoise||leftovers|torrent|surf,icebeam,protect,fakeout||||||50|,,,,,Water',
  'Venusaur||sitrusberry|overgrow|energyball,sludgebomb,protect,sleeppowder||||||50|,,,,,Grass',
  'Snorlax||chestoberry|thickfat|bodyslam,rest,protect,earthquake||||||50|,,,,,Normal',
  'Gengar||focussash|cursedbody|shadowball,sludgebomb,protect,willowisp||||||50|,,,,,Ghost',
].join(']');

const log = (...a) => console.log('[recon]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => { log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

// Runs in the page: newest battle room element (older recon battles may still exist).
const ROOM = `(() => { const ids = Object.keys(app.rooms).filter(k => k.startsWith('battle-')); return ids.length ? document.getElementById('room-' + ids[ids.length - 1]) : null; })()`;

async function waitFor(page, fn, { timeout = 20000, poll = 100, desc = 'condition', args = [] } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, ...args)) return true; // fn must return a serializable truthy value
    await sleep(poll);
  }
  throw new Error(`timeout waiting for ${desc}`);
}

const inRoom = (page, fn, ...extra) => page.evaluate((src, f, ...rest) => {
  const room = eval(src);
  return room ? (0, eval)(`(${f})`)(room, ...rest) : null;
}, ROOM, fn.toString(), ...extra);

async function snapshot(page, name) {
  const data = await inRoom(page, room => {
    const controls = room.querySelector('.battle-controls');
    if (!controls) return null;
    const buttons = [...controls.querySelectorAll('button, input, label')].map(el => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName, name: el.getAttribute('name'), value: el.getAttribute('value'),
        cls: el.className, disabled: el.disabled, dataMove: el.dataset.move, dataTarget: el.dataset.target,
        text: (el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.textContent : el.textContent).trim().slice(0, 40),
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        visible: !!(el.offsetParent) && r.width > 0,
        cursor: el.classList.contains('sgp-cursor'),
      };
    });
    return { roomId: room.id, html: controls.outerHTML, buttons };
  });
  if (!data) { log(`snapshot ${name}: no battle-controls`); return null; }
  fs.writeFileSync(path.join(OUT, `${name}.html`), data.html);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data.buttons, null, 1));
  const summary = data.buttons.filter(b => b.visible && b.tag !== 'LABEL').map(b => `${b.cursor ? '▶' : ''}${b.tag.toLowerCase()}[${b.name || ''}${b.value != null ? '=' + b.value : ''}]${b.disabled ? '(dis)' : ''}@${b.x},${b.y}`);
  log(`snapshot ${name}: ${summary.length} controls — ${summary.join(' ')}`);
  return data;
}

const clickIn = (page, selector) => inRoom(page, (room, sel) => { const el = room.querySelector(sel); if (!el) return false; el.click(); return true; }, selector);
const hasIn = (page, selector) => inRoom(page, (room, sel) => !!room.querySelector(sel), selector);
const waitIn = (page, selector, desc, timeout = 30000) => waitFor(page, (src, sel) => { const r = eval(src); return !!(r && r.querySelector(sel)); }, { desc, timeout, args: [ROOM, selector] });

async function setup(browser, name, injectScript) {
  const page = await browser.newPage();
  page.on('console', m => { const t = m.text(); if (/showdown-gamepad/i.test(t) || /^<< \|popup\||^<< \|error\|/.test(t)) log(`[${name} console]`, t.slice(0, 300)); });
  page.on('pageerror', e => { if (!/play\(\) request/.test(e.message)) log(`[${name} pageerror]`, e.message); });
  await page.setViewport({ width: 1280, height: 800 });
  if (injectScript) await page.evaluateOnNewDocument(injectScript);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => !!(window.app && app.socket && app.socket.readyState === 1 && app.user), { desc: 'app socket', timeout: 30000 });
  await page.evaluate(n => app.send('/trn ' + n), name);
  await waitFor(page, n => !!(app.user.get('name') === n && app.user.get('named')), { desc: `named ${name}`, args: [name] });
  await page.evaluate(t => app.send('/utm ' + t), TEAM);
  log(`${name} logged in`);
  return page;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const A = await setup(browser, NAMES[0], SCRIPT);
    const B = await setup(browser, NAMES[1], null);

    if (SCRIPT) {
      const drive0 = async (...intents) => {
        let d;
        for (const it of intents) { d = await A.evaluate(i => window.__showdownGamepad.inject(i), it); await sleep(120); }
        return d || A.evaluate(() => window.__showdownGamepad.debug());
      };
      await A.evaluate(() => { app.focusRoom(''); window.__showdownGamepad.enable(true); });
      await sleep(300);
      let d = await drive0();
      check(d.pane === 'MENU' && d.panes.MENU?.n >= 3, `main menu is a MENU pane (${d.pane}, ${JSON.stringify(d.panes)})`);
      log('MENU items:', JSON.stringify(d.ids));
      check(!d.ids.some(id => /joinRoom/.test(id)) && d.ids.some(id => /^MENU:search:/.test(id)), 'MENU pane is only the battle group (no Teambuilder/Ladder/...)');
      const n0 = d.ids.length;
      d = await drive0('UP');
      check(d.index === n0 - 1, `UP from the top wraps to the bottom (${d.index}/${n0 - 1})`);
      d = await drive0('DOWN');
      check(d.index === 0, `DOWN from the bottom wraps to the top (${d.index})`);
      // Tabs: open the teambuilder, close it with the close-tab intent, switch tabs
      await A.evaluate(() => app.joinRoom('teambuilder')); await sleep(400);
      let cur = await A.evaluate(() => app.curRoom.id);
      check(cur === 'teambuilder', `teambuilder tab opened and focused (${cur})`);
      await drive0('PREV_TAB'); await sleep(200);
      cur = await A.evaluate(() => app.curRoom.id);
      check(cur === '', `PREV_TAB goes back to the main menu (${JSON.stringify(cur)})`);
      await drive0('NEXT_TAB'); await sleep(200);
      cur = await A.evaluate(() => app.curRoom.id);
      check(cur === 'teambuilder', `NEXT_TAB returns to the teambuilder (${cur})`);
      await drive0('CLOSE_TAB'); await sleep(400);
      const rooms = await A.evaluate(() => Object.keys(app.rooms));
      cur = await A.evaluate(() => app.curRoom.id);
      check(!rooms.includes('teambuilder'), `CLOSE_TAB closes the teambuilder tab (rooms: ${rooms.join(',')}; now on ${JSON.stringify(cur)})`);
      await drive0('CLOSE_TAB'); await sleep(200);
      check((await A.evaluate(() => Object.keys(app.rooms).includes(''))), 'CLOSE_TAB on the main menu does nothing');
      await A.evaluate(() => app.focusRoom(''));
      // Walk down until the format selector is under the cursor, then A opens the popup
      const target = d.ids.findIndex(id => /^MENU:format:/.test(id));
      for (let hops = 0; hops < 15 && d.index !== target; hops++) d = await drive0(d.index < target ? 'DOWN' : 'UP');
      check(/^MENU:format:/.test(d.item?.id || ''), `cursor reached the format selector (${d.item?.id})`);
      d = await drive0('CONFIRM'); await sleep(300); d = await drive0();
      check(d.pane === 'POPUP' && d.panes.POPUP?.n > 5, `A opens the format popup as a POPUP pane (${d.pane}, n=${d.panes.POPUP?.n})`);
      const before = d.index;
      d = await drive0('DOWN');
      check(d.pane === 'POPUP' && d.index !== before, `cursor moves inside the popup (${before} → ${d.index})`);
      d = await drive0('BACK'); await sleep(300); d = await drive0();
      check(d.pane === 'MENU' && (await A.evaluate(() => document.querySelectorAll('.ps-popup').length)) === 0, `B closes the popup, back to MENU (${d.pane})`);
    }
    await A.evaluate((n, f) => app.send(`/challenge ${n}, ${f}`), NAMES[1], FORMAT);
    await sleep(500);
    await B.evaluate(n => app.send(`/accept ${n}`), NAMES[0]);
    log('challenge accepted');

    await waitIn(A, '.battle-controls button[name="chooseTeamPreview"]', 'team preview');
    await waitIn(B, '.battle-controls button[name="chooseTeamPreview"]', 'team preview (B)');
    for (const p of [A, B]) await p.evaluate(() => { const ids = Object.keys(app.rooms).filter(k => k.startsWith('battle-')); app.focusRoom(ids[ids.length - 1]); });
    await sleep(500);
    await snapshot(A, '01-teampreview');

    // ---- Team preview: A via the userscript if present, else clicks ----
    const hook = SCRIPT ? await A.evaluate(() => typeof window.__showdownGamepad === 'object') : false;
    if (SCRIPT) check(hook, 'userscript test hook present');
    const drive = async (...intents) => {
      let d;
      for (const it of intents) { d = await A.evaluate(i => window.__showdownGamepad.inject(i), it); await sleep(120); }
      return d || A.evaluate(() => window.__showdownGamepad.debug());
    };
    if (hook) {
      await A.evaluate(() => window.__showdownGamepad.enable(true));
      let d = await drive();
      check(d.pane === 'TEAM' && d.panes.TEAM?.n === 6 && d.panes.TEAM?.columns === 6, `team preview pane read: ${JSON.stringify(d.panes)}`);
      d = await drive('RIGHT', 'RIGHT');
      check(d.index === 2, `RIGHT RIGHT → index 2 (got ${d.index})`);
      d = await drive('DOWN');
      check(d.index === 2, `DOWN in a single row is a no-op (got ${d.index})`);
      d = await drive('LEFT', 'LEFT', 'LEFT');
      check(d.index === 0, `LEFT clamps at 0 (got ${d.index})`);
      await snapshot(A, '02-teampreview-cursor');
      d = await drive('CONFIRM');
      await sleep(200); d = await drive();
      check(d.controls.back === true && d.item?.disabled === false && d.index === 1, `CONFIRM picked lead; cursor now on slot-2 candidate index 1 (got ${d.index}, back=${d.controls.back})`);
      d = await drive('BACK'); await sleep(200); d = await drive();
      check(d.controls.back === false, 'BACK from slot 2 returned to lead choice');
      await drive('CONFIRM'); await sleep(150);
      await drive('CONFIRM'); await sleep(150);
      await drive('CONFIRM'); await sleep(150);
      await drive('CONFIRM'); await sleep(150);
    } else {
      for (let i = 0; i < 4; i++) { await clickIn(A, 'button[name="chooseTeamPreview"]'); await sleep(150); }
    }
    for (let i = 0; i < 4; i++) { await clickIn(B, 'button[name="chooseTeamPreview"]'); await sleep(150); }

    await waitIn(A, '.battle-controls button[name="chooseMove"]', 'move select');
    await sleep(500);
    await snapshot(A, '03-move-select');

    // ---- Raw DOM facts (no script needed) ----
    const teraBefore = await inRoom(A, r => r.querySelector('input[name="terastallize"]')?.checked);
    await clickIn(A, 'label.megaevo');
    const teraAfter = await inRoom(A, r => r.querySelector('input[name="terastallize"]')?.checked);
    check(teraBefore === false && teraAfter === true, 'tera checkbox toggles via label click');
    await clickIn(A, 'label.megaevo');

    await clickIn(A, 'button[name="chooseMove"][value="1"]'); await sleep(300);
    await snapshot(A, '04-target-select');
    check(await hasIn(A, 'button[name="chooseMoveTarget"]'), 'single-target move opens target select');
    await clickIn(A, 'button[name="clearChoice"]'); await sleep(300);
    await snapshot(A, '05-after-back');
    await clickIn(A, 'button[name="chooseMove"][value="2"]'); await sleep(300);
    await snapshot(A, '06-slot2-move-select');
    check(await inRoom(A, r => /What will/.test(r.querySelector('.whatdo')?.textContent || '') && !!r.querySelector('button[name="clearChoice"]')), 'spread move goes straight to slot 2');
    await clickIn(A, 'button[name="chooseSwitch"]'); await sleep(300);
    await snapshot(A, '07-waiting');
    check(await hasIn(A, 'button[name="undoChoice"]'), 'waiting state shows Cancel (undoChoice)');
    await clickIn(A, 'button[name="undoChoice"]'); await sleep(300);
    await snapshot(A, '08-after-cancel');
    check(await hasIn(A, 'button[name="chooseMove"][value="1"]'), 'Cancel returns to slot-1 move select');

    // Advance a turn: both sides Protect+Protect
    for (const p of [A, B]) { await clickIn(p, 'button[name="chooseMove"][value="3"]'); await sleep(200); await clickIn(p, 'button[name="chooseMove"][value="3"]'); await sleep(200); }
    await waitFor(A, src => { const r = eval(src); const c = r && r.querySelector('.battle-controls'); return !!(c && /Turn 2/i.test(r.querySelector('.battle-log')?.textContent || '') && c.querySelector('button[name="chooseMove"]')); }, { desc: 'turn 2', timeout: 30000, args: [ROOM] });
    await sleep(500);
    await snapshot(A, '09-turn2-move-select');

    // ---- Script-driven battle turn ----
    if (hook) {
      let d = await drive();
      check(d.pane === 'MOVE' && d.panes.MOVE?.n === 4 && d.panes.MOVE?.columns === 4 && d.panes.SWITCH?.n === 6, `turn-2 screen read: ${JSON.stringify(d.panes)}`);
      check(d.focusId === 'move:Thunderbolt' || d.index === 0, `cursor starts on first move (${d.focusId})`);
      d = await drive('RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
      check(d.index === 3, `RIGHT x5 clamps at index 3 (got ${d.index})`);
      d = await drive('SWITCH_MENU');
      check(d.pane === 'SWITCH' && d.index === 2 && d.item?.disabled === false, `X moves cursor to switch pane, on the first switchable mon (got ${d.pane}/${d.index} ${JSON.stringify(d.item)})`);
      d = await drive('LEFT', 'LEFT');
      check(d.index === 0 && d.item?.disabled === true, `LEFT LEFT lands on an active (disabled) party slot (idx ${d.index}, ${JSON.stringify(d.item)})`);
      d = await drive('CONFIRM'); await sleep(200); d = await drive();
      check(d.pane === 'SWITCH' && d.index === 0, `CONFIRM on a disabled party slot does nothing (pane ${d.pane}, idx ${d.index})`);
      d = await drive('RIGHT', 'RIGHT');
      check(d.index === 2 && d.item?.disabled === false, `RIGHT RIGHT back to first switchable (idx ${d.index})`);
      d = await drive('BACK');
      check(d.pane === 'MOVE' && d.index === 3, `B returns to move pane, cursor restored to index 3 (got ${d.pane}/${d.index})`);
      d = await drive('GIMMICK'); await sleep(100);
      const tera = await inRoom(A, r => r.querySelector('input[name="terastallize"]')?.checked);
      check(tera === true, 'Y toggles tera on');
      d = await drive(); check(d.pane === 'MOVE' && d.index === 3, 'cursor unchanged after Y');
      await drive('GIMMICK'); await sleep(100);
      check((await inRoom(A, r => r.querySelector('input[name="terastallize"]')?.checked)) === false, 'Y toggles tera off again');
      await snapshot(A, '10-script-cursor-move3');
      await A.screenshot({ path: path.join(OUT, '10-script-cursor-move3.png'), clip: { x: 0, y: 360, width: 660, height: 300 } });
      const dimmed = await inRoom(A, r => r.querySelectorAll('.battle-controls .sgp-disabled').length);
      const heading = await inRoom(A, r => r.querySelector('.battle-controls .moveselect button.sgp-heading')?.textContent);
      check(dimmed === 2 && heading === 'Attack', `party slots in battle are dimmed (${dimmed}) and the Attack heading is tinted (${heading})`);
      await A.evaluate(() => document.body.classList.add('dark'));
      await A.screenshot({ path: path.join(OUT, '10c-dark-theme.png'), clip: { x: 0, y: 360, width: 660, height: 300 } });
      await A.evaluate(() => document.body.classList.remove('dark'));
      await drive('SWITCH_MENU'); await drive('LEFT', 'LEFT');
      await A.screenshot({ path: path.join(OUT, '10b-disabled-party.png'), clip: { x: 0, y: 360, width: 660, height: 300 } });
      await drive('RIGHT', 'RIGHT', 'BACK');
      d = await drive('LEFT', 'LEFT', 'LEFT');
      const firstMove = d.focusId; // first move of the lead: single-target for every mon on this team
      d = await drive('CONFIRM'); await sleep(250); d = await drive();
      check(d.pane === 'TARGET' && d.panes.TARGET?.n === 4 && d.panes.TARGET?.columns === 2, `A on ${firstMove} → target pane 2x2 incl. hidden self slot (${JSON.stringify(d.panes)})`);
      check(d.index === 0, `target cursor starts on first foe (idx ${d.index})`);
      await snapshot(A, '11-script-target');
      d = await drive('DOWN');
      check(d.index === 3, `DOWN from foe-left skips the hidden self slot → ally (idx ${d.index})`);
      d = await drive('UP', 'RIGHT');
      check(d.index === 1, `UP RIGHT → foe-right (idx ${d.index})`);
      d = await drive('BACK'); await sleep(250); d = await drive();
      check(d.pane === 'MOVE' && d.focusId === firstMove, `B from target select returns to moves on ${firstMove} (${d.pane}/${d.focusId})`);
      d = await drive('CONFIRM'); await sleep(200); d = await drive('CONFIRM'); await sleep(300); d = await drive();
      check(d.controls.back === true && d.pane === 'MOVE', `A A (move, target) submits slot 1 → slot 2 move select (${d.pane}, back=${d.controls.back})`);
      await snapshot(A, '12-script-slot2');
      d = await drive('BACK'); await sleep(250); d = await drive();
      check(d.controls.back === false && d.pane === 'MOVE', 'B from slot 2 goes back to slot 1');
      // Submit for real: Protect (idx 2) on both slots → waiting
      d = await drive('RIGHT', 'RIGHT', 'CONFIRM'); await sleep(200);
      d = await drive('CONFIRM'); await sleep(300); d = await drive();
      check(d.pane === 'WAIT' && d.controls.cancel === true, `both slots chosen → WAIT pane with Cancel (${d.pane})`);
      await snapshot(A, '13-script-waiting');
      d = await drive('BACK'); await sleep(300); d = await drive();
      check(d.pane === 'MOVE' && d.controls.cancel === false, `B in WAIT = Cancel → back to move select (${d.pane})`);
      // Typing guard: put text in the chat box, then try to move
      await inRoom(A, r => { const ta = r.querySelector('textarea'); ta.value = 'gg'; ta.focus(); });
      const before = (await drive()).index;
      d = await drive('RIGHT');
      check(d.index === before, 'RIGHT ignored while chat box has text');
      await inRoom(A, r => { const ta = r.querySelector('textarea'); ta.value = ''; });
      d = await drive('RIGHT');
      check(d.index === before + 1, 'RIGHT works again once chat box is empty');
      // Toggle off: cursor cleared, intents ignored
      await drive('TOGGLE_LAYER');
      const cursorCount = await inRoom(A, r => r.querySelectorAll('.sgp-cursor').length);
      check(cursorCount === 0, 'TOGGLE_LAYER off clears the cursor highlight');
      d = await drive('RIGHT');
      check(d.enabled === false && d.index === before + 1, 'intents ignored while disabled');
      await drive('TOGGLE_LAYER');
      d = await drive(); check(d.enabled === true, 'TOGGLE_LAYER on again');
      // Re-render survival: force the client to re-render controls and check focus survives
      const focusBefore = d.focusId;
      await inRoom(A, () => { app.curRoom.updateControls(); });
      await sleep(200); d = await drive();
      check(d.focusId === focusBefore, `cursor survives a full controls re-render (${focusBefore} → ${d.focusId})`);
      const badgeOf = () => A.evaluate(() => { const b = document.getElementById('sgp-status'); return b && { state: b.dataset.state, text: b.textContent }; });
      let badge = await badgeOf();
      check(badge && badge.state === 'on' && /Gamepad ON/.test(badge.text), `status badge shows ON (${JSON.stringify(badge)})`);

      // ↓ / ↑ cross between the stacked move row and party row
      d = await drive('DOWN');
      check(d.pane === 'SWITCH' && d.item?.disabled === false, `↓ off the moves enters the party list on a switchable mon (${d.pane}/${d.index})`);
      d = await drive('UP');
      check(d.pane === 'MOVE', `↑ off the party returns to the moves (${d.pane})`);

      // Skip turn / skip to end: submit a turn on both sides, then RB while playback lags
      await drive('LEFT', 'LEFT', 'LEFT', 'RIGHT', 'RIGHT', 'CONFIRM'); await sleep(150);   // Protect slot 1
      await drive('CONFIRM'); await sleep(150);                                              // Protect slot 2 → waiting
      for (const sel of ['button[name="chooseMove"][value="3"]', 'button[name="chooseMove"][value="3"]']) { await clickIn(B, sel); await sleep(150); }
      const sawSkip = await waitFor(A, src => { const r = eval(src); return !!r?.querySelector('.battle-controls button[name="goToEnd"]'); }, { desc: 'goToEnd button', timeout: 15000, args: [ROOM] }).catch(() => false);
      check(sawSkip === true, 'playback controls (Skip turn / Skip to end) appear while the turn animates');
      if (sawSkip) {
        d = await drive();
        check(d.controls.goToEnd === true && d.controls.skipTurn === true, `adapter sees skipTurn/goToEnd (${JSON.stringify(d.controls)})`);
        check(d.pane === 'PLAYBACK' && d.panes.PLAYBACK?.n === 2, `playback buttons are a cursor pane (${d.pane}, ${JSON.stringify(d.panes)})`);
        const hintTexts = await inRoom(A, r => [...r.querySelectorAll('.battle-controls .sgp-hint:not(.sgp-hint-forfeit)')].map(h => h.textContent));
        check(hintTexts.join(' ') === '(LB) (Y)', `hints painted on skip buttons (${hintTexts.join(' ')})`);
        const boxed = await inRoom(A, r => r.querySelectorAll('.battle-controls .sgp-pane').length);
        check(boxed === 1, `pane box drawn around the playback row (${boxed})`);
        d = await drive('RIGHT');
        check(d.focusId === 'PLAYBACK:goToEnd', `RIGHT moves cursor to Skip to end (${d.focusId})`);
        await drive('CONFIRM'); await sleep(400);
        const caughtUp = await inRoom(A, r => !r.querySelector('.battle-controls button[name="goToEnd"]') && !!r.querySelector('.battle-controls button[name="chooseMove"]'));
        check(caughtUp === true, 'A on Skip to end snaps playback to the new turn');
      }
      // Gimmick hint next to the tera checkbox
      d = await drive();
      const gimHint = await inRoom(A, r => r.querySelector('.battle-controls label.megaevo .sgp-hint')?.textContent);
      check(gimHint === '(RB)', `tera checkbox shows the gimmick hint (${gimHint})`);
      badge = await badgeOf();
      check(/\(Select\) forfeit/.test(badge?.text || ''), `pill always shows the forfeit hint (${badge?.text})`);
      const fh = await inRoom(A, r => r.querySelector('.battle-controls .sgp-hint-forfeit')?.textContent);
      check(fh === '(Select)', `forfeit hint tag is inside the battle controls (${fh})`);
      // Settings panel: click the pill, rebind GIMMICK to LT via a raw press, hint follows
      await A.evaluate(() => document.getElementById('sgp-status').click());
      let panel = await A.evaluate(() => !!document.getElementById('sgp-settings'));
      check(panel === true, 'clicking the pill opens the bindings panel');
      await A.evaluate(() => document.querySelector('#sgp-settings button[data-rebind="GIMMICK"]').click());
      await A.evaluate(() => window.__showdownGamepad.settings.onRawButton(6)); // LT
      await sleep(100);
      const gimHint2 = await inRoom(A, r => r.querySelector('.battle-controls label.megaevo .sgp-hint')?.textContent);
      const stored = await A.evaluate(() => JSON.parse(localStorage.getItem('showdown-gamepad.bindings.v1') || '{}'));
      check(gimHint2 === '(LT)' && stored[6] === 'GIMMICK' && !stored[5], `rebinding GIMMICK to LT updates the hint and localStorage (${gimHint2}, ${JSON.stringify(stored)})`);
      await A.evaluate(() => document.querySelector('#sgp-settings button[data-reset]').click());
      await A.evaluate(() => document.querySelector('#sgp-settings button[data-close]').click());
      panel = await A.evaluate(() => !!document.getElementById('sgp-settings'));
      check(panel === false && (await inRoom(A, r => r.querySelector('.battle-controls label.megaevo .sgp-hint')?.textContent)) === '(RB)', 'reset + close restores defaults');
      d = await drive(); check(d.controls.skipTurn === false, 'LB is a no-op when there is nothing to skip');

      // Forfeit: arm, cancel with another button, arm again, confirm
      await drive('FORFEIT'); badge = await badgeOf();
      check(/FORFEIT armed/.test(badge?.text || ''), `Start arms forfeit and the badge says so (${badge?.text})`);
      const alive1 = await inRoom(A, r => !/forfeited/.test(r.querySelector('.battle-log')?.textContent || ''));
      await drive('RIGHT'); badge = await badgeOf();
      check(!/FORFEIT armed/.test(badge?.text || '') && alive1, 'any other button disarms; nothing was sent');
      await drive('FORFEIT'); await drive('FORFEIT');
      const ended = await waitFor(A, src => { const r = eval(src); return /forfeited/.test(r?.querySelector('.battle-log')?.textContent || ''); }, { desc: 'forfeit in log', timeout: 10000, args: [ROOM] }).catch(() => false);
      check(ended === true, 'Select twice within 4s forfeits (battle log shows "forfeited")');
      await snapshot(A, '14-after-forfeit');
      // Playback catches up → end-of-battle buttons. Navigate to Main menu with the cursor.
      const sawEnd = await waitFor(A, src => { const r = eval(src); return !!r?.querySelector('.battle-controls button[name="closeAndMainMenu"]'); }, { desc: 'end-of-battle buttons', timeout: 30000, args: [ROOM] }).catch(() => false);
      check(sawEnd === true, 'end-of-battle controls appear (Instant replay / Main menu / Rematch)');
      if (sawEnd) {
        d = await drive();
        check(d.pane === 'PLAYBACK' && d.panes.PLAYBACK?.columns === 2, `end screen is a 2-column PLAYBACK grid (${JSON.stringify(d.panes)})`);
        await snapshot(A, '15-end-screen');
        let hops = 0;
        while (d.item?.id !== 'PLAYBACK:closeAndMainMenu' && hops++ < 6) d = await drive(hops % 2 ? 'DOWN' : 'LEFT');
        check(d.item?.id === 'PLAYBACK:closeAndMainMenu', `cursor reaches Main menu (${d.item?.id})`);
        await A.screenshot({ path: path.join(OUT, '15-end-screen.png'), clip: { x: 0, y: 360, width: 660, height: 300 } });
        await drive('CONFIRM'); await sleep(500);
        const roomsLeft = await A.evaluate(() => Object.keys(app.rooms).filter(k => k.startsWith('battle-')).length);
        d = await drive();
        check(d.pane === 'MENU', `A on Main menu closes the battle and lands on the MENU pane (${d.pane}, battle rooms left: ${roomsLeft})`);
      }
    }

    log(`done; ${failures} failure(s); output in ${OUT}`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    if (!HEADFUL) await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
