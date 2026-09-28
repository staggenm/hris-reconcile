# hris-reconcile

> A deterministic reconciliation engine for HR system landscapes.

`hris-reconcile` compares HR master data across systems that do not share a
technical interface or a common representation. It is designed for migration
discovery, interface preparation, and transparent data-quality analysis across
Core HR, payroll, local HRIS, and file-based datasets.

It ships as a single self-contained HTML file: a guided workbench that runs
entirely in the browser, with no server, installation, or network access.

The project is public, company-agnostic, and local-first. All included data is
synthetic.

## The problem

The same employee and business concept is often encoded differently by each HR
system. A global HR platform might identify a German company as `DE01`, while a
payroll system uses `1000`. Comparing those values directly produces a false
mismatch. Treating either system as an implicit source of truth hides the real
semantic decision.

**Different HR systems do not need identical representations. They need
explicitly defined semantic equivalence.**

A reconciliation contract therefore declares both structural correspondence
and meaning:

```text
raw representation
        ↓
normalization
        ↓
semantic value mapping
        ↓
canonical value
        ↓
comparison
```

Every detailed result retains the raw, normalized, and canonical values that
led to its typed status.

## Philosophy

- Deterministic: the same inputs and contract produce the same ordered report.
- Symmetric: neither dataset is silently treated as canonical truth.
- Explicit: normalization and equivalence exist only when the contract says so.
- Explainable: typed outcomes distinguish exact, normalized, mapped, null,
  unmapped, and mismatched values.
- Local and private: there are no network calls, telemetry, SaaS services,
  external APIs, or AI features.
- Conservative identity matching: identities are exact; there is no fuzzy
  employee matching and duplicate records are never paired arbitrarily.

## Architecture

```text
CSV files ──> worker: parse + profile ──> Dataset ──┐
                                                    ├──> reconciliation engine ──> results + CSV/JSON exports
wizard (main thread) ──> ReconciliationContract ────┘
```

- `src/web/main.ts` is the UI step controller. It never holds full datasets.
- `src/web/reconciliation.worker.ts` owns datasets and results and answers paged
  queries; `src/web/worker_client.ts` is the main-thread client. The worker
  caches column profiles and normalized value sets once per dataset per
  session (`analysis/dataset_analysis.ts`).
- Results are summary-first: full records are kept only for non-matching
  comparisons, and matches are counts. The matching-details page and
  `full.csv` are recomputed lazily from the datasets and contract.
- Exports are streamed as text chunks into a `Blob` inside the worker, and the
  Blob is posted to the page. No report-sized string is built.
- If the worker crashes (typically out of memory), the session is reset with
  "Processing stopped (likely memory). Session reset."
- `src/web/core/` is the engine: normalization, value mappings, identity
  grouping, comparison, and exports. `src/web/analysis/` holds CSV parsing,
  profiling, suggestions, and result aggregation.
- The build inlines the worker, script, and styles into one HTML file with a
  restrictive Content-Security-Policy.

Important policies are fail-fast:

- Unknown normalizer names and missing mapping references are invalid.
- Empty or ambiguous semantic mappings are invalid. Mapping rows that share a
  canonical value are grouped (N:1 and 1:N); only an alias that resolves to two
  different canonical values is ambiguous.
- Required columns are checked before indexing records.
- Null or all-whitespace identities are reported per record as
  `MISSING_IDENTITY_LEFT` / `MISSING_IDENTITY_RIGHT`; duplicate identities
  receive explicit statuses.
- Output order uses Unicode code-point order, never the browser locale.
- Every error carries a stable code (for example `CSV_ROW_WIDTH`,
  `LIMIT_ROWS`, `MAPPING_CONFLICT`, `WORKER_CRASHED`), shown next to the
  message. The catalogue is `src/web/core/errors.ts`.

## Usage

```bash
npm ci
npm run build
```

Open `dist/hris-reconcile.html` directly in a browser. The file contains the
compiled application and styles and needs nothing beside it. Opening
`src/web/index.html` directly only shows a notice; for development run
`npm run dev` and use the local address printed by Vite.

The guided workflow lets an analyst:

1. upload and profile two CSV files (UTF-8 by default, or Windows-1252 via the
   encoding selector; a UTF-8 decode failure suggests Windows-1252) using
   comma, semicolon, tab, or pipe separators;
2. review an explainable employee-identity suggestion and confirm it;
3. confirm corresponding fields with exact comparison as the default;
4. review observed value-pair frequencies before confirming semantic mappings;
5. run the deterministic reconciliation engine; and
6. explore mismatch-heavy fields, recurring raw-value pairs, and relevant
   employee identities before downloading CSV or JSON results.

To accept a representation difference such as `1` in one system and `0001` in
the other, choose **Value mapping** for that field in step 3. In step 4, review
the observed frequency and consistency, then select **Accept semantic mapping**
for the pair. Identical raw values such as `1 ↔ 1` remain exact matches even on
a field that also has semantic exceptions.

Synthetic sample inputs are in `examples/core_hr_vs_payroll/`.

The interface follows the design reference in `docs/design/theme-reference.css`
(system font stack, light and dark via `prefers-color-scheme`). Step state
(`data-state`: done / active / stale) and result tones (`data-tone`) are set by
pure, unit-tested modules in `src/web/ui/`. An edit that invalidates later steps
marks its step stale and says why ("Results reset because the value mappings
changed."). Worker operations show a progress toast and set `aria-busy`. Focus
moves to the next step's heading after each confirmation, every table has a
caption, and errors appear as a dismissible toast with their code. Review
screenshots of every step (light/dark, desktop/390 px) are written to
`test-results/screenshots/` by the Playwright suite.

Available comparison modes are **Exact** (byte-exact), **Normalized text**
(Unicode NFC, trim, collapse whitespace, casefold), **Value mapping**, and
**Ignore**.

Identity matching is exact by default. Step 2 offers opt-in identity
normalization (trim, strip leading zeros, ignore case), applied to both sides and
recorded in the contract. Duplicate detection runs on the normalized key, so
`00012345` and `12345` in one dataset become a duplicate when leading zeros are
stripped.

## Verification

```bash
npm run typecheck
npm test               # Vitest: engine, analysis, golden files, report schema, CSP build
npm run test:browser   # builds, then Playwright on Chromium, Firefox, WebKit
npm run verify         # the full CI pipeline (see below)
```

The toolchain is pinned to Node 24.21.0 (`.nvmrc`, `engines`).

`npm run build` is the one command that updates the tracked artifact: it writes
`dist/hris-reconcile.html` and nothing else.

Local flow: **edit → `npm run build` → `npm run verify` → commit** (commit the
rebuilt `dist/hris-reconcile.html` together with the source change).

`npm run verify` runs typecheck, Vitest, a fresh build into a temporary
directory, and Playwright, then checks that the fresh build equals the
working-tree `dist/hris-reconcile.html` and that no step changed the working
tree (ignoring `dist/`). It never writes into `dist/`.

`npm run verify:ci` (run by `.github/workflows/ci.yml`, which reads `.nvmrc`)
does the same but compares against the committed `dist/hris-reconcile.html`
and requires a clean working tree. Tests never write to tracked files; review
screenshots go to `test-results/`.

Playwright browsers are a one-time development download:
`npx playwright install chromium firefox webkit`. They are only for tests; the
delivered HTML stays self-contained and offline.

- **Golden files** (`tests_web/fixtures/golden/`) hold the engine's reference
  CSV and JSON outputs. An intended behaviour change regenerates them with
  `UPDATE_GOLDEN=1 npx vitest run tests_web/golden.test.ts`, and the diff is
  reviewed and committed with the change.
- **Schemas** (JSON Schema draft 2020-12): `schemas/report-2.0.schema.json`
  defines the JSON report and `schemas/contract-1.0.schema.json` the contract
  document. Every golden report is validated against the report schema, and
  the report's embedded contract definition must equal the contract schema.
- **Unicode data**: `src/web/core/unicode_casefold.ts` is committed source with
  a SHA-256 pinned by `tests_web/unicode_data.test.ts`.

## JSON report

The JSON report (format 2.0, `schemas/report-2.0.schema.json`) is the audit
record of a run:

- `report_format_version`, and `run_metadata` with the app version (from
  `package.json`), `generated_at` (ISO-8601 UTC), `contract_sha256` (SHA-256
  of the canonical contract JSON: keys sorted by code point, no whitespace), the
  CSV formula-neutralization setting (`excel_safe`), and the limits in effect.
- `sources`: for each file, the logical name, file name, encoding, byte length,
  shape, and a SHA-256 of the raw bytes computed before decoding.
- `contract`: the full contract (identity and its normalizers, fields and
  modes, grouped value mappings) as a contract document with its
  `schema_version`.
- `identity_summary` and `field_comparison_summary`: counts for every status.
- `details`: **identity issues and discrepancies only**. Matched identities
  and matching comparisons are counted in the summaries but not listed.
  `detail_scope` states this in the report itself. **`full.csv` is the
  complete record** of every identity and comparison.

Every detail row carries source rows: the physical line on which the record
starts in its file (header = line 1; quoted multi-line values count every
line). Identity issues list the rows on both sides, including every record of a
duplicate. Comparisons have `left_row` and `right_row`. Both CSV exports have
`left_source_rows` and `right_source_rows` columns, and the UI's identity-issues
and employee-detail tables show the rows.

`schemas/report-1.0.schema.json` is the superseded 1.0 format, kept for
reference.

## Contracts

**Save contract (JSON)** (step 5) downloads the configuration as a contract
document (`schemas/contract-1.0.schema.json`, `schema_version` "1.0").
**Load saved contract** (step 2, after uploading both files) validates it,
checks every required column against the uploaded files (for example
`COLUMNS_MISSING: ... Dataset B is missing 'company_code'`), and pre-fills
every wizard step up to **Run comparison**. Fields whose normalizers the wizard
cannot express (mode `Custom`) are reported, not silently changed.

## Security and privacy

Processing runs locally in the browser tab, and the application makes no
network requests. There is no telemetry, analytics, or AI.

The built file carries a strict Content-Security-Policy:

- `script-src` and `style-src` list only the SHA-256 hashes of the inlined
  blocks, computed at build time (`vite.config.ts`), and there is no
  `'unsafe-inline'`. Any other inline script is blocked.
- `default-src`, `connect-src`, `base-uri`, and `form-action` are `'none'`.
- `worker-src blob:` allows only the inlined worker. Vite's `?worker&inline`
  wrapper contains a `data:` URL fallback for browsers without Blob URLs; that
  fallback is inert under this policy.
- The source-only notice script in `src/web/index.html` is stripped from
  production builds.

`tests_web/csp_build.test.ts` builds into a temporary directory and checks the
hashes against the emitted blocks. A Playwright test checks for zero CSP
violations in Chromium, Firefox, and WebKit.

CSV exports neutralize spreadsheet formulas by default (**Neutralize
spreadsheet formulas in CSV exports**, next to the download buttons): a value
starting with `=`, `+`, `-`, `@`, TAB, CR, or their full-width forms gets a
leading `'`. Plain numbers such as `-12` are left alone. The JSON report
always contains raw values.

Uploaded bytes are parsed in memory and never written by the application. Use
**Clear session / start over** to discard datasets, configuration, and results.
A file is created only when the analyst chooses to download one.

The drill-downs and downloaded reports contain identities and configured field
values, so handle them according to the sensitivity of the input data. The
repository examples use invented names and identifiers only.

## Current limitations

The workbench supports two CSV files, one exact identity key, string fields,
basic normalization, side-specific value mappings, mismatch analysis, and
CSV/JSON reports. It does not yet support:

- Excel input or reporting
- composite identities
- dates, effective dating, or historical records
- numeric types and tolerances
- fuzzy matching

Volume limits (`src/web/core/limits.ts`) are checked before work starts: the
file size before reading, rows and columns after parsing, and the estimated
comparisons (smaller row count × fields) before reconciling. While
reconciling, a run stops early once it has stored more differences than the
limit (`LIMIT_DISCREPANCIES`), which almost always means the identity field or
value mappings are wrong. The limits are 100 MB per file, 200,000 rows, 200
columns, 8,000,000 cells (rows × columns) per file, 6,000,000 comparisons,
and 1,500,000 stored differences. They are based on `npm run bench` (the
figures are in `src/web/core/limits.ts`), which is not part of verify or CI.
That command builds a copy without limits, runs synthetic 10k / 100k /
200k-row × 30-field datasets through Chromium, and writes timings, peak and
retained heap, and export sizes to `test-results/bench/`.

CSV empty cells become explicit nulls. Identity fields receive no implicit
normalization. If an identity is duplicated, it is reported and excluded from
field comparison because any pairing would be arbitrary.

## Releases

The version in `package.json` follows semantic versioning; 2.0.0 introduced
report format 2.0. The build embeds that version (as `app_version` in reports)
and nothing else about the build: no git commit hashes or build timestamps, so
the same source always builds the same bytes.

To release:

1. Set the version: `npm version X.Y.Z --no-git-tag-version`.
2. Follow the local flow (edit → `npm run build` → `npm run verify` → commit).
   Regenerate the goldens if `app_version` appears in them.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

`.github/workflows/release.yml` runs on `v*` tags. It checks that the tag
matches `package.json`, runs `npm run verify:ci` (so the committed
`dist/hris-reconcile.html` must equal a fresh build), and publishes a GitHub
release with `hris-reconcile.html` and `hris-reconcile.html.sha256`. Verify a
download with `sha256sum -c hris-reconcile.html.sha256`.

## History

Earlier versions shipped a Python engine with a YAML CLI, a local-server UI,
and macOS/Windows desktop builds. They were retired on 2026-09-28; the last
commit containing them is `7f3027c`. The browser engine is now the only engine.
Historical implementation briefs are in [docs/archive](docs/archive/).
