# PRD: Gamepad Control Layer for Pokémon Showdown

**Status:** Implemented (v0.1.0, 2026-08-16). §10 resolved — see §11 and [dom-recon.md](dom-recon.md)
**Target:** Tampermonkey userscript, `play.pokemonshowdown.com`
**Author handoff:** Claude Code

---

## 1. Goal

Play Showdown battles with an XInput controller, using an interaction model
familiar from the mainline games: a cursor you move with the D-pad, A to
confirm, B to back out.

The controller is a **second input method layered over the existing UI**. Mouse
and keyboard continue to work unchanged at all times. The script never makes a
game decision on the user's behalf — every controller action maps to something
the user could have done with a click.

## 2. Non-goals

- No macro, queueing, or automation of any kind. One button press, one UI action.
- No teambuilder, ladder, or chat navigation in v1. Battle controls only.
- No remapping UI. Bindings are constants in the source for v1.
- No support for non-standard gamepads (DualShock via DS4Windows presents as
  XInput and is therefore fine; raw HID pads are out of scope).

## 3. Relationship to the existing userscript

**Decision: ship this as a separate userscript, same `@match`.**

Tradeoff: keeping it separate means the replay-capture and forfeit features
can't be destabilized by a bug in the polling loop, at the cost of some
duplicated DOM-helper code across the two scripts. Given that replay capture
writes files and uploads, isolating it is worth the duplication.

## 4. Architecture

Three layers, in the same shape as the Switch automation project. The middle
layer is pure and has no knowledge of either gamepads or Showdown.

```
┌─────────────────────────────────────────┐
│ INPUT LAYER          gamepad.js         │
│ Polls the Gamepad API. Emits normalized │
│ edge events: UP, DOWN, LEFT, RIGHT,     │
│ CONFIRM, BACK, SWITCH_MENU, GIMMICK,    │
│ TOGGLE_LAYER.                           │
│ Knows nothing about Showdown.           │
└──────────────┬──────────────────────────┘
               │ intent events
┌──────────────▼──────────────────────────┐
│ NAVIGATION LAYER     cursor.js          │
│ Pure. Holds current pane, cursor index, │
│ and column count. Given (state, event)  │
│ returns (newState, action | null).      │
│ Knows nothing about the DOM or the API. │
└──────────────┬──────────────────────────┘
               │ action: {type:'activate', index:n}
┌──────────────▼──────────────────────────┐
│ ADAPTER LAYER        showdown-dom.js    │
│ The ONLY file containing Showdown       │
│ selectors. Reads the current pane and   │
│ its button list; performs activation;   │
│ paints the cursor highlight; watches    │
│ for re-renders.                         │
└─────────────────────────────────────────┘
```

Why this split: the navigation layer is a pure function, so it can be unit
tested with a fake pane list and no browser at all. When Showdown changes its
markup — and it will — only `showdown-dom.js` needs touching.

## 5. Input layer specification

These are Gamepad API facts, stable across Chrome/Firefox/Edge.

**Polling, not events.** The API fires `gamepadconnected` and
`gamepaddisconnected` on `window`, but there are no button events. Button state
must be read each frame from `navigator.getGamepads()`, which returns an
array-like that may contain `null` holes. Run the loop under
`requestAnimationFrame` and stop it when no pad is connected.

**Controller invisibility until first press.** A connected pad does not appear
in `getGamepads()` until the user presses a button on it. This is intentional
fingerprinting protection, not a bug. The script must not report "no controller
found" until after a first press has been observed.

**Standard mapping.** XInput pads report `gamepad.mapping === "standard"`, which
guarantees these indices:

| Index | Button | Index | Button |
|---|---|---|---|
| 0 | A | 8 | Back/Select |
| 1 | B | 9 | Start |
| 2 | X | 10 | L3 |
| 3 | Y | 11 | R3 |
| 4 | LB | 12 | D-pad Up |
| 5 | RB | 13 | D-pad Down |
| 6 | LT | 14 | D-pad Left |
| 7 | RT | 15 | D-pad Right |

Axes: `0` = left stick X, `1` = left stick Y (negative is up). Each entry in
`gamepad.buttons` is a `GamepadButton` with `.pressed` (boolean) and `.value`
(0–1 for analog triggers).

**If `mapping !== "standard"`, refuse to bind** and log a warning rather than
guessing at indices.

**Edge detection.** Keep a previous-frame snapshot of the pressed booleans. Emit
an event only on `false → true`. Copy the boolean values out — do not retain
the `GamepadButton` objects.

**Analog stick.** Deadzone of `0.5` on axes 0/1, converted to the same four
directional events as the D-pad. Directions are mutually exclusive: whichever
axis has the larger magnitude wins, so diagonals don't fire two events.

**Repeat.** Directional events repeat while held: 400 ms initial delay, then
every 120 ms. Confirm/back/menu buttons never repeat.

## 6. Navigation layer specification

### Panes

The layer models the battle controls as one of four panes. Each pane is a flat
ordered list plus a declared column count.

| Pane | Contents | Columns |
|---|---|---|
| `MOVE_SELECT` | 4 move buttons | 2 |
| `TARGET_SELECT` | legal targets (doubles/VGC) | varies, from adapter |
| `SWITCH_SELECT` | benched Pokémon | 2 |
| `INACTIVE` | nothing actionable on screen | — |

**Decision: flat list plus column count, not a true 2D grid.** Left/right moves
the cursor ±1; up/down moves ±`columns`. Tradeoff: with an odd number of
entries this occasionally feels slightly off compared to a real grid, but it
never produces an unreachable cell, which a naive grid does when the last row
is partly empty. Movement clamps at the ends rather than wrapping — mainline
wraps, but clamping means a mashed D-pad can't carry the cursor somewhere
surprising.

### Transitions

```
INACTIVE ──(adapter reports controls present)──> MOVE_SELECT

MOVE_SELECT ──CONFIRM──> TARGET_SELECT   (if doubles and move needs a target)
            ──CONFIRM──> [choice submitted, back to INACTIVE]
            ──SWITCH_MENU (X)──> SWITCH_SELECT
            ──GIMMICK (Y)──> toggles tera/gimmick, cursor unchanged

TARGET_SELECT ──CONFIRM──> [choice submitted]
              ──BACK (B)──> MOVE_SELECT

SWITCH_SELECT ──CONFIRM──> [choice submitted]
              ──BACK (B)──> MOVE_SELECT
```

Important: the layer does **not** decide whether a move needs target selection.
It asks the adapter what pane is currently on screen after each activation. The
DOM is the source of truth; the state machine follows it.

### Bindings

| Control | Action |
|---|---|
| D-pad / left stick | Move cursor |
| A | Confirm / activate focused element |
| B | Back (equivalent to Showdown's Cancel) |
| X | Open switch menu |
| Y | Toggle tera / gimmick checkbox |
| Back/Select | Enable or disable the whole controller layer |

**Forfeit is deliberately not bound to any button.** A misclick there is
unrecoverable, and the existing userscript already provides a forfeit path.

## 7. Adapter layer contract

`showdown-dom.js` must export these five functions. Signatures are fixed;
implementations are TBD pending DOM inspection (§10).

```js
// Which pane is currently on screen, and what's in it.
// Returns: { pane: 'MOVE_SELECT'|'TARGET_SELECT'|'SWITCH_SELECT'|'INACTIVE',
//            items: HTMLElement[],
//            columns: number }
readPane()

// Activate the element at items[index]. Returns true if activation was
// dispatched, false if the element was missing or disabled.
activate(index)

// Paint/clear the cursor highlight.
setCursor(index)
clearCursor()

// Call cb() whenever the battle controls re-render.
onControlsChanged(cb)
```

### Re-render handling

Showdown rebuilds the battle controls on every turn and on every request
update, which invalidates every element reference the cursor is holding.

`onControlsChanged` wraps a `MutationObserver` on the controls container.
On each fire, the navigation layer re-reads the pane and **attempts to preserve
the cursor by identity, not index** — match the previously focused element's
label text against the new list, and only fall back to clamping the old index
if no match is found. Without this, a mid-turn re-render makes the cursor jump,
which is exactly the kind of thing that causes a misclick on a real move.

Debounce observer callbacks by one animation frame; Showdown may emit several
mutations for a single logical update.

### Activation method

**Decision: dispatch a click on the real button element, rather than sending a
`/choose` command through the client's room object.**

Tradeoff: sending the protocol command directly would be immune to markup
changes, but it would mean re-implementing Showdown's legality logic — which
moves are disabled, whether a target is required, how tera interacts with the
choice. Clicking the button lets the client's own validation do that work.
Robustness is the thing we're giving up, and the adapter layer is where we've
agreed to absorb that cost.

### Typing guard

If `document.activeElement` is an `input` or `textarea` (i.e. the user is in
the chat box), the adapter must ignore all activation and cursor events. Add
this guard before anything else — it is the most likely source of an
embarrassing bug.

### Highlight

Inject a dedicated CSS class with an outline and background tint. Do not rely
on native `:focus`, since Showdown re-renders will drop it and the default
focus ring is too subtle to track during a timed battle.

## 8. Task breakdown

1. Userscript scaffold with `@match`, `@grant unsafeWindow`, and a toggle
   keybind as an escape hatch.
2. `gamepad.js` — connect/disconnect, polling loop, edge detection, deadzone,
   repeat timing. Verifiable standalone by logging events to the console.
3. `cursor.js` — pure state machine. Ships with unit tests using a fake pane.
4. `showdown-dom.js` — selectors, `readPane`, `setCursor`/`clearCursor`.
   **Blocked on §10.**
5. `activate()` plus the typing guard.
6. `MutationObserver` wiring and identity-preserving cursor restore.
7. Doubles/VGC target selection pane.
8. Tera/gimmick toggle.

Order matters: 2 and 3 are fully testable before anyone knows what Showdown's
markup looks like. Do those first.

## 9. Validation list

Test in a real battle, not a replay.

- [ ] Pad is not detected until first button press; no false "no controller" warning.
- [ ] Cursor moves correctly in a 4-move layout, and in a 3-move or 1-move layout (Choice item, Encore, out of PP).
- [ ] Cursor clamps at edges and does not wrap.
- [ ] Holding a direction repeats at a usable speed and is not runaway-fast.
- [ ] Analog diagonal produces exactly one direction, not two.
- [ ] A on a move submits the choice in singles.
- [ ] In doubles, A on a spread move goes straight through; A on a single-target move opens target select.
- [ ] B from target select returns to move select without submitting.
- [ ] X opens the switch menu; B leaves it.
- [ ] Y toggles tera and the checkbox visibly reflects it.
- [ ] A disabled move (0 PP, Imprison, Taunt) cannot be activated.
- [ ] Cursor survives a mid-turn re-render without jumping to a different move.
- [ ] Typing in chat does not move the cursor or activate anything.
- [ ] Unplugging the controller mid-battle degrades to mouse control cleanly.
- [ ] Back/Select disables the layer; mouse still fully works while disabled.
- [ ] Existing replay-capture script still functions with this script loaded.

## 10. Open questions — must resolve before task 4

**Everything here needs to be checked in a live browser. I do not want these
guessed at.**

1. **Move button selector.** Open a battle, inspect a move button. What is its
   class? Does it carry a `name` or `data-*` attribute that the client's
   delegated handler keys off? Recent client versions have moved toward Preact,
   and I don't know the current markup with enough confidence to write
   selectors.
2. **Stable container.** What is the nearest ancestor element that persists
   across turn re-renders? That is the `MutationObserver` target.
3. **Does `element.click()` actually register a choice?** If the client uses
   delegated listeners on a parent, a synthetic click should bubble and work —
   but this needs confirming, and the forfeit-button work may already answer it.
   If it fails, the fallback is dispatching a full
   `PointerEvent`/`MouseEvent` sequence with `bubbles: true`.
4. **Tera control.** Is it a checkbox `input`, a button, or something else in
   the current client? Determines whether `activate` or a direct `.checked`
   toggle is correct.
5. **Sandbox access to `navigator`.** Tampermonkey's sandboxed `navigator`
   should expose `getGamepads`, but if the pad list comes back empty while the
   page-level console shows a connected pad, switch to
   `unsafeWindow.navigator.getGamepads()`. Worth testing early since it's a
   two-minute check that would otherwise look like a polling bug.
6. **Doubles target markup.** Target buttons in VGC are laid out positionally
   (opponent left/right, ally). Confirm whether DOM order matches visual order —
   if it doesn't, `columns` alone won't produce sane navigation and the adapter
   will need an explicit order mapping.

---

## 11. Resolution log (2026-08-16)

All of §10 was answered from the client source (`origin/master` @ daa28cfe) and
confirmed in a live render on a local Showdown server via `tools/recon.js`;
details and evidence in [dom-recon.md](dom-recon.md). Summary:

1. Move buttons: `.movemenu button.movebutton`, `name="chooseMove"` — disabled
   moves are rendered without `name`/`data-move`, so identity uses the label
   text node.
2. Stable container: `.battle-controls` (persists; contents rebuilt).
3. `element.click()` works — jQuery-delegated `click button` dispatches on
   `target.name`. Verified live through move → target → slot 2 → waiting.
4. Tera: `label.megaevo > input[type=checkbox][name=terastallize]`; click it.
5. `@grant none` → page `navigator`; no sandbox question.
6. Target DOM order = visual order (foes mirrored, then own side); own
   non-targetable slot is a `visibility:hidden` placeholder kept as a skip cell.

Deviations from the draft, all deliberate (rationale in dom-recon.md):
`TEAM` (team preview) and `SWITCH_TARGET` panes plus a `WAIT` state added;
columns derived from geometry (desktop = one row per menu, so 4 / 6, not 2);
left/right clamp within the row rather than ±1 over the flat list; the typing
guard treats an *empty* focused chat box as not typing (the client auto-focuses
it); X moves the cursor to the always-visible party list rather than "opening"
a menu.

v0.2.0 (2026-08-17), by request: Start = forfeit (arm-then-confirm, 4 s window,
any other button disarms; sends `/forfeit` via the client room API), LB = Skip
turn, RB = Skip to end (playback buttons, only when present), ↓/↑ cross between
the move row and the party row. All verified live via `tools/recon.js`.

v0.3.0 (2026-08-17): defaults changed to RB = gimmick, Y = skip to end,
Select = forfeit, Start = layer toggle; in-page remapping (click the pill,
localStorage); `(RB)`/`(LB)`/`(Y)` hints painted on the controls and a
permanent `(Select) forfeit` hint in the pill; playback buttons are a
cursor-selectable `PLAYBACK` pane; solid opaque cursor, overlay box around the
current pane, high-contrast dashed ring for not-selectable items.

v0.4.0 (2026-08-17): visual language reworked — two-tone pulsing cursor
ring, orange tray + tinted heading for the active group, gray dimming for
non-selectable buttons, one accent color, light/dark values. Rationale and
rejected alternatives in [ui-design.md](ui-design.md); this supersedes §7
"Highlight".

v0.5.0 (2026-08-17): geometry-derived 2-D grid with padded rows (replaces
"flat list + column count"); end-of-battle buttons (Instant replay / Main
menu / Rematch) selectable; `POPUP` pane for any `.ps-popup` (B closes) and
`MENU` pane for the main menu — the controller now works from the main screen
through a battle and back. Forfeit hint/arm disabled once the battle is over.

v0.6.0 (2026-08-17): main-menu pane restricted to the battle group (format,
quick-select, team, Battle!) with wrap-around top↔bottom (battle panes still
clamp); RT = close current tab, L3/R3 = previous/next tab.

Validation list (§9): every item except the physical-pad ones (first-press
detection, unplug, analog diagonals on real hardware, coexistence with the
replay-capture script) is exercised by `tools/recon.js --script` against the
real client, plus 56 unit tests. The physical-pad items need a real controller
in a real browser session.
