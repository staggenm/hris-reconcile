# Changelog

All notable changes to the HRIS Reconciliation workbench. Versions follow
[semantic versioning](https://semver.org/); the version is embedded in every JSON
report as `run_metadata.app_version`.

## 2.0.0 (unreleased; tagged after user acceptance testing)

The browser workbench is now the only engine. The Python engine, YAML CLI,
local-server UI, and desktop builds were retired (last present in commit
`7f3027c`).

### Breaking

- **JSON report format 2.0** (`schemas/report-2.0.schema.json`; 1.0 kept for
  reference in `schemas/report-1.0.schema.json`). Consumers of 1.0 reports must
  be updated:
  - `report_format_version: "2.0"` replaces `run_metadata.format_version`.
  - `contract` (the full contract document) replaces `contract_name`;
    `sources` replaces `datasets`.
  - `details` lists **identity issues and discrepancies only** (stated in
    `detail_scope`). Matches are counted in the summaries. `full.csv` remains
    the complete record.
  - New identity statuses `MISSING_IDENTITY_LEFT` / `MISSING_IDENTITY_RIGHT`.
  - Detail rows carry source line numbers (`left_rows` / `right_rows`,
    `left_row` / `right_row`).
- **CSV exports** gain two trailing columns, `left_source_rows` and
  `right_source_rows`, and neutralize spreadsheet formulas by default (see
  Security).
- **Value mappings** no longer throw for rows that share a canonical value;
  they are grouped. Only one value mapped to different canonical values is an
  error (`MAPPING_CONFLICT`).

### Security

- CSV formula-injection protection (`excelSafe`, on by default): values starting
  with `=`, `+`, `-`, `@`, TAB, CR, or their full-width forms get a leading
  `'`; plain numbers are exempt; JSON stays raw. The toggle is next to the
  download buttons.
- Content-Security-Policy without `'unsafe-inline'`: SHA-256 hashes of the
  inlined script and style, computed at build time; `base-uri 'none'`,
  `form-action 'none'`, `connect-src 'none'`, workers only from `blob:`. The
  source-only notice and the unused module-preload `fetch` path are removed from
  the build.
- Build-time test of the CSP hashes; browser tests for zero CSP violations in
  Chromium, Firefox, and WebKit.
- Stable error codes on every error, shown in the UI.

### Correctness

- N:1 and 1:N value mappings; the default canonical value is the Dataset B
  value, so N:1 needs no manual edits.
- Collision-free grouping keys (values such as `<null>` or `a|||b` no longer
  merge with other values).
- "Normalized text" applies Unicode NFC first; Exact stays byte-exact.
- Null or all-whitespace identities are reported as `MISSING_IDENTITY_*`
  instead of aborting the run.
- Output order is by Unicode code point, independent of the browser locale.
- Opt-in identity normalization (trim, strip leading zeros, ignore case),
  recorded in the contract; duplicates are detected after normalization.

### Scale

- Benchmarked limits: 100 MB per file, 200,000 rows, 200 columns, 8,000,000
  cells per file, 6,000,000 comparisons, 1,500,000 stored differences (the last
  is checked during the run and stops it early).
- Summary-first results: only differences are stored; matching details and
  `full.csv` are recomputed on demand.
- Exports stream from the worker into a `Blob`; no report-sized string.
- Column profiles and value sets are computed once per dataset.
- Worker crash recovery: the session resets with a clear message
  (`WORKER_CRASHED`) instead of leaving a broken wizard.
- Windows-1252 encoding option; a UTF-8 decode failure suggests it.
- `npm run bench` (not part of CI) measures timings and memory.

### Audit

- Report metadata: app version, `generated_at` (UTC), `contract_sha256`,
  `excel_safe`, limits in effect, and per source file its name, encoding, size,
  and SHA-256 of the raw bytes.
- Source line numbers for every detail row and identity issue, in the UI and
  all exports.
- Save and load contracts (`schemas/contract-1.0.schema.json`); loading checks
  the uploaded columns and pre-fills the wizard. Contracts the wizard cannot
  represent are shown read-only and can be run as-is.
- Release workflow: tagged builds are verified and published with a
  `.sha256` checksum.

### UI

- New theme (system fonts, light and dark mode) with explicit step states
  (done / active / stale) and value-aware result tones.
- An edit that invalidates later steps says why ("Results reset because the
  value mappings changed.").
- Progress toast and `aria-busy` during processing; actions are disabled until
  it finishes.
- Accessibility: focus moves to the next step, tables have captions and header
  scopes, errors are a dismissible toast, only `.csv` files are accepted.
- Identity-issues table with source rows; row columns in the detail tables.
- Smaller main bundle (contract logic runs in the worker).
