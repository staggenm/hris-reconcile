# Style Guide — Data Reconciliation Tool (standalone HTML)

**Version 2.0 · 2026-10-17** · replaces v1.0 (2026-10-16, see git history)

**Scope.** One HTML file that runs in the browser. The user drops two tables
(File A and File B), picks the key, compares, and reads or exports the
differences.

**In one line.** A quiet instrument panel on white paper: zinc greys, hairline
borders, one emerald signal for "do this next", and colour only where the
data needs attention.

**What changed from v1.0.** v2.0 adopts the look of a modern data console
(reference: the Podscan.fm style notes): pure white canvas, zinc neutrals
instead of blue-slate, borders instead of shadows, an emerald action colour
instead of teal, slightly tighter type, and a neutral "Match" status. The
three-step flow, the A/B colours, the status words and every privacy rule
stay as they were. Token **names** are unchanged, so the migration is mostly
value swaps (§11).

---

## 1. Principles

1. **Colour the exceptions, not the matches.** Matching rows, and now the
   Match badge itself, stay neutral grey. Only differences, missing rows and
   problems get colour, so the eye goes straight to what needs action.
2. **One signal colour.** Emerald means "act here": the one primary button,
   focus, the progress bar and the current step. It is never used for a data
   status. The single exception is the all-clear verdict ("Both files match").
3. **A and B are always the same two colours.** File A is blue and File B is
   amber, everywhere: drop zones, column pickers, table sub-headers, badges.
4. **Text first.** Every status has a word and an icon, not just a colour.
   Colour-blind safe, and it survives printing and copy-paste.
5. **One screen, top to bottom:** 1 Load → 2 Match settings → 3 Results. No
   tabs and no modals for the main flow.
6. **The data is the hero.** No illustrations, patterns or decorative
   imagery. The results table and the verdict line do the talking.
7. **Flat and border-driven.** Surfaces are separated by 1 px hairlines.
   Shadows appear only on things that float (menus, toasts) and on hover.

---

## 2. Design tokens (copy into `:root`)

```css
:root {
  color-scheme: light dark;

  /* Neutrals (zinc) */
  --bg:            #FFFFFF;  /* page canvas: pure white, never off-white */
  --surface:       #FFFFFF;  /* cards and tables sit on the canvas, separated by borders */
  --surface-2:     #F4F4F5;  /* "fog": table headers, disclosure bodies, chips */
  --border:        #E5E7EB;  /* the universal hairline */
  --border-strong: #D4D4D8;  /* inputs, hover borders */
  --text:          #18181B;  /* "onyx": primary text, headings */
  --text-muted:    #52525B;  /* labels, table headers, secondary text (AA on fog) */
  --text-subtle:   #71717A;  /* helper text, captions, metadata — on white only */
  --text-faint:    #A1A1AA;  /* placeholders, disabled, "—" for empty — never meaning */

  /* Signal (actions, focus) */
  --accent:        #047857;  /* emerald 700: button fill, links (5.5:1 with white) */
  --accent-hover:  #065F46;
  --accent-mark:   #059669;  /* emerald 600: non-text marks — ring, bars, step dot */
  --accent-soft:   #ECFDF5;  /* mint wash */
  --on-accent:     #FFFFFF;
  --focus-ring:    0 0 0 3px rgba(5, 150, 105, .28);

  /* Neutral authority action */
  --onyx:          #18181B;
  --onyx-hover:    #3F3F46;
  --on-onyx:       #FFFFFF;

  /* Source identity */
  --a:             #2563EB;  /* File A — cobalt */
  --a-soft:        #EFF6FF;
  --b:             #B45309;  /* File B — amber (dark, for text contrast) */
  --b-soft:        #FFFBEB;

  /* Status */
  --ok:            #047857;  --ok-soft:   #ECFDF5;   /* all-clear verdict only */
  --diff:          #B91C1C;  --diff-soft: #FEF2F2;   /* value differs, errors */
  --warn:          #A16207;  --warn-soft: #FEFCE8;   /* duplicate / blank key */
  --info:          #52525B;  --info-soft: #F4F4F5;   /* match, ignored, tolerance hit */

  /* Type — system stack only (no web fonts: zero network, strict CSP) */
  --font-ui:   "Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 14px; --fs-lg: 16px;
  --fs-xl: 20px; --fs-2xl: 24px; --fs-3xl: 30px;
  --track-tight: -0.02em;   /* headings ≥ 20 px, KPI numbers */
  --track-ui:    -0.011em;  /* body and controls */
  /* Table cells and mono: 0 — never tighten digits. */

  /* Space (4-pt grid) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;

  /* Radius */
  --radius-sm:   8px;     /* buttons, inputs, selects, inline messages */
  --radius:      12px;    /* cards, drop zones, table card, menus */
  --radius-pill: 9999px;  /* badges, chips, file chip, brand mark — nothing else */

  /* Elevation — flat by default */
  --shadow:     0 1px 2px rgba(0, 0, 0, .05);                                          /* hover lift */
  --shadow-pop: 0 10px 15px -3px rgba(0, 0, 0, .10), 0 4px 6px -4px rgba(0, 0, 0, .10); /* menus, toast */
  --shadow-cta: 0 10px 15px -3px rgba(5, 150, 105, .20), 0 4px 6px -4px rgba(5, 150, 105, .20); /* primary hover */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:#09090B; --surface:#09090B; --surface-2:#18181B;
    --border:#27272A; --border-strong:#3F3F46;
    --text:#FAFAFA; --text-muted:#D4D4D8; --text-subtle:#A1A1AA; --text-faint:#71717A;
    --accent:#10B981; --accent-hover:#34D399; --accent-mark:#10B981;
    --accent-soft:#052E22; --on-accent:#022C22;
    --focus-ring:0 0 0 3px rgba(16, 185, 129, .35);
    --onyx:#FAFAFA; --onyx-hover:#D4D4D8; --on-onyx:#18181B;
    --a:#60A5FA; --a-soft:#172036; --b:#FBBF24; --b-soft:#2B2110;
    --ok:#34D399; --ok-soft:#052E22; --diff:#F87171; --diff-soft:#3A1717;
    --warn:#FACC15; --warn-soft:#2E270C; --info:#A1A1AA; --info-soft:#18181B;
    --shadow:0 1px 2px rgba(0, 0, 0, .5);
    --shadow-pop:0 10px 15px -3px rgba(0, 0, 0, .6), 0 4px 6px -4px rgba(0, 0, 0, .5);
    --shadow-cta:0 10px 15px -3px rgba(16, 185, 129, .25);
  }
}
```

**Contrast (measured).**
- White on `--accent` #047857 is 5.5:1. The reference's #059669 is only
  3.8:1 with white text, so it is kept for non-text marks (`--accent-mark`).
- `--text-subtle` #71717A is 4.8:1 on white but **4.4:1 on fog**, so on
  `--surface-2` (table headers, disclosures) use `--text-muted` #52525B
  (7.0:1).
- `--text-faint` #A1A1AA is 2.6:1. Use it only for placeholders, disabled
  controls and the "—" empty marker, never for information.
- All status and A/B text tokens are ≥ 4.7:1 on white and on their own
  `-soft` fill, in both themes.

---

## 3. Typography

| Use | Size / weight / tracking | Font |
|---|---|---|
| Verdict line ("37 differences in 1,204 employees") | 24 / 600 / tight | UI |
| Page title (app bar) | 16 / 600 / tight | UI |
| Section title ("1 Load files") | 20 / 600 / tight | UI |
| Body, controls, buttons | 14 / 400–500 (buttons 600) / ui | UI |
| Labels | 13 / 500, `--text-muted` / ui | UI |
| Helper text, captions | 13 / 400, `--text-subtle` / ui | UI |
| Table cells | 13 / 400 / 0 | UI for text, **mono** for numbers, IDs, dates |
| Table headers | 12 / 600, `--text-muted` / 0 | UI |
| KPI numbers | 30 / 700 / tight, tabular figures | UI |

- **Weight 700 only for KPI numerals** (the reference reserves it for price
  numerals). Everything else is 400, 500 or 600.
- **Tight tracking is for words, not data.** Negative letter-spacing makes
  headings and controls read like a console, but digits in tables keep their
  natural width so columns align and `1,250.00` vs `1.250,00` stay legible.
- **Sentence case** everywhere ("Compare files", not "COMPARE FILES").
- **Line length:** helper text ≤ 80 characters.

---

## 4. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ (Reconcile) HRIS · two-file check         [Reset]  [■ Export] │  app bar 56 px, white,
├───────────────────────────────────────────────────────────────┤  1 px bottom border
│ ① Load files                                                  │
│ ┌──── File A ─────────────────┐ ┌──── File B ─────────────────┐│
│ │  ⬆ Drop CSV / XLSX or browse │ │  ⬆ Drop … or browse         ││
│ └──────────────────────────────┘ └─────────────────────────────┘│
│ ② Match settings   Key [Employee ID ▾] = [EmpNo ▾]   [Compare] │
│ ③ Results                                                      │
│   37 differences in 1,204 employees                            │  verdict line
│   ✓ 1,204 rows in A · 1,198 in B · 14 columns compared         │  stat line
│   [1,160 Match] [37 Differ] [5 Only in A] [2 Only in B]        │  KPI tiles = filters
│   ⌕ Search ______________ /        Filters: (Differences ✕)    │
│   ┌ table (sticky header, sticky Status + Key) ─────────────┐  │
└───────────────────────────────────────────────────────────────┘
```

- **Width:** max content width 1280 px, centred (wider than the reference's
  1200 px because results tables are wide). Gutter `--s5`, `--s4` below
  768 px.
- **Rhythm:** 24 px (`--s5`) between step cards, 24 px card padding, 16 px
  between elements inside a card.
- **Stacking:** below 768 px the drop zones stack, KPI tiles go two-up, and
  the table scrolls horizontally inside its card, never the page.
- **Steps:** each step is a card: `--surface`, 1 px `--border`, `--radius`,
  **no shadow**.
- **Step marker:** a 28 px circular disk before each title.
  - Current step: `--accent-soft` disk with an `--accent` number.
  - Done: `--accent-mark` disk with a white ✓.
  - Locked: `--surface-2` disk with a `--text-faint` number.
- **Locked steps:** the card keeps full opacity, but the title is
  `--text-subtle` and a helper line explains what unlocks it ("Load both
  files to continue"). This replaces v1.0's 50% fade, which made the text
  fail contrast.

---

## 5. Components

**App bar**
- White, 56 px, 1 px bottom `--border`, sticky, no shadow.
- **Brand mark:** a pill (`--radius-pill`) in `--onyx` with the white
  wordmark "Reconcile", 13 / 600, padding 4 × 12 px. Next to it is the
  subtitle in `--text-subtle`.
- **Right side:** Reset (ghost) and Export (Onyx button, see below).
- **Below 768 px:** the brand mark and subtitle hide; the title stays.
- **Progress:** a 2 px `--accent-mark` indeterminate bar along the bottom
  border, with the step text ("Comparing 12,400 rows…") in a small bordered
  label under it.

**Buttons** (height 36 px, padding 0 × 16 px, 14 / 600, radius `--radius-sm`)

| Kind | Fill | Text | Border | Use |
|---|---|---|---|---|
| Primary | `--accent` | `--on-accent` | none | **One per screen:** Compare |
| Onyx | `--onyx` | `--on-onyx` | none | The neutral main action when Compare isn't on screen: Export |
| Outline | `--surface` | `--text` | 1 px `--border` | Secondary actions next to a filled one |
| Ghost | none | `--text-muted` | none | Reset, Clear, Replace |
| Link | none | `--accent`, underlined | none | Inline actions in messages and hints |

- **Hover:**
  - Primary: `--accent-hover` plus `--shadow-cta`.
  - Onyx: `--onyx-hover`.
  - Outline: border becomes `--border-strong`, plus `--shadow`.
  - Ghost: `--surface-2` fill.
- **Disabled:** `--surface-2` fill, `--text-faint` text, no shadow. Always say
  why in helper text next to it.
- **Never** two emerald buttons in the same row. If a second action is
  needed, it is Outline or Onyx.

**Inputs and selects**
- 36 px high, 1 px `--border-strong`, radius `--radius-sm`, 14 / 400,
  padding 0 × 12 px, placeholder `--text-faint`.
- Focus: border `--accent-mark` plus `--focus-ring`; no other shadow.
- The label sits above the field (13 / 500 `--text-muted`), never only a
  placeholder.
- **A/B pickers** keep a 3 px top border in the file colour.

**Search field**
- Same as an input, with a 16 px search glyph inside on the left
  (`--text-subtle`) and a `/` key hint on the right (mono 11 px, 1 px
  `--border`, radius 4 px).

**Drop zone**
- **Empty:** 1.5 px dashed `--border-strong`, `--radius`, min-height 140 px.
  It shows a 40 px icon disk (`--surface-2` disk, `--text-subtle` upload
  glyph) and "Drop a CSV or Excel file here, or **browse**".
- **File chip:** a pill in the top-left, "File A" (`--a` on `--a-soft`) /
  "File B" (`--b` on `--b-soft`), 12 / 600.
- **Drag-over / hover:** solid border in the file colour with the `-soft`
  fill.
- **Loaded:** a solid 1 px `--border` card with a 3 px top border in the file
  colour. It shows a 40 px tinted icon disk (file colour on its `-soft`), the
  file name 14 / 600, and "1,204 rows × 18 columns · sheet Payroll" in
  `--text-subtle`, plus a "Replace" ghost button.
- **Error:** `--diff` border with one plain sentence below.

**Column list** (match settings)
- One bordered list (`--radius`), rows separated by hairlines, 12 × 16 px
  row padding, no zebra.
- Excluded rows fade their controls to 50%. Text stays readable because
  the include checkbox and the column name don't fade.
- Hint tags ("Looks like dates in DMY") in `--accent`, 13 / 600. "Values
  differ in format" hints in `--warn`.

**Chips** (active filters, translation groups)
- Pill, `--surface-2` fill, 1 px `--border`, 13 / 500, height 28 px, with a
  trailing ✕ in `--text-subtle`. Hover: border becomes `--border-strong`.

**Stat line** (new — under the verdict)
- One row of 2–4 facts, separated by `·` in `--text-faint`. Each fact is
  a bold value (14 / 600 `--text`) plus a descriptor (14 / 400
  `--text-muted`), e.g. "**1,204** rows in A · **1,198** in B · **14**
  columns compared".
- There is no card behind it; it sits directly on the step card. No icon:
  a green ✓ next to "37 differences" would read as a status.

**KPI tiles** (also the filters)
- White, 1 px `--border`, `--radius`, padding 16 px. The number is
  30 / 700 tight, with a 13 / 500 label and an 18 px icon square below it.
- **Hover:** border becomes `--border-strong`, plus `--shadow`.
- **Active filter:** 2 px border in the tile's colour (padding reduced by
  1 px so nothing jumps).
- **Zero:** the number shows in `--text-faint`, and the tile stays
  clickable.

| Tile | Number colour | Icon (on `-soft` square) | Click |
|---|---|---|---|
| Match | `--text` | ✓ `--info` | filter: matched |
| Differ | `--diff` | ≠ | filter: differences |
| Only in A | `--a` | A | filter |
| Only in B | `--b` | B | filter |
| Warnings (duplicates, blank keys) | `--warn` | ! | filter, hidden when 0 |

**Status badges** (first column of the results)
- Pill, 12 / 600, padding 2 × 10 px, `-soft` fill with text in the strong
  colour.
- Always icon + word: `✓ Match` (neutral: `--info` on `--info-soft`),
  `≠ Differs`, `A Only in A`, `B Only in B`, `! Duplicate key`.

**Differences by column** (bar list)
- Rows 36 px, name, 6 px track (`--surface-2`, pill) with a `--diff` fill,
  and a count in `--text-muted` tabular.
- **Hover:** `--surface-2` row.
- **Active filter:** `--accent-soft` row with a 2 px `--accent-mark` left
  bar.

**Menu** (Export)
- A white panel with 1 px `--border`, `--radius`, `--shadow-pop`, 8 px
  padding.
- Group labels are 12 / 600 `--text-subtle`, sentence case.
- Each item is 14 / 500 with a 12 px `--text-subtle` description below.
- **Hover:** `--surface-2`.

**Disclosure** ("Show more options", "Why this key?")
- The summary is 13 / 500 `--text-muted` with a chevron, and becomes
  `--text` on hover.
- The body is `--surface-2`, `--radius-sm`, 12 px padding.

---

## 6. Results table

- **Structure:**
  - the table lives in a bordered card (`--radius`) and scrolls inside it;
  - the sticky header is `--surface-2`, 12 / 600 `--text-muted`;
  - the sticky first columns are Status and Key;
  - rows are 36 px high (the reference's feed rows are 56–64 px; ours stay
    compact because users scan hundreds).
- **Row dividers:** 1 px `--border` between rows. No zebra stripes, since
  they would compete with the difference fills.
- **Paired columns:** for each compared field, show **A | B | Δ** under a
  grouped header. The A and B sub-headers carry a 3 px top rule in the file
  colour.
- **Differences:**
  - a differing cell pair gets a `--diff-soft` fill;
  - Δ is shown in `--diff` 600, signed (`+1,250.00` / `−3.00`);
  - text differences show "≠" in the Δ column;
  - matching cells stay plain.
- **Missing side:** `—` in `--text-faint` on the absent side; the row badge
  says "Only in A" / "Only in B".
- **Alignment:** numbers right-aligned in mono, text left-aligned.
- **Number formats:**
  - thousands separators, with decimals as in the source (max 2 for amounts);
  - dates as ISO `2026-10-17`;
  - IDs as text, so leading zeros are kept.
- **Row states:**
  - hover in `--surface-2`;
  - a selected row gets a 2 px `--accent-mark` left rule.
- **Empty state:** centred, with a 40 px `--ok-soft` disk holding a `--ok` ✓,
  and "No differences — both files match on 1,204 rows." in `--ok`. This is
  the one place green means "status".
- **Large files** (more than 5,000 rows): paginate with "Show more", and
  always show the total count.

---

## 7. Feedback and messages

- **Inline messages:** shown inside the relevant card, never as `alert()`.
  - Layout: `-soft` background, 1 px border in the status colour at 25%
    (`color-mix(in srgb, var(--diff) 25%, transparent)`), `--radius-sm`.
  - Content: icon + one sentence + optional link action.
  - Tones: error `--diff`, warning `--warn`, success `--ok`, info
    `--info`, tip `--accent`.
  - v1.0's 3 px left bar is dropped. Fully rounded, lightly bordered
    callouts match the rest of v2.0.
- **Tone of voice:** plain and specific. Say what happened and what to do
  next:
  - ✗ "Error parsing input"
  - ✓ "Row 12 in File B has 9 columns, the header has 8. Check the delimiter
    (currently ';')."
- **Progress:** the app-bar bar plus step text. Never block the whole screen.
- **Toast** (bottom right, 4 s): `--onyx` fill, `--on-onyx` text, `--radius`,
  `--shadow-pop`. Only for confirmations such as "Exported differences.csv".

---

## 8. Interaction details

- **Keyboard:**
  - every control is reachable with Tab, with a visible focus ring;
  - Enter on a drop zone opens the file picker;
  - `/` focuses search.
- **Motion:**
  - 120–160 ms ease-out on hover and focus only;
  - the KPI and outline hover lift is a shadow change, not movement;
  - respect `prefers-reduced-motion`.
- **Remembering settings:** in memory only, for the life of the tab. No
  `localStorage`, `sessionStorage` or IndexedDB (privacy rule, superseding
  v1.0 §8).
- **Privacy note** in the footer, in `--text-subtle`: "Files are processed in
  this tab and never uploaded or stored."
- **Export:** one menu with readable exports first and "For audits"
  (technical JSON/CSV) below.

---

## 9. Don'ts

- **No new hues.** The palette is zinc + emerald (action) + cobalt (A) +
  amber (B) + crimson (differs) + yellow (warn). No purple, pink, violet or
  teal; violet would sit too close to File A's blue for colour-blind users.
- **No emerald for data status,** except the all-clear verdict and empty
  state.
- **No gradients, glass, blur or decorative imagery.** `--shadow-pop` is the
  heaviest shadow and only for floating layers.
- **No off-white or warm-grey canvas.** The page is pure white (zinc-950 in
  dark mode).
- **Radius:** nothing above 12 px, and no pill radius on cards, inputs or
  buttons.
- **No 700 weight** outside KPI numerals.
- **No negative tracking** on table cells or mono text.
- **No colour-only status,** and no red / green as the only distinction.
- **No more than one primary button per view.**
- **No ALL-CAPS labels,** no centred table text, and no icons without labels
  in the main flow.
- **No raw technical errors** (stack traces, `undefined`) shown to the user.
- **No web fonts, CDNs or anything network-capable.** Fonts are
  system-installed only.

---

## 10. Taken from the reference, and what was left out

| Taken | Left out, and why |
|---|---|
| Pure white canvas, zinc greys, `#E5E7EB` hairlines | 60 px display hero and marketing layout: this is a tool, not a landing page |
| One emerald action colour; Onyx as the neutral main action | Emerald #059669 as a text background: fails AA with white text, so the fill is #047857 |
| Border-first, near-flat elevation; green-tinted CTA hover shadow | Violet / pink / teal categorical hues: we already have A/B and status colours |
| Pill badges, chips and brand mark; 8 px buttons, 12 px cards | 12 px radius on inputs: too round for dense 36 px controls |
| Tight tracking on headings and UI text | −0.4 px tracking at 12–14 px everywhere: hurts digit legibility in tables |
| Tinted icon disks (step markers, drop zones, empty state) | Inter Tight web font: no network, strict CSP; system stack instead |
| Stat line; 30 / 700 numerals (from price numerals) | Light-only theme: we keep a full dark mode |
| Neutral "Neutral" sentiment badge → neutral Match badge | 56–64 px feed rows: results stay at 36 px |

---

## 11. Migration from v1.0

1. **Swap the token values** in `src/web/app.css` `:root` and the dark block
   for §2.
   - Add the new tokens: `--text-subtle`, `--accent-mark`, `--onyx*`,
     `--shadow-pop`, `--shadow-cta`, `--radius-pill`, `--fs-3xl`, `--s7`
     and the tracking tokens.
   - Update the dark-mode select chevron colour to match `--text-subtle`.
2. **Flatten the cards.**
   - Remove `box-shadow: var(--shadow)` from `.step`, `.kpi` and
     `button.primary`.
   - Set `.step`, `.dropzone`, `.table-card` and `.menu-panel` to `--radius`
     (12 px). Set buttons and inputs to `--radius-sm` (8 px).
3. **Retone the text.**
   - Helper text and captions on white use `--text-subtle`.
   - Labels and table headers keep `--text-muted`.
4. **Match becomes neutral.**
   - Change `.badge[data-status="match"]` and `.kpi[data-tone="ok"]` to
     `--info` / `--info-soft`.
   - Keep `--ok` for `.verdict.ok`, `.empty-state.ok` and `message[data-tone="ok"]`.
5. **Buttons.**
   - Add `button.onyx` and use it for Export.
   - Restyle `button.secondary` as Outline (`--border`).
   - Add the `--shadow-cta` hover to primary.
6. **New pieces:** the brand pill, step-marker disk states, drop-zone icon
   disks, the stat line, KPI numbers at 30 / 700, and messages without the
   left bar.
7. **Locked steps:** replace `opacity: .5` with the subtle title and helper
   text.
8. **Check:**
   - contrast in both themes;
   - a 375 px width;
   - `prefers-reduced-motion`;
   - that no colour literal remains outside `:root` (search for `#`, `rgb(`
     and `rgba(`, except the token blocks and the data-URI icons).
