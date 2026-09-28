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
  queries; `src/web/worker_client.ts` is the main-thread client.
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

1. upload and profile two UTF-8 CSV files using comma, semicolon, tab, or pipe
   separators;
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
npm test               # Vitest: engine, analysis, golden files, report schema
npm run test:browser   # builds, then Playwright on Chromium, Firefox, WebKit
```

Playwright browsers are a one-time development download:
`npx playwright install chromium firefox webkit`. They are only for tests; the
delivered HTML stays self-contained and offline.

- **Golden files** (`tests_web/fixtures/golden/`) hold the engine's reference
  CSV and JSON outputs. An intended behaviour change regenerates them with
  `UPDATE_GOLDEN=1 npx vitest run tests_web/golden.test.ts`, and the diff is
  reviewed and committed with the change.
- **Report schema**: `schemas/report.schema.json` (JSON Schema draft 2020-12)
  defines the JSON report. Every golden report is validated against it.
- **Unicode data**: `src/web/core/unicode_casefold.ts` is committed source with
  a SHA-256 pinned by `tests_web/unicode_data.test.ts`.

## JSON report

The JSON report has a versioned run-metadata section, contract and dataset
statistics, complete identity and field-status summaries, and detailed decision
records. Its shape is defined by `schemas/report.schema.json`.

## Security and privacy

All processing happens in the browser tab. The application makes no network
requests: the Content-Security-Policy sets `connect-src 'none'`, loads no
remote fonts, scripts, styles, or images, and only allows the inlined worker
through `worker-src blob:`. There is no telemetry, analytics, or AI.

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

CSV empty cells become explicit nulls. Identity fields receive no implicit
normalization. If an identity is duplicated, it is reported and excluded from
field comparison because any pairing would be arbitrary.

## History

Earlier versions shipped a Python engine with a YAML CLI, a local-server UI,
and macOS/Windows desktop builds. They were retired on 2026-09-28; the last
commit containing them is `7f3027c`. The browser engine is now the only engine.
Historical implementation briefs are in [docs/archive](docs/archive/).
