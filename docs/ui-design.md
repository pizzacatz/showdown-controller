# Visual design of the controller layer

Why the cursor, group and disabled states look the way they do (v0.4.0,
2026-08-17). Companion to [dom-recon.md](dom-recon.md), which covers *where*
things are; this covers *how they are shown*.

## Problem

Earlier versions used the same hue and the same channel (an outline) for two
different things — the item cursor and the "which group am I in" box — and a
dashed ring for "not selectable". Three outlines competed for attention, the
group box looked like a second cursor, and the dashed ring decorated the
disabled buttons instead of de-emphasising them.

## Principles

1. **One thing shouts, everything else whispers.** Exactly one high-contrast
   element on screen: the item cursor. Every other indicator is lower
   contrast than the cursor.
2. **Different layers use different visual channels**, not just different
   colors. Two outlines of different colors still read as two cursors.
   - cursor → ring
   - active group → filled tray + tinted heading
   - not selectable → dimming (removal of presence), never an added decoration
3. **One accent color (orange), and no hues that already mean something in
   Showdown.** Blue is used for Water/Ice/Flying move buttons, links and the
   *Switch* heading; red/yellow/green are HP-bar states. Red is reserved for
   the armed-forfeit state of the status pill, where "danger" is the message.
4. **Theme-agnostic contrast.** The client has a light (`#EEF2F5` controls
   background) and a dark theme (`body.dark`). Every indicator has a value
   for both, and the cursor ring is two-tone so it never depends on the
   background.
5. **Motion only on the thing you are looking for.** A slow two-state pulse
   on the cursor helps locate it after a re-render; trays and headings never
   move. Honors `prefers-reduced-motion`.

## The three layers

| Layer | Element | Treatment | Rationale |
|---|---|---|---|
| 1 — item cursor | `.sgp-cursor` on the button | 2px **white inner** ring (outline, inset) + 3px **orange outer** ring (box-shadow); pulses 3↔4px every 0.8s in two steps (no fades) | Two-tone rings satisfy WCAG 2.4.11/2.4.13 (≥2px perimeter, ≥3:1 against adjacent colors) on both themes and on top of type-colored move buttons; it is the same idea as Chrome's default focus ring. Solid steps instead of an opacity fade because a fade reads as "loading". |
| 2 — active group | `.sgp-pane` overlay behind the row; `.sgp-heading` on the *Attack* / *Switch* / *Choose Lead* label | Tray: orange at 22% (light) / 25% (dark) opacity, 8px radius, painted **behind** the buttons (`.battle-controls { isolation: isolate }` + `z-index:-1`). Heading: orange text with a 2px underline. | A filled tray is how console menus mark the active panel; it can't be confused with a cursor. The client already prints a heading per row, so tinting the active one mirrors the FIGHT/POKÉMON labels of the mainline games at zero extra clutter. |
| 3 — not selectable | `.sgp-disabled` on every disabled button in every visible pane (0 PP move, active/fainted Pokémon, chosen team-preview slot, non-targetable slot) | `filter: saturate(.35)` + a `::after` overlay of medium gray at 42% (light) / black at 45% (dark). The cursor ring still draws on top when the cursor lands there. | Dimming is the universal "can't press" idiom. The cursor may still land on it (mainline behaviour — you can select a 0-PP move and get told why), so the ring stays visible above the gray: gray = can't press, ring = you're here. |

Supporting elements use the same accent and radius: the `(RB)` / `(LB)` /
`(Y)` / `(Select)` hint tags, and the status pill (orange = on, gray =
waiting for a button press, red = layer off or forfeit armed).

## Implementation notes

- All of it is CSS on classes the adapter toggles (`showdown-dom.js`
  `CURSOR_CSS`); nothing here touches the client's own styles except the
  `isolation: isolate` on `.battle-controls`, which creates a stacking context
  so the tray can be painted under the buttons without changing layout.
- The MutationObserver ignores changes that only add/remove these classes or
  the overlay/hint nodes, so painting never re-triggers a resync.
- Screenshots used to check both themes are produced by
  `tools/recon.js --script …` (`tools/out/10-script-cursor-move3.png`,
  `10b-disabled-party.png`, `10c-dark-theme.png`).

## Rejected alternatives

- **Blue group box** (complementary to orange): collides with Water-type
  buttons and the client's blue *Switch* heading — an outline of the same hue
  around a row that contains a blue button is ambiguous.
- **Second outline in any color** for the group: still competes with the
  cursor for the same channel.
- **Dashed high-contrast ring for disabled**: adds visual weight to the thing
  that should have the least; a dashed pattern also reads as "loading" or
  "drop target" in web idiom.
- **Glow / opacity fade on the cursor**: reads as fading out rather than
  as an indicator; replaced by a two-step width pulse.
