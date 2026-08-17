# Showdown Gamepad

Play [Pokémon Showdown](https://play.pokemonshowdown.com/) battles with an
XInput controller (Xbox pad, or DualShock through DS4Windows / Steam Input).
A cursor you move with the D-pad, **A** to confirm, **B** to back out — the
mainline-games feel, layered over the normal web UI.

Mouse and keyboard keep working at all times. The script never decides
anything for you: every button press maps to one click you could have made
yourself. Forfeit is deliberately not bound.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the raw script and accept the install prompt:
   **[`dist/showdown-gamepad.user.js`](https://raw.githubusercontent.com/pizzacatz/showdown-controller/main/dist/showdown-gamepad.user.js)**
3. Reload `play.pokemonshowdown.com`. A small pill in the bottom-right corner
   says **🎮 Gamepad: press any button on the controller** — plug in the pad and
   press any button once (browsers hide a pad from pages until its first
   press). The pill turns green (**Gamepad ON — …**) and the orange cursor
   appears as soon as a battle shows controls.

If the pill never turns green after a press: open the console (F12) — the
script logs `[showdown-gamepad] …` lines, including a warning if the pad
reports a non-`standard` mapping. `navigator.getGamepads()` returning only
`null`s means the browser itself isn't seeing the pad (Steam's controller
support can capture it; Chrome is the most reliable).

## Bindings

| Control | Action |
|---|---|
| D-pad / left stick | Move the cursor (holds repeat: 400 ms, then every 120 ms) |
| **A** | Confirm / activate the highlighted button |
| **B** | Back — Showdown's *Back* (previous slot / leave target select), *Cancel* while waiting on the opponent, or leave the party list |
| **X** | Jump to the party (switch) list |
| **Y** | Toggle Terastallize / Mega / Z / Dynamax checkbox |
| **Back/Select** | Turn the whole controller layer on/off |
| `Ctrl+Shift+G` | Same toggle, from the keyboard |

Team preview, move select, doubles target select, forced switches and the
"waiting for opponent" state are all covered. Disabled moves and
active/fainted party slots can be highlighted but never activated.

The cursor is an orange outline. It survives Showdown's turn re-renders by
identity (it stays on *Protect*, not on "the third button"), remembers the
last move you used across turns, and never wraps around edges.

While you have text in the chat box the pad is ignored (the empty, auto-focused
chat box does not count). Unplug the pad and you're back to mouse only.

## Layout

```
src/gamepad.js       INPUT — polls the Gamepad API, emits UP/DOWN/LEFT/RIGHT/
                     CONFIRM/BACK/SWITCH_MENU/GIMMICK/TOGGLE_LAYER. No Showdown.
src/cursor.js        NAVIGATION — pure state machine over (pane, index).
                     No DOM, no gamepad. Unit-tested with fake screens.
src/showdown-dom.js  ADAPTER — the only file with Showdown selectors.
                     Reads panes, clicks buttons, paints the cursor, watches
                     re-renders.
src/main.js          wiring + toggle + typing guard + test hook
build.js             esbuild → dist/showdown-gamepad.user.js
test/                vitest (jsdom); fixtures are real client HTML captured
                     by tools/recon.js
tools/recon.js       drives a local Showdown server + headless Chrome through
                     a doubles battle; with --script it runs the built
                     userscript end-to-end against the real client
docs/                PRD and DOM recon notes
```

Why three layers: when Showdown changes its markup (it will), only
`showdown-dom.js` needs touching; the navigation logic stays testable without
a browser.

## Development

```sh
npm install
npm test          # unit tests (56)
npm run build     # dist/showdown-gamepad.user.js
npm run recon -- --script dist/showdown-gamepad.user.js   # e2e vs a LOCAL server
```

The recon/e2e tool needs a local Showdown server (sim on :8000, classic
client on :8081 with `/showdown` proxied) and Chrome at
`/usr/bin/google-chrome` (`--chrome`, `--url` to override). It never talks to
the public server. Its stage snapshots land in `tools/out/`.

`window.__showdownGamepad` is exposed on the page for debugging:
`.inject('RIGHT')`, `.enable(true)`, `.debug()`.

## Scope / non-goals (v1)

Battle controls only — no teambuilder, ladder or chat navigation. No
remapping UI (bindings are constants in `src/gamepad.js`). Pads that don't
report `mapping === "standard"` are refused with a console warning rather than
guessed at. Classic client only; the `/beta` Preact client uses different
markup.

See [`docs/showdown-gamepad-prd.md`](docs/showdown-gamepad-prd.md) and
[`docs/dom-recon.md`](docs/dom-recon.md) for the design and the verified DOM
facts.

## License

MIT — same as Pokémon Showdown. See [`LICENSE`](LICENSE).
