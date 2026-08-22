# hris-reconcile

> A deterministic reconciliation engine for HR system landscapes.

`hris-reconcile` compares HR master data across systems that do not share a
technical interface or a common representation. It is designed for migration
discovery, interface preparation, and transparent data-quality analysis across
Core HR, payroll, local HRIS, and file-based datasets.

Version 0.2 adds a guided local web workbench for analysts who should not need
to edit YAML or use Python.

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

A YAML reconciliation contract therefore declares both structural
correspondence and meaning:

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
YAML CLI ──> file CSV adapter ──┐
                                ├──> domain Dataset ──┐
Web UI ──> uploaded CSV adapter ┘                    │
                                                    ├──> reconciliation engine
YAML or wizard ──> ReconciliationContract ──────────┘            │
                                                                 v
                                             console or mismatch-first reports
```

The reconciliation core accepts already-loaded typed domain records and does
not depend on pandas, openpyxl, Streamlit, uploaded-file objects, or file paths.
The CLI and UI separately convert their inputs into immutable dataset
containers before invoking the same engine. This keeps a narrow extension seam
for future file formats without creating a second comparison implementation.

Important policies are fail-fast:

- Pydantic v2 rejects missing and extra configuration fields.
- Unknown normalizer names and missing mapping references are invalid.
- Empty or ambiguous semantic mappings are invalid.
- Required columns are checked before indexing records.
- Null identities stop a run; duplicate identities receive explicit statuses.

The initial implementation plan is recorded in [PLAN.md](PLAN.md). The v0.2
boundary audit, suggestion formulas, privacy controls, and deferred decisions
are recorded in [PLAN_V0_2.md](PLAN_V0_2.md).

## Installation

Python 3.12 or newer is required.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

For development and verification:

```bash
python -m pip install -e '.[dev]'
pytest
ruff check .
mypy src
```

## Local web UI

Start the private local workbench:

```bash
hris-reconcile-ui
```

Then open `http://127.0.0.1:8501` if the browser does not open automatically.
The launcher forces Streamlit to bind only to `127.0.0.1`, runs headless, and
disables usage-statistics gathering. The same controls are declared in
`.streamlit/config.toml`.

The guided workflow lets an analyst:

1. upload and profile two UTF-8 CSV files using comma, semicolon, tab, or pipe
   separators;
2. review an explainable employee-identity suggestion and confirm it;
3. confirm corresponding fields with exact comparison as the default;
4. review observed value-pair frequencies before confirming semantic mappings;
5. invoke the same deterministic engine used by the CLI; and
6. explore mismatch-heavy fields, recurring raw-value pairs, and relevant
   employee identities before downloading CSV or JSON results.

Uploaded bytes are parsed directly in memory and are not intentionally written
to disk. Use **Clear session / start over** to remove uploaded datasets,
configuration, and reconciliation results from the active Streamlit session.

To accept a representation difference such as `1` in one system and `0001` in
the other, choose **Value mapping** for that field in step 3. In step 4, review
the observed frequency and consistency, then select **Accept semantic mapping**
for the pair. Identical raw values such as `1 ↔ 1` remain exact matches even on
a field that also has semantic exceptions.

For development, the equivalent command is:

```bash
streamlit run src/hris_reconcile/ui/app.py
```

Run that command from the repository root so `.streamlit/config.toml` is read.
The packaged `hris-reconcile-ui` command is safer when running elsewhere because
it repeats all privacy-related settings explicitly.

## YAML CLI quick start

Run the included synthetic example from the repository root:

```bash
hris-reconcile run examples/core_hr_vs_payroll/contract.yaml
```

The default report path is `output/core_hr_vs_payroll.json`. Choose another
local path with `--output PATH`.

## Contract example

```yaml
name: core_hr_vs_payroll

left:
  name: core_hr
  type: csv
  path: core_hr.csv

right:
  name: payroll
  type: csv
  path: payroll.csv

identity:
  left: person_id
  right: employee_number

fields:
  - name: first_name
    left: first_name
    right: given_name
    normalize: [trim, casefold]

  - name: company
    left: company
    right: company_code
    value_mapping: company

value_mappings:
  company:
    DE_GERMANY:
      left: [DE01]
      right: ["1000"]
    CH_SWITZERLAND:
      left: [CH01]
      right: ["2000"]
```

Dataset paths are resolved relative to the contract file. Available string
normalizers are `trim`, `uppercase`, `lowercase`, `casefold`, and
`collapse_whitespace`; they run in the listed order. Mapping aliases are
normalized by the same configured chain before lookup.

## Example output

The console intentionally displays aggregates only:

```text
HRIS Reconciliation
Contract: core_hr_vs_payroll

Records
Matched                 9
Missing in left         1
Missing in right        1
Duplicate in left       0
Duplicate in right      0

Field comparisons
Exact                  15
Normalized              2
Mapped                  8
Mismatch                1
Unmapped                1
Left null               0
Right null              0
Both null               0

JSON report written to:
output/core_hr_vs_payroll.json
```

The JSON report has a versioned run-metadata section, contract and dataset
statistics, complete identity and field-status summaries, and detailed decision
records. It is shaped by a dedicated public report model rather than being a raw
serialization of engine internals.

## Privacy

All application processing and output remain on the local machine. The project
makes no external API, analytics, enrichment, SaaS, telemetry, or AI calls. It
loads no remote fonts, JavaScript, or other web assets. Streamlit serves the UI
on the loopback address only and its usage statistics are disabled.

The CLI summary and UI overview never print employee names or raw source values.
The analyst-requested drill-downs and downloaded reports do contain identities
and configured field values, so handle them according to the sensitivity of
your real input data.

The repository examples use invented names and identifiers only.

## Current limitations

The CLI and local workbench support two CSV files, one exact identity key,
string fields, basic normalization, side-specific value mappings, mismatch
analysis, and local CSV/JSON reports. They intentionally do not yet support:

- Excel input or reporting
- composite identities
- dates, effective dating, or historical records
- numeric types and tolerances
- fuzzy matching
- databases, APIs, authentication, multi-user hosting, or remote services

CSV empty cells become explicit nulls, and separators are detected from comma,
semicolon, tab, or pipe. Identity fields receive no implicit normalization. If
an identity is duplicated, that identity is reported and excluded from field
comparison because any pairing would be arbitrary.

## Roadmap

Likely next steps are an Excel adapter using the existing dataset boundary,
typed date and numeric comparison policies, composite structured identities,
exportable wizard contracts, and configurable local report formats.
Effective-dated reconciliation needs a separate, explicit temporal-selection
policy before identity matching; it should not be hidden inside an input
adapter.

Before those additions, revisit memory use for large datasets and decide how
composite identities appear in stable JSON. These concerns are deliberately not
abstracted in the initial slice.
