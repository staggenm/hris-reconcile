# Open Tasks

Updated after the packaging pass (2026-08-28). The v0.3 transport replacement,
P0 review fixes, and local macOS packaging are implemented and verified. The
remaining release blockers are a Windows build and platform code signing.

## Status snapshot

- Streamlit and pandas removed. Runtime is pydantic, PyYAML, typer, rich.
- Standard-library loopback server with capability token, `Host`/`Origin`
  validation, and a `sys.addaudithook` network tripwire.
- `dist/HRIS Reconciliation.app` builds as a **27 MB** Apple-Silicon windowed
  app from a clean venv; its structure, ad-hoc signature, and startup were
  verified locally.
- `ruff`, `mypy --strict`, and 99 tests are clean.
- The app bundle excludes the legacy Streamlit/pandas stack and development-only
  packages (verified against the PyInstaller manifest).
- The explicit Windows one-file/no-console spec, version resource, clean build
  script, artifact verifier, and release runbook are ready for a native build.

---

## P0 — Fixes from the v0.3 review

- [x] **Widen the network tripwire beyond `socket.connect`.**
      The hook now covers `socket.connect`, `socket.sendto`, `socket.sendmsg`,
      and `socket.getaddrinfo`; subprocess tests verify hard aborts for external
      TCP, UDP, and DNS operations.

- [x] **Bump the version to 0.3.0.** `src/hris_reconcile/__init__.py:3` and
      `pyproject.toml:7` now agree, so JSON reports identify their engine as
      version 0.3.0.

- [x] **Cap the upload body size.** Uploads over 64 MiB receive `413` with an
      analyst-facing message before the body is read, and the connection closes.

- [x] **Make `_is_loopback_address` deny by default.** Unknown address shapes
      and non-string hosts are rejected.

- [x] Minor, optional: reconciliation results are stored through
      `Session.set_reconciliation()` under the session lock.
- [x] Minor, optional: note in the README that the documented macOS sandbox
      profile denies loopback outbound too, and works only because the server is
      inbound-only. Prevents a confusing failure if that ever changes.

---

## P1 — Remove the terminal window

Goal: a non-technical user double-clicks one thing, the app appears, and there
is an obvious way to quit. No terminal at any point.

- [x] **Set `console=False` in `hris-reconcile-ui.spec`.** This removes
      the terminal on both platforms. Both windowed-launch consequences are
      handled:
      - On Windows, `sys.stdout` becomes `None` in windowed mode and a bare
        `print()` can raise. The launcher's `print` of the URL must be guarded.
      - The URL is then invisible, so `webbrowser.open()` failing leaves the
        user stranded. Add a stdlib fallback dialog: `osascript -e 'display
        dialog …'` on macOS, `ctypes.windll.user32.MessageBoxW` on Windows.

- [x] **Wrap macOS as a proper `.app`** using `BUNDLE(...)` in the spec, so it
      double-clicks from Finder, gets a Dock icon, and doesn't look like a
      developer tool. A custom branded icon remains in P2 design work.

- [x] **Give the app a way to quit without a terminal.** Implemented combination,
      both dependency-free:
      - a **Quit** button in the UI that `POST`s to `/api/session/shutdown`,
        clears the session, and stops the server;
      - a **heartbeat**: the page pings every 5 s, and the server exits after
        90 s without a ping. A best-effort `pagehide` request handles normal tab
        closure immediately; the longer fallback tolerates browser timer
        throttling in background tabs.
      The heartbeat doubles as a security property worth documenting — when the
      window closes, the session and all in-memory payroll data go with it.

- [ ] **Windows build.** PyInstaller does not cross-compile, so the current
      binary is Apple-Silicon-only and your users are almost certainly on
      Windows. This needs a build on a Windows machine or a Windows CI runner.
      **This is the largest remaining gap between the current state and the
      stated goal of handing the tool to colleagues.**
      - [x] Explicit one-file, GUI-subsystem, non-elevated spec branch.
      - [x] Version resource and generic native startup-error dialog.
      - [x] Clean PowerShell build and artifact-verification scripts.
      - [ ] Native Windows 10/11 build and security acceptance run.

- [ ] **Code signing.** Unsigned, another Mac refuses the app ("developer cannot
      be verified") and Windows shows a SmartScreen warning. For a payroll tool
      distributed internally, that warning generates an IT ticket rather than a
      user. Needs signing plus notarization on macOS, an Authenticode
      certificate on Windows.
      - [x] Signing and verification procedure documented.
      - [ ] Organization-controlled certificate and timestamped signature.

- [x] **Rebuild the shipping artifact from a clean venv.** The developer `.venv`
      contains v0.2 leftovers, so the verified macOS artifact was rebuilt from a
      temporary venv containing only runtime dependencies and PyInstaller. The
      manifest contains none of the legacy web or data-stack packages.

- [ ] Consider for later, not now: the pywebview/Tauri desktop shell deferred
      from v0.3. It solves the terminal, native file dialogs, and the quit
      problem together, but adds a dependency and a WebView2 runtime requirement
      on Windows. `console=False` plus a `.app` bundle gets 90% of the benefit
      today. Revisit once the Windows build exists.

---

## P2 — UI/UX redesign

Feedback: header and buttons are already clean. The dataset previews are too
wide and force sideways scrolling. Step 6 is overloaded and too technical. The
whole thing should feel more modern and dynamic.

### P2.1 — Fix the width problem (step 1)

Three concrete causes, all in `static/app.css`:

- `th { white-space: nowrap }` (line 73) stops long headers such as
  `employee_number` and `company_code` from wrapping, forcing the table wider
  than its container.
- `.two-column` (line 55) puts two full preview tables side by side inside a
  1180px `main`, leaving each roughly 558px.
- `td input, td select { min-width: 9rem }` (line 74) means step 3's three
  selects need ~27rem minimum, so that table scrolls sideways too.

The deeper issue is that a spreadsheet preview is the wrong component here. At
step 1 the analyst is answering one question: *did the right file load, and does
it look sane?* That needs filename, row and column counts, column names, and a
few sample values — not a grid.

- [ ] Replace the side-by-side preview grid with a **vertical column list** per
      dataset: one row per column showing name, fill percentage, distinct count,
      and two or three sample values. A vertical list scales to any column count
      without horizontal scroll and is far more scannable.
- [ ] Move the full row-level preview behind a disclosure ("View first 5 rows")
      that opens **full width** across both cards, not inside one 558px column.
- [ ] Allow header wrapping; use `table-layout: fixed` with ellipsis truncation
      and a `title` tooltip for long values.
- [ ] Drop `min-width: 9rem` on table controls; size the field-mapping selects
      to content with a sensible max.
- [ ] Collapse `.two-column` to a single column below ~900px rather than 760px.

### P2.2 — Make step 6 interpretable (the important one)

Currently: nine metric tiles in a ragged 4-wide grid, a four-column rate table,
a field selector, a pair table exposing raw status enums (`MISMATCH`,
`UNMAPPED_LEFT`), an employee drill-down, a `<details>` dump of *every* matching
comparison, and three download buttons. It reads as an engine trace rather than
an answer.

Redesign around progressive disclosure — **verdict, then pattern, then detail**:

- [ ] **Lead with one headline verdict.** A single prominent figure — e.g. "94%
      of compared values agree" — with a clear visual. That is the number a
      non-technical user came for.
- [ ] **Cut nine tiles to three or four** that answer real questions: how many
      employees could be compared, how many values disagree, what the single
      biggest problem is. Move the rest into a secondary "Details" area.
- [ ] **Translate every status enum into plain language**, with the technical
      code kept on hover and in the exports so the audit trail survives:
      - `MISMATCH` → "Values differ"
      - `UNMAPPED_LEFT` / `UNMAPPED_RIGHT` → "Value not recognised in Dataset A/B"
      - `LEFT_NULL` / `RIGHT_NULL` → "Missing in Dataset A/B"
      - `MATCH_MAPPED` → "Agreed via your value mapping"
- [ ] **Rank fields by affected employees, not by rate**, and draw a bar so
      relative size is instantly readable. "Company code — 8 of 9 employees
      disagree" beats a percentage in a table cell.
- [ ] **Separate systemic from sporadic disagreement.** If the same value pair
      repeats across many employees it is a configuration or mapping issue
      fixable once; if it appears once it is likely an individual data error.
      Labelling these differently is the single most interpretable thing the
      screen can do, and it maps directly onto the reconciliation use case.
      Something like: "This looks like a systematic difference affecting all 8
      employees — likely a coding difference between the systems" versus "3
      employees have individual differences."
- [ ] **Do not render the full matching-comparisons table by default.** It is
      the largest table on the page and the least useful. Put it behind an
      explicit request, and fetch it lazily rather than eagerly on results
      render (`app.js:363`).
- [ ] Keep the existing PII discipline exactly as it is: verdict and per-field
      views stay counts-only; raw values appear only in analyst-requested
      drill-downs and downloads.

### P2.3 — Modern and dynamic

- [ ] **Loading states.** There are currently none — every `await` freezes the
      UI silently. A large file gives no feedback at all. Add spinners or
      skeletons on upload, run, and drill-down.
- [ ] **Step progress indicator.** Six steps with no map. Add a sticky progress
      rail showing completed, current, and upcoming steps.
- [ ] **Design tokens.** Formalise the ad-hoc values in `:root` into spacing,
      radius, and elevation scales so the visual language is consistent.
- [ ] **Dark mode.** `app.css:2` sets `color-scheme: light` only. Add a
      `prefers-color-scheme` block.
- [ ] **Motion.** Subtle transitions on step reveal, confirmation states, and
      table updates. Respect `prefers-reduced-motion`.
- [ ] **Drag-and-drop upload** onto the dataset cards, alongside the existing
      picker. Cheap, and it is what users expect.
- [ ] **Accessibility.** Focus rings, ARIA on the step sections and live regions
      for errors, keyboard-navigable tables.
- [ ] **App icon** for the `.app` bundle and browser tab.
- [ ] Keep the constraint: no CDN, no remote fonts, no external assets of any
      kind. The security tests assert this and must stay green.

---

## P3 — Deferred features

In the order agreed earlier.

- [ ] **Contract export/import.** Highest practical value: an analyst configures
      SFEC ↔ Payroll X once, saves the YAML, and everyone reruns it through UI
      or CLI. `build_contract()` already produces a validated
      `ReconciliationContract`, so this is close to free.
      Two things to get right while it is cheap:
      - add a `version:` field to the contract schema now, before anyone has
        saved contracts, because composite identity will break the format later;
      - wizard contracts produce `DatasetConfig(name=...)` with no `path`, so
        exported YAML will not run under the CLI as-is. Either add
        `--left` / `--right` overrides to `cli.py run`, or inject paths on
        export. This is the seam between "UI artifact" and "repeatable control".
- [ ] **Excel adapter.** Re-add `openpyxl` (removed in v0.3 as unused). The real
      work is not reading the file but the cell-to-string coercion policy:
      openpyxl hands back `datetime` objects and floats, and Excel will already
      have eaten the leading zeros from `0001` employee numbers. Every Excel bug
      is a typing bug in disguise.
- [ ] **Typed comparison policies** — dates, decimals, tolerances. The Excel work
      makes this urgent rather than optional.
- [ ] **Composite identities.** Breaking change: `IdentityResult.identity` is
      `str` (`identity/models.py:19`) and the JSON report assumes a scalar in
      three places (`json_report.py:35,40,103`). Do it after the contract
      `version:` field exists.
- [ ] **Stronger mismatch analytics** — null asymmetry, mismatch rates by field,
      likely mapping candidates. Partly delivered by the P2.2 systemic-versus-
      sporadic work. Still preferred over fuzzy matching.

---

## Decisions already made — do not relitigate

- Threat model: data must be no more exposed than the same file in the user's
  Downloads folder. Machine compromise, IT/EDR/DLP inspection, and OneDrive
  syncing of files the user chose to save are **out of scope**.
- No encryption at rest, no authentication beyond the loopback capability token,
  no multi-user support.
- v0.3 keeps browser file inputs; native dialogs arrive with the desktop shell.
- Suggestions are always advisory and never auto-applied; every step needs an
  explicit confirmation.
- Identity matching stays exact. No fuzzy matching.
- Summary views stay counts-only; raw values only in drill-downs and downloads.
