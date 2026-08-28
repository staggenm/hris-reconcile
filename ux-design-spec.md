# UX Design Spec — Modern HR Data Tool

> **Purpose:** Feed this document to Claude Code alongside your existing HTML/CSS.
> Instruction: "Restyle the application following this design spec. Preserve all
> existing functionality, component structure, and JavaScript logic. Only change
> CSS, class names where needed, and HTML structure where the spec explicitly
> requires it."

---

## 1. Design philosophy

This is a professional tool used by HR consultants and IT professionals in
corporate environments. The design should feel **calm, confident, and modern** —
like Linear, Notion, or Vercel's dashboard. Not flashy, not playful, not
enterprise-gray. The user is often stressed (migration deadlines, audit
pressure), so the interface should reduce cognitive load, not add to it.

**Core principles:**
- **Quiet confidence.** Let the data speak. The UI recedes; the content leads.
- **Generous breathing room.** White space is not wasted space — it reduces
  fatigue during long working sessions.
- **Progressive disclosure.** Show what matters now. Details on demand.
- **Accessible by default.** WCAG AA contrast ratios. Keyboard navigable.
  No meaning conveyed by color alone.

---

## 2. Color system

Replace the current high-saturation corporate palette with softer, more
contemporary tones. The key shift: from "enterprise navy" to "cool slate."

```css
:root {
  /* ── Surface & structure ── */
  --bg:          #f8f9fb;        /* page background: warm off-white, not cold gray */
  --surface:     #ffffff;        /* card/panel background */
  --surface-alt: #f3f4f6;        /* secondary surface (nested cards, table stripes) */
  --border:      #e5e7eb;        /* subtle borders — only where needed */
  --border-focus: #818cf8;       /* focus rings: visible, not aggressive */

  /* ── Typography ── */
  --text:        #111827;        /* primary text: near-black, not pure black */
  --text-secondary: #6b7280;    /* labels, metadata, helper text */
  --text-tertiary:  #9ca3af;    /* disabled, placeholder */

  /* ── Brand accent ── */
  --accent:      #4f46e5;        /* indigo-600: primary action color */
  --accent-hover:#4338ca;        /* indigo-700: hover state */
  --accent-soft: #eef2ff;        /* indigo-50: light accent background */
  --accent-text: #3730a3;        /* indigo-800: text on accent-soft background */

  /* ── Semantic status ── */
  --critical:    #dc2626;        /* red-600 */
  --critical-bg: #fef2f2;        /* red-50 */
  --critical-border: #fecaca;    /* red-200 */

  --high:        #d97706;        /* amber-600 */
  --high-bg:     #fffbeb;        /* amber-50 */
  --high-border: #fde68a;        /* amber-200 */

  --medium:      #ca8a04;        /* yellow-600 */
  --medium-bg:   #fefce8;        /* yellow-50 */
  --medium-border:#fef08a;       /* yellow-200 */

  --low:         #2563eb;        /* blue-600 */
  --low-bg:      #eff6ff;        /* blue-50 */
  --low-border:  #bfdbfe;        /* blue-200 */

  --info:        #6b7280;        /* gray-500 */
  --info-bg:     #f9fafb;        /* gray-50 */
  --info-border: #e5e7eb;        /* gray-200 */

  --success:     #059669;        /* emerald-600 */
  --success-bg:  #ecfdf5;        /* emerald-50 */
  --success-border:#a7f3d0;      /* emerald-200 */

  /* ── Shadows ── */
  --shadow-sm:   0 1px 2px rgba(0,0,0,.05);
  --shadow-md:   0 4px 6px -1px rgba(0,0,0,.07), 0 2px 4px -2px rgba(0,0,0,.05);
  --shadow-lg:   0 10px 15px -3px rgba(0,0,0,.08), 0 4px 6px -4px rgba(0,0,0,.04);
  --shadow-focus:0 0 0 3px rgba(79,70,229,.25);  /* accent ring */

  /* ── Radii ── */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-full: 9999px;

  /* ── Transitions ── */
  --ease:        cubic-bezier(.4,0,.2,1);
  --duration:    150ms;
}
```

### Why these specific changes:
- **`--bg: #f8f9fb`** — Warmer than the current `#f4f6f9`. Less clinical.
- **`--accent: #4f46e5`** (indigo) replaces navy as the brand color. Indigo reads
  as modern and professional without the "90s corporate intranet" connotation of
  navy. It's also the primary action color used by Linear, Vercel, and Stripe's
  newer designs.
- **Status colors** use Tailwind's scale at the 600 level (text) and 50 level
  (background). These are industry-standard, accessible, and look intentional
  together. Each status also has a `*-border` variant for bordered badges.
- **Shadows replace borders** as the primary depth mechanism. Borders remain for
  tables and dividers, but cards and panels use shadows.

---

## 3. Typography

```css
html {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI',
               Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 15px;           /* up from 14px — reduces strain on long sessions */
  line-height: 1.6;          /* up from 1.45 — more vertical breathing room */
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'cv11', 'ss01';  /* Inter's alternates for cleaner l/I */
}
```

**Inter** is the de-facto standard for modern tool UIs. Load it from a single
`<link>` tag or self-host. If the tool must work fully offline (no network),
fall back to the system font stack — which is already excellent on modern OSes.

### Type scale

Use a ratio-based scale, not arbitrary pixel values. This keeps headings and
body proportional:

| Role             | Size    | Weight | Line-height | Usage |
|------------------|---------|--------|-------------|-------|
| Page title       | 24px    | 600    | 1.25        | One per view — top of results, landing |
| Section heading  | 18px    | 600    | 1.35        | Card titles, wizard step names |
| Subheading       | 15px    | 600    | 1.4         | Finding titles, table captions |
| Body             | 15px    | 400    | 1.6         | Paragraphs, descriptions, form labels |
| Small / meta     | 13px    | 400    | 1.5         | Timestamps, row counts, help text |
| Caption / label  | 12px    | 500    | 1.4         | Chip text, badge text, column headers |

**Rules:**
- Never go below 12px for any visible text.
- Use font weight (400 vs 500 vs 600) to create hierarchy, not size alone.
- Monospace for data values, file names, key columns: `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.

---

## 4. Layout & spacing

### Spacing scale

Use a consistent 4px grid. All margins, paddings, and gaps should be multiples of 4:

```
4px   — micro (icon-to-label gap)
8px   — tight (within a chip, between inline elements)
12px  — compact (between form field and its label)
16px  — base (card padding, between list items)
20px  — comfortable (between cards, section gaps)
24px  — spacious (between sections)
32px  — section break
48px  — major section separator
```

### Page frame

```css
main {
  max-width: 960px;            /* narrower than 1180px — easier to scan */
  margin: 0 auto;
  padding: 32px 24px 80px;     /* more top padding, generous bottom */
}
```

**Why 960px max-width:** Data tools benefit from constrained line lengths. At
1180px, table rows and descriptions stretch too wide for comfortable reading.
960px keeps the eye tracking manageable. Tables that need more width can break
out with `margin-left: -24px; margin-right: -24px; width: calc(100% + 48px)`.

### Grid

```css
.grid       { display: grid; gap: 20px; }
.grid-2     { grid-template-columns: repeat(2, 1fr); }
.grid-3     { grid-template-columns: repeat(3, 1fr); }

@media (max-width: 768px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
}
```

---

## 5. Components

### 5.1 Top bar / Header

**Current:** Heavy navy band, feels like an internal enterprise tool.

**New:** Minimal white bar with a subtle bottom border. The brand mark is understated.

```css
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky;
  top: 0;
  z-index: 50;
  backdrop-filter: blur(8px);           /* subtle blur when scrolled */
  background: rgba(255,255,255,.85);    /* translucent when scrolled */
}

.header .brand {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;             /* slight negative tracking = modern feel */
}

.header .version {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 400;
}
```

**Key change:** No colored background. The header is invisible until you need it
(sticky on scroll). The tool name is quiet, not shouting.

### 5.2 Cards

**Current:** White with 1px border, 10px radius.

**New:** Shadow-based elevation, more padding, larger radius.

```css
.card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 24px;                       /* up from 16px — more breathing room */
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);     /* keep border but make it very subtle */
  transition: box-shadow var(--duration) var(--ease);
}

.card:hover {                          /* only for interactive cards */
  box-shadow: var(--shadow-md);
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
}

.card-meta {
  font-size: 13px;
  color: var(--text-secondary);
}
```

### 5.3 Tabs

**Current:** Dark navy bar with orange underline. Feels heavy.

**New:** Subtle pill-style tabs or underline tabs on a white background.

```css
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 0;
  margin-bottom: 24px;
}

.tab {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--duration) var(--ease),
              border-color var(--duration) var(--ease);
}

.tab:hover {
  color: var(--text);
}

.tab[aria-selected="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab .count {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--surface-alt);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}
```

### 5.4 Status chips / badges

**Current:** Solid-background pills, 12px font.

**New:** Slightly larger, with a subtle border for more definition.

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  border: 1px solid;
}

.chip-critical { background: var(--critical-bg); color: var(--critical); border-color: var(--critical-border); }
.chip-high     { background: var(--high-bg);     color: var(--high);     border-color: var(--high-border); }
.chip-medium   { background: var(--medium-bg);   color: var(--medium);   border-color: var(--medium-border); }
.chip-low      { background: var(--low-bg);      color: var(--low);      border-color: var(--low-border); }
.chip-info     { background: var(--info-bg);      color: var(--info);     border-color: var(--info-border); }
.chip-success  { background: var(--success-bg);  color: var(--success);  border-color: var(--success-border); }
```

**The border addition matters.** Without it, light-background chips (especially
info and low) look washed out on white cards. The border gives them definition
without heaviness.

### 5.5 Buttons

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;                  /* bigger touch target than current 7px 14px */
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration) var(--ease);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn:hover {
  background: var(--surface-alt);
  border-color: #d1d5db;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  font-weight: 600;
}

.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.btn-primary:disabled {
  background: #a5b4fc;                /* indigo-300 */
  border-color: #a5b4fc;
  cursor: not-allowed;
}

/* Ghost / text button for secondary actions */
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover {
  background: var(--surface-alt);
  color: var(--text);
}

/* Size variants */
.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

.btn-lg {
  padding: 12px 24px;
  font-size: 15px;
}
```

### 5.6 Tables

```css
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

thead th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

tbody td {
  padding: 12px;                        /* more room than current 7px */
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  color: var(--text);
}

tbody tr {
  transition: background var(--duration) var(--ease);
}

tbody tr:hover {
  background: var(--surface-alt);
}

/* Numeric alignment */
td.num, th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
```

### 5.7 Form controls

```css
input[type="text"],
select,
textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-family: inherit;
  color: var(--text);
  background: var(--surface);
  transition: border-color var(--duration) var(--ease),
              box-shadow var(--duration) var(--ease);
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

input::placeholder,
textarea::placeholder {
  color: var(--text-tertiary);
}

label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
}

.field-help {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* Checkbox modernization */
input[type="checkbox"] {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  accent-color: var(--accent);
  cursor: pointer;
}
```

### 5.8 Drop zone

```css
.dropzone {
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 48px 32px;
  text-align: center;
  cursor: pointer;
  transition: all var(--duration) var(--ease);
}

.dropzone:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone.active {                     /* during drag-over */
  border-color: var(--accent);
  background: var(--accent-soft);
  border-style: solid;                 /* solid during active drag = visual feedback */
}

.dropzone-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;                        /* soft, not attention-grabbing */
}

.dropzone-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.dropzone-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
}
```

### 5.9 Banners / Alerts

```css
.banner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 20px;
  border-radius: var(--radius-md);
  border: 1px solid;
  margin-bottom: 20px;
  font-size: 14px;
  line-height: 1.5;
}

.banner-icon {
  font-size: 18px;
  line-height: 1.4;
  flex-shrink: 0;
}

.banner-success { background: var(--success-bg); border-color: var(--success-border); color: var(--success); }
.banner-critical { background: var(--critical-bg); border-color: var(--critical-border); color: var(--critical); }
.banner-high    { background: var(--high-bg);     border-color: var(--high-border);     color: var(--high); }
.banner-info    { background: var(--info-bg);     border-color: var(--info-border);     color: var(--text-secondary); }
```

### 5.10 Collapsible details / findings

```css
.finding {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 10px;
  background: var(--surface);
  overflow: hidden;
  transition: box-shadow var(--duration) var(--ease);
}

.finding:hover {
  box-shadow: var(--shadow-sm);
}

.finding > summary {
  list-style: none;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 18px;
  cursor: pointer;
  flex-wrap: wrap;
  font-size: 14px;
}

.finding > summary::-webkit-details-marker { display: none; }

.finding > summary::before {
  content: '›';
  font-size: 18px;
  font-weight: 300;
  color: var(--text-tertiary);
  transition: transform var(--duration) var(--ease);
  width: 12px;
  display: inline-block;
}

.finding[open] > summary::before {
  transform: rotate(90deg);
}

.finding[open] > summary {
  border-bottom: 1px solid var(--border);
}

.finding-body {
  padding: 16px 18px;
  font-size: 14px;
  color: var(--text-secondary);
}
```

---

## 6. Micro-interactions & transitions

These small details are the difference between "functional" and "polished":

```css
/* Smooth state transitions on everything interactive */
a, button, input, select, textarea,
.card, .finding, .tab, .chip, .btn {
  transition-property: background, color, border-color, box-shadow, transform;
  transition-duration: var(--duration);
  transition-timing-function: var(--ease);
}

/* Subtle press feedback on buttons */
.btn:active:not(:disabled) {
  transform: scale(0.98);
}

/* Loading spinner */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Fade-in for new content */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeIn 0.2s var(--ease) both;
}
```

---

## 7. The summary dashboard (results view)

The results summary at the top of the results page is the most important visual
in the tool. It should feel like a dashboard, not a data dump.

### Layout: horizontal stat cards

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Validation complete    14 findings in 0.42s                    │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  2       │  │  5       │  │  4       │  │  3       │        │
│  │ Critical │  │ High     │  │ Medium   │  │ Low/Info │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Each stat card has the count in large type (24px, weight 700) and the label
below in small caps (12px). The card's left border uses the severity color
(4px solid).

```css
.stat-card {
  padding: 16px 20px;
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid;                /* color set by severity modifier */
}

.stat-card .count {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-card .label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.stat-card-critical { border-left-color: var(--critical); }
.stat-card-critical .count { color: var(--critical); }
.stat-card-high     { border-left-color: var(--high); }
.stat-card-high .count { color: var(--high); }
/* etc. */
```

---

## 8. File upload cards (after upload, before config)

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│  📄  employees.csv                                  ✕  │
│      847 rows · 6 columns                              │
│      ━━━━━━━━━━━━━━━━━━━━━━ 100%                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

```css
.file-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.file-card-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.file-card-info {
  flex: 1;
  min-width: 0;                       /* prevent text overflow breaking layout */
}

.file-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-card-meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.file-card-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.file-card-remove:hover {
  color: var(--critical);
  background: var(--critical-bg);
}
```

---

## 9. Wizard / stepped form

For the configuration wizard, use a clean step indicator at the top:

```css
.steps {
  display: flex;
  gap: 0;
  margin-bottom: 32px;
}

.step {
  flex: 1;
  text-align: center;
  position: relative;
  padding: 12px 0;
}

.step::before {                        /* connector line */
  content: '';
  position: absolute;
  top: 24px;
  left: -50%;
  width: 100%;
  height: 2px;
  background: var(--border);
  z-index: 0;
}

.step:first-child::before { display: none; }

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-tertiary);
  position: relative;
  z-index: 1;
}

.step.active .step-dot {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.step.complete .step-dot {
  border-color: var(--success);
  background: var(--success);
  color: white;
}

.step.complete::before {
  background: var(--success);
}

.step-label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 8px;
}

.step.active .step-label {
  color: var(--text);
  font-weight: 600;
}
```

---

## 10. Dark mode (optional, but prepared)

The CSS variable system makes dark mode trivial to add later:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg:           #0f1117;
    --surface:      #1a1d27;
    --surface-alt:  #23262f;
    --border:       #2e3039;
    --text:         #e5e7eb;
    --text-secondary:#9ca3af;
    --text-tertiary: #6b7280;
    /* accent and semantic colors stay the same */
    /* shadows become more transparent */
    --shadow-sm:    0 1px 2px rgba(0,0,0,.3);
    --shadow-md:    0 4px 6px rgba(0,0,0,.4);
  }
}
```

Do NOT implement dark mode now. Just ensure no colors are hardcoded outside
`:root` variables, so the switch is a single variable block change later.

---

## 11. Anti-patterns to avoid

- **No gradients** on buttons or headers. Flat solid colors only.
- **No drop shadows on text.** Ever.
- **No more than 2 font weights visible at once** in any single card. Use 400
  and 600. Reserve 700 for the one largest number on the page (stat count).
- **No borders AND shadows on the same element** unless the border is `var(--border)`
  (very subtle). Doubling up depth cues looks heavy.
- **No uppercase text except** table headers and stat labels. Uppercase body text
  or button labels feels aggressive.
- **No icon fonts.** Use inline SVG or Unicode symbols where needed. Icon fonts
  add a network dependency or a large embedded payload.
- **No color as the only differentiator.** Every status chip must also have a
  text label ("CRITICAL", not just a red dot). Every banner must have an icon in
  addition to its background color.

---

## 12. Quick reference: mapping old classes to new

| Old class / pattern        | New class / pattern              | Key change |
|---------------------------|----------------------------------|------------|
| `.topbar` (navy bg)       | `.header` (white, sticky)        | Remove colored background |
| `.card` (border, 10px)    | `.card` (shadow + subtle border, 14px) | More padding, shadow |
| `.tabs` (navy-dark bg)    | `.tabs` (borderless, underline)  | White bg, accent underline |
| `.chip.block`             | `.chip-critical`                 | Add border, rename |
| `.chip.warn`              | `.chip-high`                     | Rename for clarity |
| `.banner.block`           | `.banner-critical`               | Rename for clarity |
| `.btn.primary` (navy bg)  | `.btn-primary` (indigo bg)       | New accent color |
| `.dropzone` (navy dashed) | `.dropzone` (gray dashed)        | Subtler default, accent on hover |
| `details.item`            | `.finding` (details element)     | Add chevron, hover shadow |

---

## 13. Checklist for implementation

When restyling, work through this order:

1. Replace the `:root` CSS variables (Section 2)
2. Update the `html/body` base styles (Section 3)
3. Restyle the header/topbar (Section 5.1)
4. Restyle cards (Section 5.2)
5. Restyle buttons (Section 5.5) — test all states (hover, active, disabled)
6. Restyle form controls (Section 5.7) — test focus states
7. Restyle the drop zone (Section 5.8)
8. Restyle tabs (Section 5.3)
9. Restyle chips/badges (Section 5.4)
10. Restyle tables (Section 5.6)
11. Restyle banners (Section 5.9)
12. Restyle findings/collapsibles (Section 5.10)
13. Add the summary stat cards (Section 7)
14. Add transitions (Section 6) — do this last so you can see the effect
15. Review against anti-patterns (Section 11)
16. Verify accessibility: focus rings visible, contrast ratios pass AA
