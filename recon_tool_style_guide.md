# Style Guide — Data Reconciliation Tool (standalone HTML)

**Version 1.0 · 2026-10-16**

**Scope.** One HTML file that runs in the browser. The user drops two tables
(File A and File B), picks the key, compares, and reads or exports the
differences.

**Principles,** borrowed from the PCP Template's design system:
- tokens instead of ad-hoc values;
- a calm palette;
- colour by role;
- status never shown by colour alone;
- readable number formats.

---

## 1. Principles

1. **Colour the exceptions, not the matches.** Matching rows stay neutral.
   Only differences, missing rows and errors get colour, so the eye goes
   straight to what needs action.
2. **One accent colour.** Teal is used for primary actions and focus only.
   Everything else is neutral slate. No purple, and no gradients.
3. **A and B are always the same two colours.** File A is blue and File B is
   amber, everywhere: drop zones, column headers, "only in A / only in B"
   badges and legends.
4. **Text first.** Every status has a word and an icon, not just a colour.
   This makes it colour-blind safe and keeps it intact when printed or copied.
5. **One screen, top to bottom:** 1 Load → 2 Match settings → 3 Results. No
   tabs and no modals for the main flow.
6. **Data is the hero.** Tables are dense but calm: monospace digits,
   right-aligned numbers, sticky headers, no zebra noise.

---

## 2. Design tokens (copy into `:root`)

```css
:root {
  /* Neutrals (slate) */
  --bg:            #F7F8FA;  /* page background */
  --surface:       #FFFFFF;  /* cards, tables */
  --surface-2:     #F1F3F6;  /* table header, subtle fills */
  --border:        #E2E6EB;
  --border-strong: #C9D0D8;
  --text:          #1C2430;  /* primary text */
  --text-muted:    #5B6675;  /* labels, secondary */
  --text-faint:    #8A94A3;  /* placeholders, disabled */

  /* Accent (actions, focus) */
  --accent:        #0F766E;  /* teal 700 */
  --accent-hover:  #115E59;
  --accent-soft:   #E6F4F2;
  --focus-ring:    0 0 0 3px rgba(15,118,110,.35);

  /* Source identity */
  --a:             #2563EB;  /* File A — blue */
  --a-soft:        #EAF1FE;
  --b:             #B45309;  /* File B — amber (dark, for text contrast) */
  --b-soft:        #FEF5E7;

  /* Status */
  --ok:            #15803D;  --ok-soft:   #EAF6EE;   /* match */
  --diff:          #B91C1C;  --diff-soft: #FDECEC;   /* value differs */
  --warn:          #A16207;  --warn-soft: #FEF8E6;   /* duplicate key, type issue */
  --info:          #475569;  --info-soft: #EEF1F5;   /* ignored, tolerance hit */

  /* Type */
  --font-ui:   "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 14px; --fs-lg: 16px;
  --fs-xl: 20px; --fs-2xl: 24px;

  /* Space (4-pt grid), radius, shadow */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --radius-sm: 6px; --radius: 10px;
  --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0F141A; --surface:#161C24; --surface-2:#1D2530;
    --border:#2A3441; --border-strong:#3A4655;
    --text:#E6EAF0; --text-muted:#A3ADBB; --text-faint:#6F7A89;
    --accent:#2DD4BF; --accent-hover:#5EEAD4; --accent-soft:#12302D;
    --a:#60A5FA; --a-soft:#14243B; --b:#FBBF24; --b-soft:#33270F;
    --ok:#4ADE80; --ok-soft:#12291B; --diff:#F87171; --diff-soft:#3A1717;
    --warn:#FACC15; --warn-soft:#332A0C; --info:#94A3B8; --info-soft:#1E2631;
  }
}
```

**Contrast.** All text tokens meet WCAG AA (≥ 4.5:1) on `--surface` and on
their own `-soft` fill. Amber text uses `#B45309`, not a lighter yellow.

---

## 3. Typography

| Use | Size / weight | Font |
|---|---|---|
| Page title | 24 / 600 | UI |
| Section title ("1 Load files") | 16 / 600 | UI |
| Body, controls | 14 / 400 | UI |
| Labels, helper text | 13 / 500, `--text-muted` | UI |
| Table cells | 13 / 400 | UI for text, **mono** for numbers, IDs, dates |
| KPI numbers | 20 / 600, tabular figures | UI with `font-variant-numeric: tabular-nums` |

- **Sentence case** everywhere ("Compare files", not "COMPARE FILES").
- **Line length:** helper text ≤ 80 characters.

---

## 4. Layout

```
┌──────────────────────────────────────────────────────────┐
│ Reconcile two files                     [Reset] [Export] │  header, 56 px
├──────────────────────────────────────────────────────────┤
│ 1 Load files                                             │
│ ┌─────────── File A ──────────┐ ┌─────────── File B ────┐│  two drop zones
│ │  ⬆ Drop CSV / XLSX or browse │ │  ⬆ Drop … or browse  ││  side by side
│ └──────────────────────────────┘ └───────────────────────┘│
│ 2 Match settings   Key [Employee ID ▾]  Tolerance [0.01]  │
│                    Columns to compare [chips…]  [Compare] │
│ 3 Results                                                 │
│ [ 1,204 matched ] [ 37 differ ] [ 5 only in A ] [ 2 only in B ] │  KPI tiles = filters
│ Search [______]  Show: (All) (Differences) (Only A) (Only B)    │
│ ┌ table (sticky header, sticky key column) ─────────────┐ │
└──────────────────────────────────────────────────────────┘
```

- **Width:** max content width 1280 px, centred; page gutter `--s5`, or
  `--s4` below 768 px.
- **Stacking:** below 768 px the drop zones stack, and the table scrolls
  horizontally inside its card, never the page.
- **Sections:** each step is a card (`--surface`, `--border`, `--radius`,
  `--shadow`, padding `--s5`). A step number in a 24 px circle (accent-soft /
  accent) precedes each title.
- **Locked steps:** steps not yet available are shown at 50% opacity, with a
  helper line ("Load both files to continue").

---

## 5. Components

**Drop zone**
- **Style:**
  - 2 px dashed `--border-strong`, `--radius`, min-height 140 px;
  - centred icon plus "Drop a CSV or Excel file here, or **browse**";
  - a coloured label chip on top, "File A" (blue) / "File B" (amber).
- **Hover / drag-over:** solid border in the file colour, `-soft` fill.
- **Loaded:** a compact summary card instead of the dashed area, showing the
  file name, rows × columns and the detected sheet / delimiter, plus a
  "Replace" link.
- **Error:** `--diff` border with the message below in plain words, e.g. "This
  file has no header row".

**Buttons**
- **Primary** (one per screen, "Compare"): `--accent` fill, white text,
  height 36 px, radius `--radius-sm`.
- **Secondary:** `--surface` background, `--border-strong` border,
  `--text`.
- **Ghost** (Reset, Clear): text only, `--text-muted`.
- **Disabled:** `--text-faint` with no shadow. Always explain why in a
  tooltip or helper text.

**Inputs and selects**
- 36 px high, 1 px `--border-strong`, radius `--radius-sm`.
- Focus: `--accent` border plus `--focus-ring`.
- The label sits above the field, never only a placeholder.

**Column chips** (columns to compare)
- Pill, `--surface-2` with a ✓ when selected, plus an "All / None" toggle.
- Columns present in only one file show an A or B badge and can't be
  selected.

**KPI tiles** (also the filters)

| Tile | Colour | Icon | Click |
|---|---|---|---|
| Matched | `--ok` number on `--surface` | ✓ | filter: matched |
| Differ | `--diff` | ≠ | filter: differences |
| Only in A | `--a` | A | filter |
| Only in B | `--b` | B | filter |
| Warnings (duplicates, blank keys) | `--warn` | ! | filter, hidden when 0 |

The active filter tile gets a 2 px border in its colour.

**Status badges** (first column of the results)
- Pill, 12 px / 600, on the `-soft` fill with text in the strong colour.
- Always icon + word: `✓ Match`, `≠ Differs`, `A Only in A`, `B Only in B`,
  `! Duplicate key`.

---

## 6. Results table

- **Structure:**
  - sticky header (`--surface-2`, 13 / 600, `--text-muted`);
  - sticky first columns: Status and Key;
  - row height 32 px, compact.
- **Paired columns:** for each compared field, show **A | B | Δ** under a
  grouped header. The A and B sub-headers carry a 3 px top border in the
  file colour.
- **Differences:**
  - differing cell pairs get a `--diff-soft` fill;
  - Δ is shown in `--diff`, signed (`+1,250.00` / `−3.00`);
  - text differences show "≠" in the Δ column;
  - matching cells stay plain.
- **Missing side:** `—` in `--text-faint` on the absent side, with the row
  badge saying "Only in A" / "Only in B".
- **Alignment:** numbers right-aligned in mono, text left.
- **Number formats:**
  - thousands separators, with decimals as in the source (max 2 for amounts);
  - dates as ISO `2026-10-16`;
  - IDs as text, so leading zeros are kept.
- **Row states:**
  - hover in `--surface-2`;
  - a selected row gets a 2 px accent left border.
  - **No zebra stripes:** they would compete with the difference fills.
- **Empty state:** centred, with an icon and "No differences, both files
  match on 1,204 rows." in `--ok`.
- **Large files** (more than 5,000 rows): virtualise or paginate with "Show
  more". Always show the total count.

---

## 7. Feedback and messages

- **Inline messages:** shown inside the relevant card, never as browser
  `alert()`. Structure: left 3 px bar in the status colour, `-soft`
  background, icon + one sentence + optional action link.
- **Tone:** plain and specific. Say what happened and what to do next:
  - ✗ "Error parsing input"
  - ✓ "Row 12 in File B has 9 columns, the header has 8. Check the delimiter
    (currently ';')."
- **Progress:** for parsing or comparing, a thin accent bar under the header
  plus the step text ("Comparing 12,400 rows…"). Never block the whole
  screen.
- **Toast** (bottom right, 4 s, `--text` background, white text): only for
  confirmations such as "Exported differences.csv".

---

## 8. Interaction details

- **Keyboard:**
  - every control is reachable with Tab, with a visible focus ring;
  - Enter on a drop zone opens the file picker;
  - `/` focuses search.
- **Motion:** 120–160 ms ease-out on hover and focus only. Respect
  `prefers-reduced-motion`.
- **Remembering settings:** the last key column and tolerance are kept in
  `localStorage`, wrapped in `try/catch`.
- **Privacy note** in the footer, in `--text-faint`: "Files are processed in
  your browser and never uploaded."
- **Export:** one menu with "Differences only (CSV)", "Full comparison
  (CSV)" and "Summary (copy to clipboard)".

---

## 9. Don'ts

- No purple, gradients, glassmorphism, or heavy shadows (`--shadow` is the
  maximum).
- No colour-only status, and no red / green as the only distinction.
- No more than one primary button per view.
- No ALL-CAPS labels, centred table text, or icons without labels in the
  main flow.
- No raw technical errors (stack traces, `undefined`) shown to the user.

---

## 10. Quick migration from the purple theme

1. Replace every hard-coded colour with the tokens in §2. Search for `#`,
   `rgb(` and `purple`.
2. Map the old primary purple to `--accent`, and the old purple
   backgrounds / headers to `--surface-2` / `--text`.
3. Add the A / B identity colours to the drop zones and table sub-headers.
4. Switch the result highlighting to "colour the exceptions" (§6), with
   status badges.
5. Check contrast and dark mode, and resize to a 375 px width.
