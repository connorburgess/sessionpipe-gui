# Office theme · design

`/office` shows the same facts as the board, as rooms and people. The target is the
readability of a good management sim without its HUD: one glance tells you who needs
you, who is busy, who has drifted off; a day of watching it stays calm. Flat 2D vector
only, the app's own tokens, no faces, nothing moves when nothing is happening.

Inputs: `SessionSummary`, `MachineSummary`, `Attention` from `shared/api.ts`;
`useSessionTree()` for roots and children; `harnessMark()` for monograms; `STATE_*` and
`ATTENTION_LABEL` from `lib/format.ts` for every word on screen. The theme derives one
`Posture` per session (§8) and renders it. It never invents a reading of its own.

## 1. Spatial grammar

**Room = machine.** One room per `MachineSummary`, in name order (same as `useMachines`),
never reordered by state: a light does the work of attracting the eye, not a reshuffle.
Sessions with no `machine` share a last room named `unnamed`.

```
 mbp-misha  Cl 1.4 · Cx 0.9  ●online            ← nameplate, outside the top wall
┌───────────────────────────────────────┐
│ ░░░░░░░░░░░░ window ░░░░░░░░░░░░░░░░░ │        ← flat tint band, §5
│                                       │
│   [6]   [7]   [8]   [9]   [10]  [11]  │        ← second row, further from the door
│                                       │
│   [0]   [1]   [2]   [3]   [4]   [5]   │        ← slot 0 is nearest the door
│                                       │
└──╷   ╷────────────────────────────────┘        ← floor line; figures walk on it
   door   4 home                                  ← "gone home" tally, right of the door
```

- **Desk cell** 96 × 80 px, the same on every viewport (the 24 px silhouette test, §2,
  is a fixed-size test). Room padding 12 px; wall 1 px `--line`; wall fill `--bg-2`,
  floor `--bg-3` (floor is the bottom 40 % of the room).
- **Columns** = `clamp(2, liveDesks, 6)` on desktop, `clamp(2, liveDesks, 3)` at ≤ 480 px.
  **Rows** = `ceil(max(liveDesks, 2) / columns)`, max 4. Beyond 24 live sessions the
  room stays at 24 desks and the nameplate gains `+n more` (link to the Board filtered by
  that machine). An empty room still shows two empty desks.
- **Slots are stable.** A root session takes the lowest free slot index the moment it
  is first seen alive (`state !== "done"`), and keeps it until it leaves. Slot 0 is next
  to the door; indices run left→right along the bottom row, then the row above. Keep a
  `Map<SessionKey, slot>` in memory and mirror it to `sessionStorage` so a reload does
  not reseat anyone. A freed slot is reused by the next arrival (nearest the door).
- **Subagents** (`childrenOf.get(key)`) are not seated: they stand to the right of the
  parent's desk, 16 px tall, max 3 shown, then a `+n` numeral. If a parent has
  `children > 0` but no live child summaries, show the numeral only.
- **Gone home tally** = sessions on this machine that reached `done` since local
  midnight. A numeral and the word `home`, `--fg-3`, hover shows `4 sessions done today`.
- **Nameplate**: machine name (`--fg`, 13 px, `--font-display`), harness glyph + version
  pairs from `harnesses` (`--fg-3`, 11 px), and a 6 px dot for `control.online`
  (`--ok`, else outline only). Click → `/machines`.
- **Door**: an 18 px gap in the bottom wall at x = 16 px. Figures enter and leave here.
- **Phone (390 px)**: rooms stack full width, one per row, 3 desks per row; the window
  becomes a 6 px band under the top wall; the nameplate wraps to two lines; the tally
  moves inside the room, bottom-right. No horizontal scroll; the room scrolls as a
  whole with the page. Tap target for a desk = the whole 96 × 80 cell.

## 2. State → posture

Four things vary, and only these four: **arm** (down / raised), **screen** (lit blue /
pale / off), **lamp** (off / on), **figure tone** (`--fg-2` / `--fg-3`). Everything else
is identical between states so the differences read at a glance.

| state       | figure                                   | screen                      | lamp        | bubble                           |
|-------------|------------------------------------------|-----------------------------|-------------|----------------------------------|
| `working`   | seated facing the screen, hands on keys, `--fg-2` | lit `--work`, tool name (§3) | off | none                             |
| `needs_you` | seated **turned to the room**, **one arm raised**, `--fg-2` | dim `--work-bg`, no text | **on, `--needs`** | `ATTENTION_LABEL[kind]`, `--needs-bg` |
| `stale`     | seated, **leaning back**, hands off keys, `--fg-3` | pale `--stale`, no text | off | none; elapsed under the desk     |
| `idle`      | seated facing the room, hands in lap, `--fg-3` | off (`--bg-4` with `--line` edge) | off | none                       |
| `done`      | not in the room                          | —                           | —           | —                                |
| arriving    | walks door → desk, then sits (§4)        | off until seated            | off         | none                             |
| leaving     | stands, walks desk → door, fades at the jamb | off from the first frame | off         | none                             |

```
 working         needs_you        stale            idle
  ┌──┐ blue       ┌──┐ dim         ┌──┐ pale        ┌──┐ off
  │▓▓│            │░░│   ●  lamp   │▒▒│             │  │
  └Cl┘            └Cl┘  /          └Cl┘             └Cl┘
   o              o─┘ arm up        o  leaning       o
  ╒╧╕ on keys     ╒╧             ╲ ╧╕ back          ╧   hands in lap
```

**Priority.** `--needs` amber appears on the page in exactly two places: the lamp and
the bubble of a `needs_you` desk. `--work` blue appears only on a working screen. Every
other pixel is a neutral. So one amber lamp in a grey room is the loudest thing on the
page by construction; two rooms with lamps are two loud things, and that is correct.
Room walls and floors never tint by state. The document title shows `(n) Office` with
the `needs_you` count, as the board does.

**Reading-distance test** (must pass before merge): render the four seated postures at
24 px tall, no text, no colour (`--fg-2` on `--bg-2`). They must still be told apart by
silhouette alone: raised arm (needs_you), leaning back (stale), hands in lap and no
screen rectangle (idle), hands forward under a screen rectangle (working). Then add the
colour and check the lamp is visible at 2 m on a laptop.

## 3. Facts on the figure

```
   Fix flaky auth test          ← title, 11px `--fg`, ellipsis at 92 px
          ●                     ← lamp (needs_you only)
       ┌──────┐
       │ Bash │                 ← screen: current tool, 9px mono, ≤ 5 chars + …
       └──Cl──┘                 ← harness monogram on the bezel, harness hue
      ════╤════ sessionpipe @ mp/off… ← desk front: repo @ branch, 9px mono
         o  ▪                   ← figure; ▪ = error sheets, desk corner
        ╒╧╕          ·· +2      ← helpers standing right of the desk
         2m 10s                 ← long-running tool, under the desk
```

- **Monogram**: `harnessMark(s.harness).glyph` centred on the monitor's bottom bezel,
  9 px, `oklch(0.55 0.1 hue)`; it is the only per-harness colour and it is quiet.
- **Screen text**: `currentTool.tool`, 9 px mono on the lit screen, white on `--work`.
  Width allows 5 characters; longer names cut to 4 + `…` (`WebF…`). Full name in the
  tooltip. No text on a screen that is not lit.
- **Title**: `sessionTitle(s)` above the desk. One line, ellipsis. Always shown.
- **Desk front**: `repoBranch(s)` ellipsised from the *left* so the branch end stays
  (`…pipe @ mp/office`). Empty when neither repo nor branch is known.
- **Errors**: `counts.toolErrors` → a stack of sheets on the desk's right corner: 1 sheet
  for 1–2, 2 for 3–5, 3 for 6+. `--fg-4`, 6 × 4 px each, offset 1 px. No red. When the
  count rises, the new top sheet slides in from 3 px above once (200 ms). Tooltip: `3
  tool errors`.
- **Long-running tool**: when `now - currentTool.since > 60 s`, a `--fg-3` numeral under
  the desk shows the elapsed time (`durShort`), ticking once a second. Nothing before
  60 s: a quick tool should look quick.
- **Typing**: the figure types only while `progress.assistant` *grew* in the last 3 s.
  Track `(length, at)` of the previous summary; a tool running does not type (the screen
  is busy instead). This splits "the model is writing" from "a tool is running" without
  a word.
- **Helpers**: §1. A helper's own posture is a reduced copy: standing straight with a
  screen-less stance for working, raised arm + lamp for needs_you, `--fg-3` for idle.
- **Elapsed state**: on hover only (§6); not drawn on the desk.

## 4. Motion rules

The whole vocabulary. Anything not here does not move.

| name        | what                                        | duration / rate            | easing                 | plays            |
|-------------|---------------------------------------------|----------------------------|------------------------|------------------|
| typing      | hands up / down 1 px, 2 frames              | 2 Hz (500 ms period)       | `steps(2)`             | loops while §3 typing |
| breathing   | torso `scaleY` 1 → 1.03, origin at the lap  | 4 s period                 | ease-in-out            | loops on idle and stale only |
| hand raise  | arm 0° → 60°, head turns to the room        | 240 ms up, 180 ms down     | `--ease-out` / `--ease-in` | once on entering / leaving needs_you |
| walk        | translateX door → desk column, legs 2 frames | 600 ms + 150 ms step up to the row; legs 4 Hz | linear, legs `steps(2)` | once on arrive / leave |
| sit / stand | figure drops 4 px onto the chair            | 200 ms                     | `--ease-out`           | once after walk-in / before walk-out |
| bubble pop  | `scale(0.8)→1`, opacity 0 → 1               | 160 ms                     | `--ease-out`           | once per new `attentionId` |
| lamp        | opacity 0 → 1 / 1 → 0                       | 300 ms on, 600 ms off      | linear                 | once per change  |
| screen      | crossfade old → new text / fill             | 120 ms                     | linear                 | once per change  |
| leave fade  | opacity 1 → 0 at the door jamb              | 200 ms                     | linear                 | once             |
| sheet       | error sheet slides in from 3 px above       | 200 ms                     | `--ease-out`           | once per rise    |

- Working figures do not breathe; typing is their life sign. A `needs_you` figure is
  perfectly still after the raise: stillness next to a lamp draws the eye.
- Typing loops are offset by `(slot % 4) × 125 ms` so a row never types in unison.
- **Calm budget**: at most **6 walks** at a time; further arrivals queue, and anyone
  queued longer than 2 s appears seated with a 200 ms fade instead. At most **12
  typing** loops; beyond that, the oldest typers hold hands-on-keys still. Breathing is
  off entirely when more than 24 figures are on the page. Priority when the budget is
  short: hand raise › walk › typing › breathing. Forty workers must look like a quiet
  floor, not a casino.
- Use CSS animations and `transform`/`opacity` only; no JS per frame. One `useNow()`
  tick per second drives elapsed numerals.
- **`prefers-reduced-motion: reduce`**: no walks (200 ms fade in place), no typing
  (hands rest on the keys), no breathing, no bubble pop or sheet slide (appear at once),
  lamp and screen switch instantly. The raised arm is a static pose and stays.
- Tab hidden (`document.hidden`): all loops pause.

## 5. Time and ambience

- The window is a flat band, tinted by the **viewer's** local hour (machine clocks are
  unknown): 06–11 `oklch(0.93 0.02 230)`, 11–17 `oklch(0.95 0.015 85)`, 17–21
  `oklch(0.88 0.05 60)`, 21–06 `oklch(0.3 0.03 250)`. Dark scheme: multiply lightness by
  0.6 for the first three; night stays. Transition over 60 s at a boundary. No sun, no
  sky, no gradient, no stars.
- That is the whole ambience. No clock hands, no plants, no flicker, no idle loops.
  When no session changes, the only motion on the page is typing (and breathing on
  idle figures, which stops at 24+ workers). A stopped screenshot and a live page should
  be hard to tell apart.

## 6. Interaction

- **Hover / focus** (150 ms delay, no animation; `role="tooltip"`), in this order:
  title · `harnessMark.label` + `modelShort(model)` · `STATE_LABEL[state]` since
  `stateSince` · current tool + elapsed · attention kind + `<Redacted message>` ·
  `repoBranch` · `turns · tools · errors · files · subagents` (zeros omitted, as the
  card footer does). Helpers get their own tooltip with the same shape.
- **Click / Enter** on a desk or helper → `sessionPath(harness, id)`. Nameplate →
  `/machines`. Tally and window are not interactive.
- **Keyboard**: desks are `<a>` in DOM order = room name order, then slot index; helpers
  follow their parent. `j`/`k`/Enter via `useListNav` over that same href list, with
  `data-cursor` on the cell; `?` toggles the legend; Esc closes it (`data-dismiss`) or
  goes back. Focus ring = `--focus`, 2 px, outside the cell. `/` does nothing here: the
  office has no search; the Board does.
- **Empty office**: one room named `no machines yet` with two empty desks, the window
  lit for the hour, and under it the three ways from `EmptyBoard` in one line each plus
  the `Open Connect` button. No figure.
- **Legend** behind a `?` button at the page's top-right (and the `?` key): a panel
  with the four postures drawn at 24 px with their labels and `STATE_HINT`, then the
  lamp, bubble, helper, sheets, monogram and elapsed numeral, one line each. The page
  must read without it; it exists to confirm, not to teach.

## 7. What not to do

- No faces, no expressions, no hair, no clothes colour: a head is a circle.
- No emoji, no icons on screens, no logos; the monogram is text.
- No particles, confetti, sparkles, glows, drop shadows or gradients.
- No sound.
- No points, levels, streaks, productivity scores, or "worker of the day".
- No decoration without a fact behind it: every drawn thing maps to a field in
  `SessionSummary` or `MachineSummary`, or it is not drawn.
- No colour outside the tokens; no second accent; amber means needs_you and nothing
  else, blue means working and nothing else.
- No movement that is not in the §4 table.

## 8. Theme system note

The office is a renderer of a theme-neutral `Posture`, derived once per session outside
the theme (`themes/posture.ts`): `{ state, typing, screen?, longRunning, errors: 0–3,
attention?, helpers, phase: "arriving" | "seated" | "leaving" }`, plus the slot map,
calm budget, tooltip and keyboard order, which are shared. A theme exports `{ Room,
Worker, Helper, Legend }` and a sprite set for the four postures and the walk. A train
yard maps machine→platform, session→carriage, needs_you→signal lamp, typing→steam;
an orchestra maps machine→section, session→chair, needs_you→raised bow. Same facts,
same motion table, same reading-distance test; only the drawings change.
