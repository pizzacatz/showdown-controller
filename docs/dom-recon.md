# Showdown battle-controls DOM recon

Answers to the PRD's §10 open questions. Two sources, both dated 2026-08-16:

1. **Client source** — `smogon/pokemon-showdown-client` `origin/master` @ `daa28cfe`
   (2026-08-15), files `play.pokemonshowdown.com/src/oldclient/client-battle.js`,
   `client.js`, `style/oldclient.css`.
2. **Live render** — `tools/recon.js` driving two headless Chrome pages through
   a real Doubles Custom Game on a **local** Showdown server (Showdown-Offline:
   classic client build of 2026-05-09 + sim server, `noguestsecurity`), dumping
   `.battle-controls` outerHTML and button geometry at every stage. Snapshots
   are checked in as `test/fixtures/*.html` and drive the adapter unit tests.
   Nothing was run against the public server.

`play.pokemonshowdown.com` still serves the **classic Backbone/jQuery client**
(`oldclient/*`); the Preact rewrite lives at `/beta` and uses different markup
(`data-cmd` instead of `name`). Everything below is classic-client only.

## §10 answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Move button selector | `.movecontrols .movemenu button.movebutton`. Enabled: `<button class="movebutton type-X has-tooltip" name="chooseMove" value="1..4" data-move="Thunderbolt" data-target="normal">`. **Disabled moves are rendered with no `name`, `value` or `data-move` at all** — just `<button disabled class="movebutton has-tooltip">Name<br>…` — so identity must come from the first text node (move name), not `data-move`. Struggle: `name="chooseMove" value="0" data-move="Struggle"`. |
| 2 | Stable container | `.battle-controls` inside `.ps-room#room-<roomid>` — created once with the room; the view keeps `this.$controls` and does `.html(...)` on it for every update. Its `.controls` child and everything below is rebuilt each time. Rooms themselves are created dynamically, so the observer watches the document and filters. |
| 3 | Does `.click()` register a choice? | **Yes.** All room views bind `'click button': 'dispatchClickButton'` (jQuery delegation) which does `this[target.name](target.value, target)`. A synthetic `element.click()` bubbles a real `click` and was verified live: move → target → slot 2 → waiting all advanced via `.click()`. `.click()` on a `<button disabled>` is a browser no-op, so disabled moves need no special casing. |
| 4 | Tera control | `<div class="megaevo-box"><label class="megaevo"><input type="checkbox" name="terastallize"> Terastallize …</label></div>` — same `label.megaevo` for `megaevo`/`megaevox`/`megaevoy`/`zmove`/`ultraburst`/`dynamax`. Clicking the label or the input toggles it (verified false→true→false); the client reads `.checked` at choose time. |
| 5 | Sandbox `navigator` | Moot: the script uses `@grant none`, so it runs in the page context with the page's `navigator`. (Sibling scripts in `showdown-scripts` already ship with `@grant none`.) |
| 6 | Doubles target order | DOM order **matches visual order**, row-major: row 1 = foes rendered from `farActive.length-1` down to `0` (i.e. mirrored so the opponent's right-hand mon appears on the player's left), row 2 = own side in slot order. Live doubles render: `chooseMoveTarget=2 @x4`, `=1 @x110` / `<button disabled style="visibility:hidden">` @x4 (self), `=-2 @x110` (ally). Non-targetable foes (triples, non-adjacent) render as visible empty `<button disabled></button>`; own non-targetable slots as `visibility:hidden` placeholders. |

## Layout facts (drive the column counts)

Desktop `.battle-controls` is 640px wide. Each menu is **one row**:

| Menu | Button width | Per row | Live y |
|------|-------------|---------|--------|
| moves `.movebutton` | 155 + 4px margin | 4 | all at y=469 |
| party `.switchmenu button` | 102 + 4px margin | 6 | all at y=596 |
| team preview (same `.switchmenu`) | 102 + 4 | 6 | one row |
| targets (two `.switchmenu` blocks) | 102 + 4 | per side | rows y=449 / 483 |

Only under `@media (max-height:570px) and (min-width:440px)` (small layout) do
menus get narrower and wrap; there `.moveselect`/`.switchselect` become real
tabs and only one of `.movemenu`/`.switchmenu` is shown (`.move-controls` /
`.switch-controls` class on `.controls`). On desktop **both moves and party are
visible at once**; the `Attack`/`Switch` buttons are inert labels.

Because of this the adapter derives the grid from geometry: buttons are
grouped into rows by `getBoundingClientRect().top` (4px tolerance), rows
ordered top→bottom and cells left→right, and short rows are padded with
`skip` placeholders so the flat list is row-major with one column count.
Result on desktop: moves 4 columns, party 6, targets = active mons per side,
end-of-battle screen 2 columns (`[instantReplay, pad] / [mainMenu, rematch]`),
main menu 1 column, popups whatever their layout is.

## Screens the adapter distinguishes

| Client `updateControls` state | Panes | Extra controls |
|---|---|---|
| team preview (`chooseTeamPreview`) | `TEAM` (6, chosen slots become `<button disabled>`) | `clearChoice` after the first pick |
| move (`chooseMove`) | `MOVE` + `SWITCH` (party: `chooseSwitch` / `chooseDisabled` for active+fainted) | `label.megaevo` gimmick, `clearChoice` when choosing for slot ≥2 |
| movetarget (`chooseMoveTarget`) | `TARGET` grid | `clearChoice` |
| switch (forced, after faint) | `SWITCH` only | — |
| switchposition (`chooseSwitchTarget`) | `SWITCH_TARGET` | `clearChoice` |
| waiting (`getPlayerChoicesHTML`) | none | `undoChoice` Cancel |
| playback lagging | `PLAYBACK` (`skipTurn`, `goToEnd`; after the battle also `pause`/`instantReplay`/`rewindTurn`) | — |
| battle over (players) | `PLAYBACK` grid: row 1 `instantReplay` (+ `a.replayDownloadButton`, not selectable), row 2 `closeAndMainMenu` `closeAndRematch` | `saveReplay` not selectable |
| any `.ps-popup` (format/team picker, confirmations) | `POPUP` — every button in the topmost popup; modal, outranks all battle panes | `button[name=close]` or `app.dismissPopups()` on B |
| main menu (room id `''`, element `#room-`) | `MENU` (wrap-around) — buttons of every `.menugroup` holding a `form.battleform`: the search group (format/team selectors, injected quick-select buttons, `search`/`cancelSearch`) and, while games run, the "Games" group the client swaps in (`.roomlist a.blocklink` links + `showSearchGroup`). Teambuilder/Ladder/… groups excluded by request. | — |

`chooseDisabled` party buttons (active/fainted mons) are *not* `disabled`
attributes — clicking them opens a Showdown popup — so the adapter marks them
`disabled` and never clicks them.

## Behaviour facts that shaped the design

- **The client auto-focuses the chat textarea when a battle room gains focus.**
  A naive "text field focused ⇒ typing" guard blocks the controller nearly
  always. The client's own shortcut logic (`client.js` `safeLocation`) treats
  an *empty* textarea as safe; the adapter does the same: typing = a focused
  text field **with content**.
- **Painting under the buttons.** `.movebutton` / `.switchmenu button` are
  `position: relative` (positioned, z-index auto), so an overlay meant to sit
  *behind* them needs `z-index: -1` inside a stacking context on
  `.battle-controls` (`isolation: isolate`); otherwise it paints on top of the
  buttons or under the controls' background. `body.dark` is the dark-theme hook.
- **Tabs.** `app.roomList`/`sideRoomList` hold only chat/battle rooms; Home,
  Teambuilder, Ladder, Resources are separate. To step through *all* tabs
  walk `.maintabbar a.roomtab[href]` (DOM order = visual order, skip
  `/rooms`) and `app.focusRoom(id)`. Closing = `app.leaveRoom(id)`, which
  runs the room's `requestLeave()` — a live battle opens the client's Forfeit
  popup rather than leaving.
- **Never `.focus()` a button.** The client binds ←/→ (switch room) and
  Shift+←/→ (move room) on `keydown` when focus is on a button or empty
  textarea. The cursor is a CSS class (`sgp-cursor`), not focus.
- Client keyboard shortcuts in play: Esc (close popup), ←/→, Shift+←/→ as
  above, Ctrl+F/Ctrl+G only in the desktop (nw.js) build. `Ctrl+Shift+G` is
  free and is the layer toggle.
- Room switching (`app.focusRoom`) toggles `display` on `.ps-room` elements;
  the adapter reads `app.curRoom.$el` first, falling back to the visible
  battle room, and the observer fires on `.ps-room` style changes.
- Users auto-rejoin their open battles on login (`|/autojoin`), so a page can
  hold several battle rooms; only the current one is read.

## Deviations from the PRD (deliberate)

| PRD | Shipped | Why |
|---|---|---|
| Move pane 2 columns, switch pane 2 columns | columns from geometry (4 / 6 on desktop) | the desktop client lays each menu out in one row |
| Left/right = ±1 over the flat list | ±1 **within the row**, clamped at row edges | flat ±1 from the right-most foe target wrapped down onto the ally — a real misclick vector; skip-aware vertical movement already guarantees reachability |
| four panes | + `TEAM` (team preview) and `SWITCH_TARGET`; `WAIT` state with B = Cancel | VGC battles start with team preview; waiting state has a Cancel button |
| "X opens switch menu" | X moves the cursor to the party pane (and clicks `selectSwitch` for the small layout); ↓ off the move row / ↑ off the party row do the same | on desktop the party is always visible, stacked under the moves |
| forfeit unbound | Start = arm, Start again ≤4 s = `room.send('/forfeit')` (client API, as QoL Battle Tools does); LB/RB = `skipTurn`/`goToEnd` | requested after v0.1; two-press arm keeps it non-accidental |
| typing guard = any focused input | focused text field **with content** | see above |
| identity by label text | move name / Pokémon name from the first text node; targets by `name:value` | PP text changes mid-turn; disabled moves have no `data-move` |
