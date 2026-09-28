# HTML conversion remediation validation

> **Note (2026-09-28):** The Python engine has been retired. The Python parity and
> fixture-generation steps described below are historical. They were replaced by the
> golden-file tests (`tests_web/golden.test.ts`) and the web-owned report schema
> (`schemas/report-1.0.schema.json`, since superseded by `schemas/report-2.0.schema.json`).

## Findings and fixes

The six review findings map to these changes:

| Finding | Implementation | Regression evidence |
| --- | --- | --- |
| Ambiguous semantic aliases can silently select a winner | Shared per-side raw and normalized alias validation, own-key canonical handling, and one resolver per configured field in [mapping.ts](../src/web/core/mapping.ts), [contract_builder.ts](../src/web/core/contract_builder.ts), and [reconciliation.ts](../src/web/core/reconciliation.ts) | `tests_web/core.test.ts` rejects duplicate aliases in either insertion order and normalized collisions; UI test edits a confirmed mapping and confirms old results disappear |
| JavaScript normalization diverges from Python Unicode behavior | Generated Unicode 15.0 casefold and whitespace data from Python 3.12 in [unicode_casefold.ts](../src/web/core/unicode_casefold.ts) and [generate_web_unicode_data.py](../scripts/generate_web_unicode_data.py) | Focused tests cover sharp S, dotless/dotted I, Greek sigma, ligature, Cherokee, Deseret, U+0085, U+001C, and BOM preservation; differential fixture includes German sharp S |
| Browser exports expose lowercase internal statuses | Exhaustive uppercase public status maps in [export.ts](../src/web/core/export.ts) | Full JSON and both CSV exports compare byte-for-byte with Python fixtures; `test:parity` validates generated TypeScript JSON with Python's `ReconciliationReport` v1 schema |
| Clearing or editing can leave stale data/results visible | Session and per-side upload generations, worker cancellation, centralized result invalidation, DOM clearing, and delayed URL revocation in [main.ts](../src/web/main.ts) and [worker_client.ts](../src/web/worker_client.ts) | Browser tests cover mapping edits, clear after run, and reset while a response is pending; after clear, synthetic identifiers are absent from body text and input values |
| CSV parsing discards records and changes headers | Blank raw-record handling, quoted-empty retention, exact header strings, strict decoding, and prototype-free records in [csv.ts](../src/web/analysis/csv.ts) | Tests cover blank/delimiter-only/quoted-empty rows, whitespace, `__proto__`, spaced headers, and record ordinals; Python differential fixtures cover CRLF multiline fields, quotes, commas, Unicode, nulls, and leading-zero identifiers |
| Large synchronous work blocks interaction | Parsing, profiling, identity suggestions/scoring, observed-pair analysis, reconciliation, aggregations, detail paging, and export generation run in a bundled worker. Full datasets and reconciliation results stay there; the UI receives previews, profiles, summaries, and requested pages. | Delayed-worker test proves Clear remains usable and late results are discarded. Result/detail tables render 100 rows per page. Large-file benchmark and timing evidence are still pending; see remaining limitations. |

## Standalone delivery and visual review

`npm run build` writes `dist/hris-reconcile.html`. The production build inlines the compiled application, stylesheet, and worker source. The production CSP has `connect-src 'none'` and permits only the inlined Blob worker. The source entry adds a styled notice when opened directly; Vite development uses a separate local-only CSP and remains functional.

Automated Playwright opened the artifact through `file://`, copied it to a temporary directory without repository assets, completed uploads and reconciliation, and checked downloads, reset, drag-and-drop, styling, and narrow-window overflow. Synthetic visual captures are checked in under `docs/reviews/html_conversion_screenshots/`:

- `01-upload-desktop.png` — initial upload at 1440 px
- `02-profiles-desktop.png` — uploaded profiles and identity choice
- `03-mappings-desktop.png` — mapping review
- `04-results-desktop.png` — completed results
- `05-results-narrow.png` — completed workflow at 390 px

The screenshot and browser run used Playwright 1.63.0 with Chromium 153.0.8010.12, Firefox 155.0, and Playwright WebKit 26.6 on macOS arm64. All 25 automated cases passed across the three engines (the screenshot case intentionally runs only once in Chromium). Playwright WebKit is not Safari. Native Safari, native Chrome, Microsoft Edge, and Windows verification remain unverified.

The browser test instruments `fetch`, XHR, WebSocket, `sendBeacon`, browser requests, page errors, and CSP messages. The tested workflow recorded no HTTP, HTTPS, or WebSocket requests and no CSP violations. This covers the synthetic normal workflow and delayed worker reset; it does not include the pending large-file benchmark.

## Python references and parity

Reference fixtures are committed under `tests_web/fixtures/python_reference/`. They are generated from the example contract and the Python adapter, reconciliation engine, report builder, and CSV writer. The `status_matrix` fixture covers all five identity statuses and all nine field statuses, including duplicates on both sides and multiline/quoted export cells. The provenance files record Python 3.12.14, Unicode 15.0.0, and source revision `2e7f02df2c7188fdce94cfc2dd4f917c5e7dcbbf`.

Regenerate references with `.venv/bin/python scripts/generate_web_reference_fixtures.py`; verify without rewriting with `.venv/bin/python scripts/generate_web_reference_fixtures.py --check`. Regenerate or verify Unicode data with `.venv/bin/python scripts/generate_web_unicode_data.py` and `--check`. Ordinary `npm test` uses only committed fixture files and does not require Python or an `output/` directory. `npm run test:parity` runs the TypeScript exporter through the Python v1 schema and checks both committed generators.

## Checks run

Passed:

```text
npm run typecheck
npm test                         50 tests passed
npm run test:parity              schema, Python references, Unicode table passed
npm run test:browser             25 passed across Chromium, Firefox, WebKit
npm run build                    dist/hris-reconcile.html, 115.64 KB
.venv/bin/pytest -q              99 tests passed
```

The browser command builds the standalone artifact before testing. To create a new development environment, install Python 3.12 dependencies as described in the README, run `npm ci`, then install test browsers once with `npx playwright install chromium firefox webkit`.

## Remaining limitations

Phase G's core worker architecture is implemented: parsing, profiling, identity suggestions/scoring, observed-pair analysis, reconciliation, aggregation, result paging, and export generation run in the bundled worker. Full CSV datasets and reconciliation results stay in the worker; the UI receives previews, profiles, summaries, and requested result pages. Result pages are fetched in batches of 100, and matching details load only when expanded. Worker responses are session-tagged, and result queries are tied to a specific result revision.

The complete Phase G verification remains pending. The deterministic 25,000-employee / 20-field benchmark, separate >10 MB CSV run, recorded timings, and large-operation manual browser review have not been completed. Mapping evidence is analyzed in the worker, but its complete evidence list is returned to the UI and retained there for editing; it is only paginated in the rendered table. The planned normalized identity-set cache is also not implemented. Therefore the plan's full large-file responsiveness acceptance is not claimed as passed.

Automated Chromium, Firefox, and WebKit checks passed. The requested manual Safari and native Chrome checks on macOS, Microsoft Edge and Chrome on Windows, and cross-platform release screenshots are still pending. Physical memory erasure is not guaranteed; clear releases application references and removes displayed values.
