# Implementation Plan

## Goal

Build a thin, local-only vertical slice of **hris-reconcile**: load a validated
YAML contract, read two CSV datasets, reconcile one string identity key, compare
configured string fields through explicit normalization and semantic mappings,
render a PII-free console summary, and write a deliberate JSON report.

## Concrete project structure

```text
pyproject.toml
README.md
PLAN.md
examples/core_hr_vs_payroll/
    contract.yaml
    core_hr.csv
    payroll.csv
src/hris_reconcile/
    __init__.py
    cli.py
    config/
        loader.py
        models.py
    adapters/
        base.py
        csv_adapter.py
    normalization/
        builtins.py
        registry.py
    mapping/
        models.py
        resolver.py
    identity/
        models.py
        resolver.py
    reconciliation/
        comparator.py
        engine.py
        models.py
    reporting/
        console.py
        json_report.py
tests/
    ...modules mirroring the responsibilities above...
```

Every module listed has an immediate responsibility. Package marker files are
the only intentionally minimal files.

## Key domain models

- `ReconciliationContract`, `DatasetConfig`, `IdentityConfig`, `FieldConfig`,
  and mapping configuration models: immutable Pydantic models that validate the
  external contract and reject unknown keys.
- `Record`: adapter-independent `Mapping[str, str | None]`; adapters return a
  `Dataset` containing records and column metadata.
- `IdentityStatus`: `MATCHED`, `MISSING_LEFT`, `MISSING_RIGHT`,
  `DUPLICATE_LEFT`, `DUPLICATE_RIGHT`.
- `IdentityResult`: identity plus status and optional unique records. Duplicate
  identities are excluded from field comparison because pairing duplicates
  would be arbitrary.
- `MappingResolution`: a typed state (`MAPPED`, `UNMAPPED`, `NULL`) plus an
  optional canonical value. Unmapped source values are never passed through.
- `FieldComparisonStatus`: the nine requested comparison outcomes.
- `FieldComparisonResult`: identity, field, raw/normalized/canonical values,
  mapping name, and typed status, retaining the full decision trail.
- `ReconciliationResult`: contract/dataset statistics, identity results, and
  field results. A separate report model shapes JSON output rather than dumping
  this internal object graph.

## Architecture and decisions

1. **Dependency direction.** The engine consumes a `DatasetAdapter` protocol and
   plain domain records. Only `CsvAdapter` imports pandas. The CLI constructs the
   concrete adapter and engine.
2. **Contract paths.** Relative dataset paths resolve relative to the contract
   file, not the process working directory. The validated contract keeps paths
   declarative; the loader returns path context separately.
3. **String and null semantics.** CSV input is read as strings with pandas NA
   conversion disabled. Empty CSV cells are converted explicitly to `None` at
   the adapter boundary. Whitespace-only text remains a value unless `trim` or
   another configured normalizer transforms it.
4. **Identity values.** Identity matching is exact and receives no implicit
   normalization. Null/empty identities fail dataset validation because they
   cannot be reconciled deterministically. Duplicate identities generate typed
   duplicate results and are not arbitrarily paired.
5. **Comparison precedence.** Null states are decided first, followed by raw
   equality as `MATCH_EXACT`. For differing representations, a configured
   mapping must resolve both sides; an unmapped side gets its explicit status
   and equal canonical values are `MATCH_MAPPED`. Without mapping, normalized
   equality is `MATCH_NORMALIZED`, otherwise the result is `MISMATCH`. Exact
   precedence lets mappings describe exceptions such as `1 ↔ 0001` without
   forcing already-identical values through a comprehensive mapping table.
6. **Mapping validity.** Canonical entries require non-empty `left` and `right`
   lists. A source value may map to only one canonical value per side. This is
   checked at contract validation time so resolution is deterministic.
7. **Normalization validity.** Normalizer names are a closed enum in the
   contract and are also resolved through a registry at startup. Unknown names
   fail validation rather than being ignored.
8. **Output location.** By default the report is written to
   `output/<contract-name>.json` relative to the current directory. The CLI
   creates the output directory and may accept an explicit output path.
9. **Privacy.** The default Rich view contains aggregate counts only. Detailed
   values are written only to the requested local JSON report; no logging,
   telemetry, network, or external service is used.

## Incremental test-first sequence

1. Add project metadata and failing tests for contract loading/validation,
   normalizers, and mapping resolution; implement the smallest code that passes.
2. Add failing tests for CSV conversion/required columns and identity matching;
   implement adapter and resolver.
3. Add failing comparator tests for every requested status; implement explicit
   comparison precedence and explainable results.
4. Add a failing end-to-end test using synthetic fixtures; implement engine,
   summaries, JSON schema, Rich rendering, and Typer command.
5. Add the public synthetic example and README, exercise the installed CLI, and
   review extension seams for Excel and effective-dated data.

After each increment run its focused tests, `ruff check .`, and `mypy src`; fix
all failures without weakening assertions or static-analysis settings. Finish
with the complete required command suite and a real example CLI run.

## Decisions to revisit before later roadmap work

- Excel adapters may need sheet/range/header-row options, but should still emit
  the same `Dataset` boundary type.
- Composite identity keys will require an immutable structured identity and a
  JSON-safe display representation rather than string concatenation.
- Effective dating requires an explicit temporal selection/matching policy
  before identity reconciliation; it must not be hidden in an adapter.
- Date and numeric comparison need typed parsed values and field-specific
  policies without changing raw-value retention.
- Large datasets may motivate streaming or indexed storage. The initial
  in-memory dataset is intentionally simple and should not leak into comparator
  APIs.
