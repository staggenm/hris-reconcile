# HTML conversion remediation plan

Status: Implemented with verification gaps. See [html_conversion_fix_validation.md](html_conversion_fix_validation.md) for completed work, test evidence, and pending large-file/native-browser checks.

## 1. Objective and scope

Fix the six defects identified in the review of `src/web/`, the subsequently reported unformatted HTML opening experience, and the large-file and browser verification gaps. Preserve the standalone, offline HTML distribution and the existing Python application.

Read `docs/html_conversion_plan.md` for the original design. Where its prose disagrees with the existing Python implementation, use the Python implementation as the compatibility reference, subject to the explicit decisions below.

Review baseline:

- `npm test`: 41 tests passed across three files.
- `npm run typecheck`: passed.
- `npm run build`: passed and produced `dist/hris-reconcile.html`.
- Targeted reproductions found ambiguous mappings, Unicode differences, incompatible exported statuses, and silently discarded CSV records.
- Session cleanup defects were identified through source inspection.
- Interactive browser behavior and cross-browser compatibility were not verified during the review.

Do not interpret the passing baseline tests as acceptance of the current behavior. Some existing assertions must change, especially lowercase export assertions.

## 2. Implementation rules

1. Implement the phases below in order. Add regression coverage with each behavioral fix.
2. Keep the public Python report format at version `1.0`. Keep lowercase TypeScript statuses internally; translate them only at export boundaries.
3. Keep all production processing local. No CDN scripts, remote Unicode tables, runtime Python dependency, analytics, persistence, or server requirement.
4. Leave the Python production modules unchanged. They are the reference implementation for this port.
5. Preserve CSV strings, including leading zeros and whitespace, except when an explicitly selected normalizer applies.
6. Keep generated reference fixtures under version control. Never require files from ignored `output/` or a developer's `/private/tmp` directory.
7. Use synthetic data in fixtures, screenshots, and performance evidence.
8. Deliver fixes to source plus reproducible build scripts. `src/web/index.html` is a source entry point; the double-clickable deliverable is `dist/hris-reconcile.html`.

## 2.1. Phase 0 — Deliver a styled, clearly identified HTML entry point

Implement this phase first. The user reported that opening an `index.html` directly on macOS displayed an unformatted page. Confirm which file was opened before attributing the observed failure to a specific entry point.

### Known source-level cause

`src/web/index.html` links to `./app.css` and imports `./main.ts`, but its CSP allows only inline styles/scripts. Directly opening that source file blocks its linked CSS, and a browser cannot execute the uncompiled TypeScript entry point. This file is not the standalone deliverable. The production build inlines CSS and compiled JavaScript into `dist/index.html` and copies it to `dist/hris-reconcile.html`.

### Files

- `src/web/index.html`, `src/web/app.css`, and `vite.config.ts`
- `package.json` and any build helper introduced
- `README.md`
- Browser tests and visual verification evidence

### Required changes

1. Make `dist/hris-reconcile.html` the clearly documented, user-facing artifact. Explain in README that users double-click this file; developers run `npm run dev`. Include the build command and exact output path.
2. Verify that the built file contains the complete stylesheet and compiled application, with no external CSS, TypeScript, JavaScript, or worker dependency. Move a copy into a separate temporary folder and verify that it still works without the repository alongside it.
3. Prevent accidentally opening the source entry point from presenting an unformatted, apparently usable workbench. Add a concise source-only notice directing users to the built artifact, and hide the source workbench when opened directly. Implement this with a minimal inline bootstrap/notice compatible with the source CSP, or another deterministic build-aware mechanism. Remove/disable this guard in production output; production also uses `file://`, so protocol detection alone must not disable the built workbench.
4. Make the development server entry point styled and functional too. Apply separate development CSP handling as needed for local styles, modules, and Vite tooling. Do not weaken the production CSP or its zero-network requirement to make development work.
5. Preserve the existing visual design in `app.css`: styled header, dataset cards, spacing, typography, buttons, wizard steps, metrics, and scrollable tables. Fix actual rendering defects rather than introducing an unrelated redesign.
6. Inspect the built artifact in Safari and Chrome on macOS at desktop and narrow window widths. Check the initial upload page, populated profiles, mapping editor, and results view. Record screenshots using synthetic data. If either browser is unavailable, explicitly mark that check pending.

### Acceptance

- A copied standalone artifact opens on macOS with all styling and controls working, without a local server or sibling assets.
- Browser tests assert computed styles on representative elements (for example, header layout and card/button styling), rather than only checking that a `<style>` tag exists. Capture screenshots for visual review; confirm text readability and absence of page-wide horizontal overflow at the tested widths.
- Opening `src/web/index.html` directly gives the explanatory notice instead of an unformatted interactive-looking application.
- `npm run dev` presents the styled working application.
- Production remains offline and reports no CSP violations during its complete workflow.

## 3. Phase A — Make reference tests reproducible

### Files

- Update `tests_web/differential.test.ts`.
- Add `tests_web/fixtures/python_reference/` with checked-in inputs, contracts, expected JSON, full CSV, and mismatches CSV.
- Add `scripts/generate_web_reference_fixtures.py`.
- Add a fixture README describing provenance and regeneration.

### Required changes

1. Remove the dependency on `output/golden_report.json`.
2. Generate the initial reference using `examples/core_hr_vs_payroll` and the actual Python contract. Do not maintain an unrelated hand-written TypeScript copy of the contract in the differential test. Convert the checked-in contract to the TypeScript representation through an explicit test helper.
3. Generate JSON using `hris_reconcile.reporting.json_report.build_report` and CSV using `hris_reconcile.ui.results_analysis.reconciliation_csv`. The CLI currently generates JSON only; do not assume it can generate both CSV exports.
4. Make the generator support `--check`: generate in memory or a temporary directory and fail if committed fixtures differ. Never overwrite fixtures during ordinary tests.
5. Record Python version, `unicodedata.unidata_version`, and the source revision used to generate fixtures. Use the project's supported Python environment; do not silently change Unicode baselines when another interpreter is used.
6. Ordinary `npm test` must use committed fixtures and run without Python or preexisting build/output directories.

### Regression coverage

Include fixtures for exact matches, missing identities on each side, duplicate identities on each side and both sides, normalized text, semantic mappings, unmapped values on either side, all null combinations, and CSV escaping. Cover all nine actual field statuses and five identity statuses. The original plan's reference to ten field statuses is inaccurate.

### Acceptance

- `npm test` succeeds with no `output/` directory in a fresh temporary checkout/copy.
- The generator's `--check` succeeds with the documented reference interpreter.
- Differences in employee identity, field values, canonical values, or status cannot be hidden by comparing aggregate counts alone.

## 4. Phase B — Reject ambiguous semantic mappings

### Files

- `src/web/core/contract_builder.ts`
- `src/web/core/mapping.ts`
- `src/web/core/comparator.ts`
- `src/web/core/reconciliation.ts`
- `src/web/main.ts`
- Add focused mapping/contract regression tests under `tests_web/`.

### Reproduction

Configure `ONE: left=[A], right=[X]` and `TWO: left=[A], right=[Y]`. The current browser implementation accepts both and silently resolves `A` to `TWO`. The Python contract rejects the ambiguous left-side value.

### Required changes

1. Add shared validation that checks aliases independently for the left and right sides. Reject repeated aliases within a side, including repeated aliases within one canonical entry, matching Python's contract validation.
2. Report the mapping name, side, alias, and conflicting canonical entries in a user-facing error. Do not choose a winner based on insertion order.
3. Validate in the contract builder and at engine entry so callers that bypass the wizard cannot submit ambiguous contracts.
4. Validate normalized aliases as well when a field has a normalization chain. Two different raw aliases that normalize to one value must not silently overwrite different canonical assignments.
5. Keep duplicate-canonical-name and empty-entry validation. Use own-key checks or prototype-free dictionaries for user-supplied canonical names; valid names such as `constructor` must not be mistaken for existing entries.
6. Build each field's normalized mapping resolver once per reconciliation, after validation. Reuse it for employees; do not reconstruct the entire mapping for every comparison. Preserve the standalone `compareField` entry point for tests/callers, with the same validation behavior.
7. On mapping confirmation, build/validate the current configuration before enabling Run. At Run, validate again before replacing results.
8. Any mapping checkbox, alias, canonical-name, add-row, or remove-row change must invalidate confirmation and prior results, hide/disable downloads, and require confirmation again. A failed run must not leave old results presented as current.

### Tests and acceptance

- Reject duplicate left aliases and duplicate right aliases.
- Reverse canonical insertion order and get the same validation failure.
- Reject conflicting aliases after `trim`/`casefold` normalization.
- Valid one-to-one and multiple-alias mappings continue to work.
- A value appearing once on each opposite side is allowed; uniqueness is per side.
- A mapping is validated even when all employee raw values happen to match exactly.
- Browser regression: edit a confirmed mapping after a completed run; previous results/downloads become unavailable until reconfirmation and rerun.

## 5. Phase C — Match Python Unicode normalization

### Files

- `src/web/core/normalization.ts`
- Add a generated casefold table in `src/web/core/`.
- Add `scripts/generate_web_unicode_data.py` and generated-data provenance.
- Add Unicode regression tests and reference fixtures.

### Required changes

1. Replace `value.toUpperCase().toLowerCase()` with full Unicode case folding.
2. Generate a sparse table from the documented reference Python interpreter: iterate Unicode scalar values and store entries where `chr(codepoint).casefold()` differs from the original character. Include expansions into multiple code points. Record interpreter and Unicode database versions.
3. Iterate JavaScript input by Unicode code point using `for...of`, look up the generated mapping, and retain unchanged characters when absent. Do not apply a final lowercase pass. Bundle the table into the HTML; no runtime downloads.
4. Give the generator a deterministic `--check` mode. Keep the table committed so ordinary Node builds do not require Python.
5. Align `trim` and `collapse_whitespace` with Python's whitespace definition as part of the same normalization boundary. JavaScript `\s` and `trim()` are not identical to Python's behavior. Generate/document the Python whitespace set and use it explicitly.
6. Preserve normalizer ordering and null handling. Do not apply normalization to employee identity matching.

### Required examples

| Inputs | Python-compatible behavior |
| --- | --- |
| `ß`, `ẞ`, `SS` | All casefold to `ss` |
| `Straße`, `STRAẞE`, `STRASSE` | All casefold to `strasse` |
| `ı`, `i` | Remain distinct |
| `İ` | Folds to `i` followed by U+0307 |
| `ΟΣ` | Folds to `οσ`, without a contextual final sigma |
| `σ`, `ς` | Both fold to `σ` |
| U+0085 and U+001C | Follow Python whitespace treatment |
| U+FEFF inside a field value | Follow Python normalization, separately from a file BOM |

Also cover ligatures, Cherokee casing, supplementary-plane letters, combining marks, and already-normalized text. Generate expected strings from Python rather than guessing them.

### Acceptance

- Validate the generated table exhaustively against the pinned Python reference during generation/checking.
- Test complete multi-character strings as well as individual characters.
- End-to-end normalized comparisons classify `ẞ` versus `ß` as `match_normalized` and `ı` versus `i` as `mismatch`.
- Existing exact comparisons and exact identity matching remain unchanged.

## 6. Phase D — Restore export compatibility

### Files

- `src/web/core/export.ts`
- `tests_web/differential.test.ts`
- `tests_web/analysis.test.ts`
- Add focused export tests and a Python schema-validation check.

### Required changes

1. Add explicit, exhaustive translations from internal identity/field statuses to the uppercase Python public values. Use these translations for JSON summary keys, JSON detail statuses, and both CSV status columns.
2. Keep `format_version: "1.0"` and `processing_mode: "browser"`. Document the engine version policy rather than changing metadata to make tests pass.
3. Preserve the Python CSV column order, record order, identity rows, mismatch filtering, null representation, final newline, and quoting behavior.
4. Compare complete generated CSV strings to committed Python exports. Include commas, quotes, LF, CR, CRLF, Unicode, empty cells, and leading-zero identifiers. Resolve any escaping differences against the actual Python writer.
5. Compare parsed JSON structures, allowing differences only in `run_metadata.processing_mode` and, if deliberately different, `run_metadata.engine_version`. Do not uppercase statuses inside the test or otherwise normalize actual output before comparison.
6. Validate a generated browser JSON report with Python's `ReconciliationReport.model_validate_json` in a separate parity check. Fail on schema errors. Node-only unit tests still use committed fixtures.
7. Replace existing tests that assert lowercase exported summary keys with uppercase public keys. Internal engine assertions may remain lowercase.

### Acceptance

- Browser JSON passes the existing Python v1.0 schema.
- Full and mismatches CSV match Python reference bytes for every fixture.
- All public status values and summary keys match the reference; zero-count statuses are present.
- Browser downloads contain the tested export content, not a separate serialization path.

## 7. Phase E — Clear data and invalidate pending work

### Files

- `src/web/main.ts`
- Extract a small session/controller module if needed for testability.
- Add state tests and browser lifecycle tests.

### Required changes

1. Implement one shared reset operation used by both Clear Session and Close Workbench.
2. Release all application references: datasets, selected identities, fields, mapping evidence, contract, results, result pairs, caches, pending download content, and future worker state.
3. Remove data-bearing DOM content, including hidden content: profiles/previews, identity suggestions/evidence/options, field rows, mapping editors/inputs, contract name, run summary, metrics, field/pair/detail summaries, matching details, and error text. Hiding these elements is insufficient.
4. Reset confirmation indicators, selects, file inputs, pagination, and controls to the initial state. Preserve the structural elements needed for a new session.
5. Close Workbench must reset first, then render the closed screen. Do not rely on `window.close()` succeeding for a double-clicked local file.
6. Track a session generation plus a per-side upload request identifier. After any asynchronous operation completes, check both before committing data. Clear/close invalidates outstanding operations; a later upload supersedes an earlier upload on the same side.
7. Invalidate the old dataset on that side when replacement upload begins. If parsing fails, do not silently reuse the previous dataset in a later comparison.
8. Track and revoke download object URLs during cleanup. Allow downloads enough time to begin before normal revocation; test this in supported browsers.
9. When workers are added in Phase G, terminate them and discard their pending responses during reset/close. A cleared session must not be repopulated by a late worker response.
10. Describe the guarantee accurately: application references and displayed data are cleared. Do not promise immediate physical RAM erasure, which JavaScript cannot guarantee.

### Tests and acceptance

- Run with distinctive synthetic employee values, clear, and verify those values are absent from DOM text, inputs, options, and controller state, including hidden sections.
- Close after a completed run and verify state is empty before the closed screen is shown.
- Delay `File.arrayBuffer()`, clear/close while reading, then resolve it: no data or results reappear and no DOM errors occur.
- Start two uploads on the same side and finish the older one last: the newer upload wins.
- Replace a valid dataset with invalid CSV: the previous dataset is not used.
- After clear, a complete second reconciliation works normally.

## 8. Phase F — Preserve CSV records and validation positions

### Files

- `src/web/analysis/csv.ts`
- `tests_web/analysis.test.ts` or a dedicated `csv.test.ts`
- Python reference fixtures for ingestion.

### Required changes

1. Remove greedy empty-row skipping. Keep delimiter-only rows and whitespace-only field values as records, matching Python.
2. Distinguish a genuinely blank unquoted record from a quoted empty field. For a single-column CSV, `""` is a real null record. A simple `row.length === 1 && row[0] === ""` check cannot distinguish these cases.
3. Keep PapaParse for field decoding. If its parsed arrays lose information needed for blank-record handling, use its record cursor metadata plus a small quote-aware raw-record boundary helper. Test CRLF and quoted multiline cells; never split raw CSV on newlines to identify records.
4. Preserve original header strings. Python does not trim header names, so `id` and ` id ` are distinct. Reject exactly empty header names and exact duplicate headers as Python does.
5. Maintain the original logical record ordinal for width-validation errors, including skipped blank records. Python currently enumerates CSV records starting at 2, rather than physical source lines inside quoted multiline cells. Match that behavior.
6. Retain strict UTF-8 decoding, initial BOM handling, string values, empty-string-to-null conversion, and supported delimiters. Validate that parser errors are still surfaced safely.
7. Use prototype-free record objects or explicit own-property creation so headers such as `__proto__` survive as actual data keys.

### Required tests

- `id,value\n1,A\n,\n2,B\n` yields three records; reconciliation rejects the null identity.
- A truly blank record between two data records is skipped.
- A delimiter-only row with the wrong number of columns is rejected, not skipped.
- A single-column quoted empty field is retained as null.
- Whitespace-only field values are preserved.
- A ragged row after a blank record reports the correct logical record number.
- Blank first record, empty header, duplicate header, and header-only input match Python's accepted/rejected behavior.
- Quoted delimiters, escaped quotes, embedded LF/CRLF, trailing newline, UTF-8 BOM, and malformed UTF-8 work as specified.
- Comma, semicolon, tab, and pipe fixtures agree with Python.
- Header names with surrounding spaces and `__proto__` retain their values.

### Acceptance

Dataset columns, record counts, record values, and rejection behavior agree with the committed Python ingestion fixtures. No invalid identity record disappears before identity validation.

## 9. Phase G — Keep large files responsive

This phase completes the performance gap reported in the review. Run it after correctness fixes so worker execution uses the corrected engine.

### Files and architecture

- Add a typed worker protocol, worker entry point, and client/controller under `src/web/`.
- Update `src/web/main.ts`, `src/web/index.html`, and relevant build configuration.
- Update `package.json` and lockfile for any explicit build dependency.
- Add bounded table rendering/pagination and synthetic performance fixtures.

### Required changes

1. Use a dedicated worker for parsing, profiling, identity suggestions, observed-pair analysis, reconciliation, aggregation, and export generation. Using it for all dataset sizes is acceptable and avoids maintaining two separate execution paths.
2. Keep full datasets and results in the worker. Send only previews, profile summaries, metrics, mapping evidence pages, and requested result pages to the UI. Do not transfer all results back just to render a collapsed table.
3. Define typed request/response messages with request ID and session generation. Return structured user-facing errors. Handle worker startup failure and runtime errors without presenting stale results.
4. Keep Clear Session and Close Workbench usable during processing. Terminate the worker on reset and recreate it for a new session; reject pending requests cleanly.
5. Bundle the worker source inside the single HTML artifact. Use a supported inline-worker build mode or an explicit build step that bundles the worker and embeds its source for a Blob worker. Do not ship a separate worker file or depend on a relative worker URL from `file://`.
6. Update CSP narrowly to permit the Blob worker, including a compatible fallback directive if required. Preserve `connect-src 'none'`; do not allow remote script hosts. Verify the actual built artifact in browsers.
7. Paginate employee details, matching details, observed mapping evidence, and large pair lists. Use a default page size of 100 with visible totals and next/previous controls. Keep user mapping edits across pages. Exports must still include the complete result set.
8. Load matching details only when expanded. Do not eagerly construct a DOM row for every successful comparison.
9. Cache per-column normalized identity sets within a dataset session; avoid rescanning each column for every candidate column pair. Release caches on replacement/reset.
10. Reuse the mapping resolvers introduced in Phase B. Never perform a full mapping rebuild per employee.

### Performance verification

Use deterministic synthetic fixtures with at least 25,000 employees, 20 comparison fields, missing employees, duplicates, and a field with many mappings. Include a separate CSV larger than 10 MB to exercise the original plan's size criterion.

- Record browser, machine, row/column counts, file sizes, parsing time, suggestion time, comparison time, and export time.
- A UI interaction must complete while background processing is still pending; use a deterministic delayed worker response in the automated responsiveness test.
- Clear during a large operation must immediately reset the UI and prevent later results from appearing.
- Each paginated table renders at most its configured page size, with exports containing all rows.
- Manual large-fixture verification must show usable scrolling and controls throughout processing. Record measured timings; do not assert the original plan's unverified universal `<100 ms` claim.
- Do not use machine-dependent wall-clock thresholds as the only evidence of correctness or responsiveness.

## 10. Phase H — Verify the built offline workflow in browsers

### Test setup

Add Playwright as a development dependency, a browser test configuration, and scripts such as `test:browser` and `test:parity`. Keep browser tests separate from the Node Vitest include pattern. Document any browser installation command and its one-time network requirement for development; the delivered application must remain offline.

### Automated workflow

1. Build the production artifact and open `dist/hris-reconcile.html` through a `file://` URL, without a server.
2. Upload synthetic CSVs through file inputs and exercise drag-and-drop in a separate test.
3. Confirm identity, choose Exact/Normalized text/Value mapping/Ignore fields, review mapping evidence, confirm, run, inspect discrepancy pairs, and select an employee-detail page.
4. Exercise each of the regressions from Phases B–F through the browser where applicable.
5. Download full CSV, mismatches CSV, and JSON. Read downloaded bytes and compare with reference fixtures, allowing only the documented metadata differences.
6. Clear and run a second session. Close and verify cleanup. Exercise reset during a pending worker operation.
7. Fail on unexpected page errors, unhandled rejections, or CSP violations.

### Network-egress verification

- Install page instrumentation before application execution to record calls to `fetch`, `XMLHttpRequest`, `WebSocket`, and `navigator.sendBeacon`.
- Monitor browser/context requests throughout the workflow, including worker activity. Fail on HTTP/HTTPS/WebSocket requests; initial local-document loading and Blob worker creation are not network egress.
- Observe failed/blocked request attempts as well as successful requests. CSP blocking a request is not proof that the application never attempted one.
- Include exports, clear, close, and the large-file worker path in the monitored workflow.
- Inspect the built HTML for external script/style/worker dependencies and run it with external network unavailable.

### Browser matrix

- Automated: Chromium, Firefox, and WebKit, using the actual standalone artifact.
- Manual release checks: installed Microsoft Edge and Google Chrome on Windows, and Safari on macOS. Playwright WebKit alone is not proof of Safari verification.
- Record actual browser versions and outcomes. If a platform is unavailable, mark it unverified; do not claim universal compatibility.
- Verify Blob workers, CSP, local-file loading, upload/drop, downloads, and reset in each tested browser.

## 11. Final validation and handover

Document and run these checks after implementation:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:parity
npm run test:browser
.venv/bin/python scripts/generate_web_reference_fixtures.py --check
.venv/bin/python scripts/generate_web_unicode_data.py --check
.venv/bin/pytest
git diff --check
```

`test:parity`, `test:browser`, and both generator commands must be created by this implementation; they are not present at the review baseline. Document how to create the Python environment on a new machine, using the project's supported version and dependencies. Browser tests must build the artifact themselves or clearly require the immediately preceding build.

Add `docs/html_conversion_fix_validation.md` containing:

- A checklist mapping each of the six review findings to changed files and passing regressions.
- Verification of the styled standalone delivery and source-entry notice from Phase 0, including macOS screenshots and the exact file tested.
- Reference interpreter and Unicode versions, fixture regeneration instructions, and clean-checkout test evidence.
- Full-export parity and Python JSON schema-validation results.
- Browser matrix with actual tested versions and any unverified platforms.
- Network monitoring results and standalone `file://` verification.
- Large-fixture measurements, pagination evidence, and reset-during-processing results.
- Any remaining limitations, with explicit explanations rather than declaring incomplete gates passed.

Completion requires all six defects fixed, the styled-delivery checks in Phase 0 satisfied, reproducible automated parity checks, an independently usable single-file artifact, and the browser/performance checks above implemented. Do not change expected fixtures or weaken comparisons merely to accommodate an unexplained divergence from Python.
