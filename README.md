# hris-reconcile

> A deterministic reconciliation engine for HR system landscapes.

`hris-reconcile` compares HR master data across systems that do not share a
technical interface or a common representation. It is designed for migration
discovery, interface preparation, and transparent data-quality analysis across
Core HR, payroll, local HRIS, and file-based datasets.

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
YAML contract ──> validation ───────────────┐
                                            │
CSV files ──> CSV adapter ──> domain records├─> identity resolver
                                            │          │
normalizer registry + semantic mappings ───┘          v
                                              field comparator
                                                      │
                                      ┌───────────────┴──────────────┐
                                      v                              v
                              Rich summary                 JSON report model
```

The reconciliation core uses typed domain records and does not depend on pandas
or openpyxl objects. The CSV adapter currently uses pandas, then converts its
input into immutable dataset containers before the engine sees it. Adapters are
provided to the engine through a protocol, leaving a narrow extension seam for
future file formats.

Important policies are fail-fast:

- Pydantic v2 rejects missing and extra configuration fields.
- Unknown normalizer names and missing mapping references are invalid.
- Empty or ambiguous semantic mappings are invalid.
- Required columns are checked before indexing records.
- Null identities stop a run; duplicate identities receive explicit statuses.

The implementation plan and the decisions behind these boundaries are recorded
in [PLAN.md](PLAN.md).

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

## Quick start

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

All processing and output remain on the local machine. The project sends no
data anywhere and has no network-enabled runtime feature. The default console
summary never prints identities, employee names, or source values. The detailed
JSON report does contain configured field values and identities, so treat its
chosen local output location according to the sensitivity of your real input
data.

The repository examples use invented names and identifiers only.

## Current limitations

This first vertical slice supports two CSV files, one exact identity key, string
fields, basic normalization, side-specific value mappings, console summaries,
and JSON reports. It intentionally does not yet support:

- Excel input or reporting
- composite identities
- dates, effective dating, or historical records
- numeric types and tolerances
- fuzzy matching
- databases, APIs, GUIs, or remote services

CSV empty cells become explicit nulls. Identity fields receive no implicit
normalization. If an identity is duplicated, that identity is reported and
excluded from field comparison because any pairing would be arbitrary.

## Roadmap

Likely next steps are an Excel adapter using the existing dataset boundary,
typed date and numeric comparison policies, composite structured identities,
and configurable local report formats. Effective-dated reconciliation needs a
separate, explicit temporal-selection policy before identity matching; it
should not be hidden inside an input adapter.

Before those additions, revisit memory use for large datasets and decide how
composite identities appear in stable JSON. These concerns are deliberately not
abstracted in the initial slice.
