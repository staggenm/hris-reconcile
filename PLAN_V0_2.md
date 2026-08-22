# v0.2 Implementation Plan: Local Reconciliation Workbench

## Outcome

Add a restrained, fully local Streamlit workflow that helps an HRIS analyst
discover why two uploaded CSV extracts disagree. The UI will profile files,
suggest but never silently choose identities and corresponding fields, collect
semantic mappings, invoke the existing deterministic reconciliation domain,
prioritize mismatch patterns, and generate local in-memory downloads.

The v0.1 CLI and YAML workflow remain supported.

## v0.1 boundary audit

### What is already reusable

- `adapters.base.Dataset` is an adapter-independent, immutable container of a
  dataset name, column names, and plain string/null records.
- Identity resolution, normalization, mapping resolution, field comparison,
  result models, and JSON report construction consume domain values only.
- pandas is confined to `CsvAdapter`; neither reconciliation nor reporting
  consumes DataFrames.
- The validated `ReconciliationContract` is suitable for both YAML and a wizard
  once dataset source location is no longer mandatory.

### Current coupling that blocks clean uploads

`ReconciliationEngine` currently receives adapter implementations, reads
`DatasetConfig.path`, and loads both datasets before reconciling. Consequently,
an uploaded byte stream could only enter by inventing a filesystem path,
persisting sensitive data temporarily, or teaching the core about a UI object.

`DatasetConfig` also requires `type: csv` and `path`, although comparison only
needs a logical dataset name. Those are source-loading concerns used by the CLI,
not reconciliation rules.

### Minimum refactor

1. Change the primary engine API to:

   ```python
   engine.reconcile(
       contract=contract,
       left_dataset=left_dataset,
       right_dataset=right_dataset,
   )
   ```

   The engine will validate required columns and perform reconciliation, but
   will not construct or call adapters.

2. Move CSV path loading to the CLI composition root. The CLI will load the YAML
   contract, require its file source details, call `CsvAdapter`, then pass the
   resulting domain datasets to the same engine used by the web UI.

3. Allow a contract dataset descriptor to contain only a logical `name`, while
   requiring `type` and `path` to appear together when present. Existing YAML is
   unchanged and remains strict. The wizard uses name-only descriptors; it never
   invents a path for uploaded data.

4. Add a bytes-based CSV adapter that accepts `bytes` and a logical name—not a
   Streamlit `UploadedFile`. The Streamlit renderer extracts bytes at its outer
   boundary and immediately converts them into `Dataset`.

This is deliberately smaller than creating parallel “file contract” and
“domain contract” hierarchies. If additional source types later need complex
options, source loading should move into a distinct CLI input specification
instead of continuing to grow `DatasetConfig`.

## Target dependency flow

```text
YAML loader ──> file CSV adapter ─┐
                                 │
                                 v
                          domain Dataset ──┐
                                          │
YAML contract ─────────────────────────────┼──> ReconciliationEngine
                                          │
wizard contract + uploaded CSV adapter ───┘
```

Streamlit may use pandas to render small tables, but Streamlit objects and
DataFrames will not cross into profiling, suggestion, mapping-analysis,
contract-building, aggregation, or reconciliation functions.

## New testable application logic

The following modules contain no Streamlit imports:

- `adapters/csv_adapter.py` plus `ui/csv_upload.py`: shared strict
  UTF-8/UTF-8-BOM CSV bytes parsing with deterministic comma, semicolon, tab,
  or pipe delimiter detection, explicit empty
  file/header/duplicate-header/parser errors, and conversion to `Dataset`; the
  UI boundary accepts bytes and never a Streamlit object.
- `ui/profiling.py`: lightweight per-column counts, null rate, distinct count,
  uniqueness, and bounded non-null samples.
- `ui/suggestions.py`: explainable identity-pair and field-pair scoring.
- `ui/mapping_analysis.py`: observed value-pair frequencies and one-to-one
  consistency among uniquely matched identities.
- `ui/contract_builder.py`: typed wizard selections converted into the existing
  `ReconciliationContract`; exact is the default and ignored fields are omitted.
- `ui/results_analysis.py`: discrepancy-by-field and raw-value-pair aggregation,
  relevant employee drill-down rows, and in-memory CSV/JSON export bytes.

These responsibilities are grouped rather than split into a module per screen.
Streamlit rendering stays in `ui/app.py`, with a small `ui/launcher.py` for the
`hris-reconcile-ui` console command.

## Deterministic suggestion policies

### Identity

Every left/right column pair receives a score composed from:

- normalized header similarity;
- whether both headers explicitly resemble identifier fields (`id`, `number`,
  `key`, or `identifier`);
- the lower of the two non-null percentages;
- the lower of the two uniqueness percentages; and
- set overlap after explicit conservative `trim + casefold` normalization.

The top candidate is displayed with component evidence. Only a configured
threshold marks it as high confidence; even then the analyst must confirm both
dropdowns. No record pairing in the engine becomes fuzzy or implicit.

### Fields

Header scoring combines normalized character similarity and token similarity,
with a small, documented HR vocabulary for common equivalents such as
`first/given`, `last/surname`, and `standard/weekly hours`. Exact normalized
header matches rank highest. Suggestions above a conservative threshold are
presented, never auto-run. Identity columns are excluded.

Data-driven field correspondence scoring is deferred: it risks conflating a
systematic mismatch with evidence that fields correspond. v0.2 will instead
show observed pair evidence only after the user deliberately chooses a value-
mapping field.

### Value mapping evidence

For unique matched identities, count each observed `(left value, right value)`
pair. Consistency is the minimum of:

- the pair's share among observations for its left value; and
- the pair's share among observations for its right value.

This makes one-to-many and many-to-one relationships visibly weak. Non-null
pairs at or above a high threshold may be preselected as suggestions, but the
user must confirm them. Null pairs remain visible evidence and cannot become
semantic mapping aliases.

Raw equality has precedence over semantic mapping: `1 ↔ 1` remains
`MATCH_EXACT`, while an accepted exception such as `1 ↔ 0001` can become
`MATCH_MAPPED`. This avoids requiring exhaustive mapping tables for fields that
only have a few representation differences.

## Streamlit workflow

One application page uses six explicit steps stored in session state:

1. **Upload datasets** — two uploaders, logical names, bounded previews, and
   profiling tables. Parsing failures are displayed without a traceback.
2. **Match employees** — explainable suggestion, user-controlled selectors,
   population/uniqueness evidence, and conservative-overlap evidence.
3. **Match fields** — editable mapping rows with `Exact` as default and modes
   `Exact`, `Normalized text`, `Value mapping`, and `Ignore`. Duplicate use is
   rejected before continuing.
4. **Review value mappings** — observed pair counts/consistency and an explicit
   “Accept semantic mapping” confirmation for proposed equivalences.
5. **Run comparison** — build and validate the domain contract, then call the
   injected-dataset engine. Errors remain on the page and preserve the wizard.
6. **Explore discrepancies** — PII-free metrics, mismatch-first field ranking,
   raw pair patterns, identity-only drill-down, optional match details, and
   locally generated CSV/JSON download buttons.

A “Clear session / start over” action deletes wizard, dataset, and result keys
from session state and reruns the app. Uploaded bytes are never intentionally
written to disk.

## Privacy and runtime controls

- `.streamlit/config.toml` binds the server to `127.0.0.1`, runs headless, and
  disables usage-statistics gathering.
- The launcher repeats those settings as command arguments so behavior is safe
  even if invoked outside the repository directory.
- No runtime module will import HTTP clients, open URLs, add external assets,
  perform enrichment, or call analytics/AI services.
- The UI displays the required local-processing notice prominently.
- The top-level results view contains aggregates only. Raw values appear only
  in analyst-requested mismatch tables and downloads.

## Test-first increments

1. Add failing engine-injection and in-memory CSV validation tests; refactor the
   engine/CLI and implement the parser. Re-run all v0.1 tests, Ruff, and mypy.
2. Add failing profiling, identity suggestion, field suggestion, and observed
   pair tests; implement pure functions and re-run quality gates.
3. Add failing contract generation, mismatch aggregation, and export tests;
   implement them and re-run quality gates.
4. Add Streamlit, configuration, launcher, and the six-step renderer. Keep UI
   tests light; smoke-import and launch the real server on localhost.
5. Update README/version metadata and run the full acceptance suite, legacy CLI
   example, package dependency check, localhost binding check, and a source audit
   for network-capable calls or Streamlit leakage into the core.

## Decisions to revisit after v0.2

- Large uploaded files are held in memory twice briefly (uploaded bytes and
  domain records); introduce streaming only with measured need.
- CSV encoding is intentionally explicit rather than guessed. Supporting
  analyst-selected encodings can be added without changing `Dataset`.
- Field suggestions use a small transparent vocabulary. Data-driven evidence
  may improve ranking later, but should remain separately visible and weighted.
- Composite identity, dates, numeric tolerances, and effective dating require
  domain contract changes and remain outside the UI prototype.
- If input source options expand significantly, split file source definitions
  from `ReconciliationContract` instead of making optional fields proliferate.
