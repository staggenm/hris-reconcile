# v0.3 Implementation Brief: Replace Streamlit with an Auditable Local Server

## Instructions to the implementing model

Implement this brief in the existing `hris-reconcile` repository. It is a
**replacement of the presentation and transport layer only**. The reconciliation
domain is finished, tested, and must not change. Read the "Do not touch" section
before writing any code.

This work will be quality-reviewed against the acceptance criteria at the end.
Where this brief states a decision, implement that decision; do not substitute an
alternative because it is more familiar. Where this brief marks something as a
judgement call, make the call and record it in a short comment.

---

## 1. Why this change exists

The tool reconciles real payroll and HR master data on corporate devices. The
security requirement, stated by the product owner, is:

> Data handled by the tool must be no more exposed than the same file sitting in
> the user's Downloads folder.

Machine compromise, IT/EDR/DLP inspection, and OneDrive syncing of files the user
chose to save are **explicitly out of scope**. They apply equally to the baseline
file, so the tool neither improves nor worsens them.

Three things in the current Streamlit build are worse than that baseline:

1. **A listening socket has no file permissions.** `~/Downloads` is protected by
   ACLs; `127.0.0.1:8501` is not. On Citrix/RDS/VDI hosts — common in HR and
   payroll teams — every other logged-in user on that machine can reach the
   server. The app has no authentication.
2. **Websites can reach localhost; they cannot read the filesystem.** A page the
   analyst visits in the same browser can attack the local server via DNS
   rebinding or CSRF.
3. **The dependency surface is large and unprovable.** Streamlit brings Tornado,
   `requests`, `gitpython`, `pyarrow`, `altair` and a compiled JS bundle.
   Demonstrating "this never touches the network" across that set is a recurring
   cost on every dependency bump.

The design rule that follows, and which every decision below serves:

> **Never create a copy the user did not ask for, and never open a channel the
> file did not already have.**

---

## 2. Do not touch

These are complete and correct. Changing them is out of scope and will fail
review.

- `src/hris_reconcile/reconciliation/` — engine, comparator, models
- `src/hris_reconcile/identity/` — resolver, models
- `src/hris_reconcile/mapping/` — resolver, models
- `src/hris_reconcile/normalization/` — registry, builtins
- `src/hris_reconcile/config/` — contract models and loader
- `src/hris_reconcile/adapters/` — `base.py`, `csv_adapter.py`
- `src/hris_reconcile/reporting/` — console and JSON report
- `src/hris_reconcile/cli.py` — the YAML CLI keeps working exactly as today
- `tests/test_*.py` — the seven domain test modules at the top level

If you believe one of these needs a change, stop and state why rather than
changing it.

### Reuse, do not rewrite

Every module in `src/hris_reconcile/ui/` **except `app.py` and `launcher.py`** is
already free of Streamlit and pandas (verified: zero framework imports). These are
your application layer. Call them; do not reimplement their logic in JavaScript.

| Module | Public surface you will call |
| --- | --- |
| `ui/profiling.py` | `ColumnProfile`, `profile_dataset(dataset, *, sample_limit=5)` |
| `ui/suggestions.py` | `IdentityCandidate`, `FieldSuggestion`, `suggest_identity(left, right)`, `score_identity_pair(left, right, *, left_column, right_column)`, `suggest_field_mappings(left_columns, right_columns, *, excluded_left, excluded_right, minimum_score=0.65)` |
| `ui/mapping_analysis.py` | `ObservedPair`, `analyze_observed_pairs(left, right, *, left_identity, right_identity, left_field, right_field)` |
| `ui/results_analysis.py` | `DISCREPANCY_STATUSES`, `is_discrepancy`, `FieldMismatchSummary`, `PairMismatchSummary`, `aggregate_mismatches_by_field`, `aggregate_mismatches_by_pair`, `mismatch_details`, `reconciliation_csv`, `reconciliation_json` |
| `ui/contract_builder.py` | `ComparisonMode`, `FieldSelection`, `ValueMappingSelection`, `WizardConfiguration`, `WizardConfigurationError`, `build_contract` |
| `ui/csv_upload.py` | `parse_csv_bytes`, `parse_uploaded_csv`, `CsvParseError` |

Their existing tests under `tests/ui/` stay green unchanged, with one exception
covered in section 9.

---

## 3. What to remove

- `src/hris_reconcile/ui/app.py` — deleted and replaced (750 lines; only 124 of
  them touch `st.`/`pd.`, the rest is wizard-state logic worth porting).
- `src/hris_reconcile/ui/launcher.py` — replaced.
- `.streamlit/config.toml` — deleted.
- `tests/ui/test_privacy.py` — replaced entirely (see section 9).
- From `pyproject.toml` dependencies: `streamlit`, `pandas`, and `openpyxl`.
  `openpyxl` is currently declared but imported nowhere; it returns in v0.4 when
  the Excel adapter lands. Remove `pandas-stubs` from dev dependencies.

Runtime dependencies after this change: `pydantic`, `PyYAML`, `typer`, `rich`.
Add `pyinstaller` to the dev extra.

---

## 4. Target architecture

```text
   ┌─────────────────────────── one process, one user ───────────────────────────┐
   │                                                                             │
   │  browser (loopback only)          stdlib http.server (127.0.0.1, port 0)    │
   │  ┌──────────────────────┐         ┌────────────────────────────────────┐    │
   │  │ static HTML/CSS/JS   │◀───────▶│ token + Origin + Host guard        │    │
   │  │ holds token in memory│  JSON   │ JSON API  ──▶  in-memory Session   │    │
   │  └──────────────────────┘         │                      │             │    │
   │                                   │                      ▼             │    │
   │                                   │  existing ui/ helpers ──▶ engine   │    │
   │                                   └────────────────────────────────────┘    │
   └─────────────────────────────────────────────────────────────────────────────┘
                     no disk writes · no non-loopback sockets
```

The transport is deliberately thin so it can be swapped for an in-process bridge
(pywebview/Tauri) in v0.4 without touching the frontend or the API layer. Keep
the HTTP handler free of business logic for exactly this reason.

### New modules

```text
src/hris_reconcile/ui/
    server.py       # http.server subclass, routing, security guards
    session.py      # in-memory wizard state, no persistence
    api.py          # request payload models + endpoint handlers (pure functions)
    launcher.py     # token/port generation, audit hook install, browser open
    static/
        index.html
        app.js
        app.css
src/hris_reconcile/security.py   # sys.addaudithook network tripwire
```

---

## 5. Security implementation (non-negotiable specifics)

**Binding.** Bind to `127.0.0.1` and port `0` so the OS assigns an ephemeral
port. Never bind `0.0.0.0`. Read the assigned port back from the socket.

**Capability token.** Generate `secrets.token_urlsafe(32)` at launch. Every
request to `/api/*` must carry it in an `X-Auth-Token` header. Compare with
`hmac.compare_digest`. Reject with `403` and an empty body otherwise.

Use a custom header, not a cookie. Custom headers cannot be set on a
cross-origin request without a CORS preflight that you will never answer, so this
also defeats CSRF. Do not add CORS headers of any kind.

**Token delivery.** The launcher opens `http://127.0.0.1:<port>/?token=<token>`.
`index.html` is the only route that accepts the token via query string. `app.js`
reads it into a module-scoped variable and immediately calls
`history.replaceState` to strip it from the address bar so it does not persist in
browser history.

**Host header validation.** Reject any request whose `Host` header is not
exactly `127.0.0.1:<port>`. This is what actually blocks DNS rebinding — an
attacker-controlled name resolving to 127.0.0.1 will present its own hostname.

**Origin validation.** If an `Origin` header is present it must exactly equal
`http://127.0.0.1:<port>`. Absent is acceptable (same-origin `fetch` may omit it
for same-origin GETs); anything else is rejected.

**Network tripwire.** `src/hris_reconcile/security.py` installs a
`sys.addaudithook` that inspects the `socket.connect` audit event and terminates
the process if the destination address is not loopback. Install it in the
launcher **before** importing the server module. Provide
`install_network_tripwire()` as the public entry point. It must be a hard abort,
not a warning.

**No disk writes.** No uploaded bytes, dataset, contract, or result may be
written to disk at any point. Downloads are streamed as HTTP responses with
`Content-Disposition: attachment`; the browser's save dialog is the only place a
file is created, and the user chose it. There is no cache, no temp file, no
session file.

**No external assets.** `index.html` must reference no CDN, no Google Fonts, no
remote scripts, stylesheets, images, or source maps. Use a system font stack.
The UI must render correctly with networking disabled at the OS level.

---

## 6. File input: decision and rationale

**v0.3 uses a browser `<input type="file">`.** The browser reads the file the
user selects and `fetch`-POSTs the bytes to the loopback API, which parses them
in memory via the existing `parse_csv_bytes` and discards the raw bytes.

This is a deliberate, revisitable decision, and it is a step short of ideal.
Native OS file dialogs (`tkinter.filedialog`) would avoid routing bytes through
the browser at all, but tkinter dialogs must run on the main thread, which forces
awkward main-thread/handler coordination against a threaded HTTP server. That
complexity is not worth paying twice, because the desktop shell in v0.4 provides
native dialogs cleanly.

Under the stated threat model the browser path is baseline-equivalent: the bytes
move disk → browser memory → loopback socket → server memory, all inside
processes owned by the same user, with no disk copy. The one residual difference
is that browser extensions can read page content whereas they cannot read
arbitrary files — and IT-managed extensions are out of scope by the product
owner's scoping.

Record this rationale as a comment where the upload endpoint is defined, and add
a "Deferred decisions" note to the README.

---

## 7. JSON API

All routes below are prefixed `/api`, require the token header, accept and return
JSON, and are handled by pure functions in `api.py` that take the `Session` plus
a validated request model. Use Pydantic v2 models for request bodies, consistent
with `config/models.py` (`extra="forbid"`, frozen).

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/dataset/{side}` | Body is raw file bytes; `X-Filename` header carries the name. Parses, stores, returns row/column counts, column names, first 5 rows, and the full column profile. `side` ∈ `left`\|`right`. |
| `DELETE` | `/dataset/{side}` | Drops the dataset and all downstream state. |
| `PUT` | `/dataset/{side}/name` | Sets the logical dataset name. |
| `GET` | `/identity/suggestion` | `suggest_identity` result including per-candidate reasons. |
| `POST` | `/identity/score` | `score_identity_pair` for an analyst-chosen pair. |
| `POST` | `/identity/confirm` | Stores the confirmed pair; clears downstream state. |
| `GET` | `/fields/suggestions` | `suggest_field_mappings`, identity columns excluded. |
| `POST` | `/fields/confirm` | Validates and stores `FieldSelection` tuple; clears downstream state. |
| `POST` | `/mappings/observed` | `analyze_observed_pairs` for one value-mapping field. |
| `POST` | `/mappings/confirm` | Stores accepted `ValueMappingSelection`s onto their fields. |
| `POST` | `/run` | Builds the contract via `build_contract`, runs `ReconciliationEngine`, stores both. |
| `GET` | `/results/summary` | Aggregate counts only — no raw values (see section 8). |
| `GET` | `/results/by-field` | `aggregate_mismatches_by_field`. |
| `GET` | `/results/by-pair?field=` | `aggregate_mismatches_by_pair`. |
| `GET` | `/results/details?field=&left=&right=` | `mismatch_details`; `left`/`right` optional. |
| `GET` | `/results/matching` | The non-discrepancy comparisons (currently an expander). |
| `GET` | `/download/{full.csv,mismatches.csv,report.json}` | Streams `reconciliation_csv` / `reconciliation_json`. |
| `POST` | `/session/clear` | Drops all state. |

**Error contract.** `WizardConfigurationError`, `CsvParseError`, and `ValueError`
map to `400` with `{"error": "<message>"}`. These messages are already written to
be analyst-facing and PII-free — keep them that way. Unexpected exceptions map to
`500` with a generic message and must not echo exception text, which could
contain field values.

**Downstream invalidation.** The current app clears dependent state whenever an
earlier step changes (`_DOWNSTREAM_KEYS` in `app.py`). Preserve this exactly:
changing an upload invalidates identity, fields, mappings, contract, and result;
changing identity invalidates fields onward; and so on. This is a correctness
property, not a UI nicety — stale state here produces a wrong reconciliation.

---

## 8. Frontend: port the wizard, preserve its judgement

Six steps, matching today's app. Vanilla JS, no framework, no build step.

1. **Upload datasets** — two file inputs, row/column counts, 5-row preview,
   collapsible column profile.
2. **Match employees** — suggestion banner with reasons, two dropdowns, live
   overlap caption, explicit Confirm button.
3. **Match fields** — editable grid of A-field / B-field / Mode rows, rows
   addable and removable, Mode ∈ Exact, Normalized text, Value mapping, Ignore.
4. **Review value mappings** — per value-mapping field, a grid of observed pairs
   with an "Accept semantic mapping" checkbox, editable canonical value, and
   read-only Employees / Consistency % / Assessment columns.
5. **Run comparison** — editable reconciliation name, identity and field-count
   summary, Run button.
6. **Explore discrepancies** — metric tiles, mismatch-by-field table, drill-down
   to pairs, drill-down to employees, and the three download buttons.

Steps 3 and 4 replace `st.data_editor`. A plain HTML `<table>` with `<select>`
and `<input>` cells plus add/remove-row buttons is sufficient; do not pull in a
grid library.

**Behavioural properties that must survive the port.** These are the product's
point of view and the reason it is trustworthy:

- Suggestions are advisory and never auto-applied. Every step requires an
  explicit confirmation click.
- Exact comparison is the default mode for every field.
- The step 6 metric tiles and the mismatch-by-field table show **counts only,
  never raw values**. Raw employee data appears only in the analyst-requested
  drill-downs and downloads. Do not "improve" the summary by adding examples.
- `None` renders as the literal `<missing>` sentinel, as today.
- Identity matching remains exact. The overlap percentage shown in step 2 is
  advisory selection evidence only; say so in the caption, as today.

---

## 9. Tests

Keep every existing test green. `tests/ui/test_privacy.py` is deleted and
replaced by `tests/ui/test_security.py` covering:

- the server binds `127.0.0.1`, never `0.0.0.0`
- a request without `X-Auth-Token` is rejected `403`
- a request with a wrong token is rejected `403`
- a request with a foreign `Host` header is rejected (DNS rebinding)
- a request with a foreign `Origin` header is rejected
- no CORS headers appear on any response
- `install_network_tripwire()` aborts on a non-loopback connect and permits a
  loopback connect
- `index.html`, `app.js`, and `app.css` contain no `http://` or `https://`
  reference to any external host

Add `tests/ui/test_api.py`: an end-to-end run through the real HTTP API against
`examples/core_hr_vs_payroll/`, asserting the final counts match those the CLI
produces for the same data — 9 matched, 1 missing each side, and the field
comparison totals in the README's example output. This is the regression test
that proves the transport swap did not change reconciliation behaviour.

Add a no-disk-writes test: snapshot the working directory and the system temp
directory before and after a full API run and assert no new files.

---

## 10. Packaging

Add a PyInstaller spec producing a single executable per platform. The static
assets must be bundled (`--add-data`) and resolved through a helper that handles
both `sys._MEIPASS` and normal package-relative paths.

Keep both console entry points: `hris-reconcile` (YAML CLI, unchanged) and
`hris-reconcile-ui` (now the new server launcher).

Ship a documented sandbox verification, and include the command in the README:
run the built binary with networking removed at the OS level — `unshare -n` on
Linux, `sandbox-exec` with a deny-network profile on macOS, an outbound-block
firewall rule on Windows — and confirm a full reconciliation still completes.
This converts "makes no network calls" from a claim into a demonstration.

Report the resulting binary size and cold-start time in the PR description.

---

## 11. Explicit non-goals

Do not implement any of these. They are v0.4+ and mixing them into this change
makes it unreviewable:

- Excel input, sheet selection, or header-row selection
- typed comparison policies (dates, decimals, tolerances)
- composite identities
- contract export/import — this is the **first** v0.4 feature, deliberately held
  back so v0.3 is a pure like-for-like transport replacement
- fuzzy matching of any kind
- additional mismatch analytics beyond what exists
- authentication beyond the loopback token, encryption at rest, or multi-user
  support

---

## 12. Quality gates

Match the repository's existing conventions — read a few domain modules first and
follow what you see.

- Python 3.12+, `ruff check .` clean at line length 88 with the configured rule
  set, `mypy src` clean under `strict`
- `pytest` fully green
- immutable frozen dataclasses and Pydantic models, fail-fast validation,
  one-line module docstrings, no bare `except`
- no new runtime dependency beyond those listed in section 3 without saying why

Update `README.md`: replace the Streamlit sections with the new launcher, revise
the architecture diagram, document the security model and the sandbox
verification, and move "Excel input" out of limitations only when it actually
ships.

---

## 13. Acceptance criteria

1. Streamlit and pandas appear nowhere in the repository, including
   `pyproject.toml`.
2. `hris-reconcile run examples/core_hr_vs_payroll/contract.yaml` produces byte-
   identical output to the current build.
3. A full six-step wizard run through the browser UI reproduces the CLI's counts
   for the same example data.
4. Every security test in section 9 passes.
5. A full run creates no file anywhere except those the user explicitly saved
   through a download.
6. The built binary completes a reconciliation with networking disabled at the
   OS level.
7. `ruff`, `mypy --strict`, and `pytest` are all clean.
