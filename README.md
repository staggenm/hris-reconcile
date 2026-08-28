# hris-reconcile

> A deterministic reconciliation engine for HR system landscapes.

`hris-reconcile` compares HR master data across systems that do not share a
technical interface or a common representation. It is designed for migration
discovery, interface preparation, and transparent data-quality analysis across
Core HR, payroll, local HRIS, and file-based datasets.

Version 0.3 provides a guided local web workbench for analysts who should not
need to edit YAML or use Python, with an auditable standard-library transport
and no third-party web framework.

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
Browser ──> guarded local API ──┘                    │
                                                    ├──> reconciliation engine
YAML or wizard ──> ReconciliationContract ──────────┘            │
                                                                 v
                                             console or mismatch-first reports
```

The reconciliation core accepts already-loaded typed domain records and does
not depend on the browser, uploaded-file objects, or file paths. The CLI and UI
separately convert their inputs into immutable dataset containers before
invoking the same engine. This keeps a narrow extension seam for future file
formats without creating a second comparison implementation.

Important policies are fail-fast:

- Pydantic v2 rejects missing and extra configuration fields.
- Unknown normalizer names and missing mapping references are invalid.
- Empty or ambiguous semantic mappings are invalid.
- Required columns are checked before indexing records.
- Null identities stop a run; duplicate identities receive explicit statuses.

The implementation plans are recorded in [PLAN.md](PLAN.md),
[PLAN_V0_2.md](PLAN_V0_2.md), and [PLAN_V0_3.md](PLAN_V0_3.md).

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

The launcher opens the browser automatically. It binds the standard-library
server only to `127.0.0.1` on an OS-assigned ephemeral port. Use **Quit** in the
workbench to clear the in-memory session and stop the process. Closing the
browser tab requests the same cleanup immediately, with a 90-second heartbeat
timeout as a fallback. When a browser cannot be opened automatically, packaged
macOS and Windows builds show the local address in a native fallback dialog.

The guided workflow lets an analyst:

1. upload and profile two UTF-8 CSV files using comma, semicolon, tab, or pipe
   separators;
2. review an explainable employee-identity suggestion and confirm it;
3. confirm corresponding fields with exact comparison as the default;
4. review observed value-pair frequencies before confirming semantic mappings;
5. invoke the same deterministic engine used by the CLI; and
6. explore mismatch-heavy fields, recurring raw-value pairs, and relevant
   employee identities before downloading CSV or JSON results.

Uploaded bytes are parsed directly in memory and are never written by the
application. Use **Clear session / start over** to remove uploaded datasets,
configuration, and reconciliation results from memory. Downloads are streamed
to the browser; a file is created only when the analyst chooses to save it.

To accept a representation difference such as `1` in one system and `0001` in
the other, choose **Value mapping** for that field in step 3. In step 4, review
the observed frequency and consistency, then select **Accept semantic mapping**
for the pair. Identical raw values such as `1 ↔ 1` remain exact matches even on
a field that also has semantic exceptions.

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

## Security and privacy

All application processing and output remain on the local machine. The
workbench uses only Python's standard-library HTTP server and local static
assets. It makes no external API, analytics, enrichment, SaaS, telemetry, or AI
calls and loads no remote fonts, scripts, styles, or images.

The launcher generates a fresh 256-bit capability token for every process.
Every API request must carry it in a custom header. Exact `Host` and `Origin`
validation blocks DNS rebinding and cross-origin requests; no CORS responses
are provided. The server listens only on IPv4 loopback at an ephemeral port. A
process audit hook hard-aborts if code attempts a non-loopback connection.

The token is delivered once in the initial URL and immediately removed from
the address bar and browser history. Data, configuration, and results exist
only in memory unless the analyst explicitly downloads a report. The browser
sends a local heartbeat every five seconds; if it disappears for 90 seconds,
the server clears the session and exits so payroll data does not remain in an
orphaned background process.

The CLI summary and UI overview never print employee names or raw source values.
The analyst-requested drill-downs and downloaded reports do contain identities
and configured field values, so handle them according to the sensitivity of
your real input data.

The repository examples use invented names and identifiers only.

### Build and sandbox verification

Build the platform-specific windowed artifact from a fresh environment so
packages installed for development cannot enter the bundle:

```bash
python3.12 -m venv .build-venv
.build-venv/bin/pip install . 'pyinstaller>=6,<7'
.build-venv/bin/pyinstaller --clean --noconfirm hris-reconcile-ui.spec
```

On macOS this creates `dist/HRIS Reconciliation.app`. On Windows, run
`scripts\build_windows.ps1` in PowerShell to create the one-file, console-less
`dist\HRIS-Reconciliation.exe`, then run
`scripts\verify_windows_artifact.ps1`. PyInstaller does not cross-compile, so
each artifact must be built on its target operating system. The macOS app is
currently ad-hoc signed for local verification; distribution still requires a
Developer ID signature and notarization.

The Windows one-file executable extracts application runtime files to a private
temporary `_MEI...` directory while running. It must run as a standard user,
never as administrator. Uploaded datasets, configuration, and results remain
memory-only. See [the Windows release procedure](docs/windows_release.md) for
native security verification and Authenticode signing.

Verify that it completes a full reconciliation while all non-loopback
networking is denied by the operating system:

- Linux: `unshare -n ./dist/hris-reconcile-ui` (configure loopback inside the
  namespace if the distribution does not do so automatically).
- macOS:
  `sandbox-exec -p '(version 1) (allow default) (deny network-outbound)' 'dist/HRIS Reconciliation.app/Contents/MacOS/hris-reconcile-ui'`.
  This profile also denies loopback outbound and works because the server is
  inbound-only; it must be revised if the application ever initiates loopback
  connections.
- Windows: create an outbound-block firewall rule for
  `dist\\hris-reconcile-ui.exe`, then run it and complete the wizard.

The expected result for the bundled CSV example is 9 matched employees, one
employee missing on each side, and the field totals shown below. This turns the
no-external-network property into a repeatable verification rather than relying
on dependency behavior.

### Deferred decisions

Version 0.3 deliberately keeps browser file inputs. Selected bytes travel from
disk to browser memory and then through the guarded loopback socket to server
memory. Native file dialogs are deferred to the v0.4 desktop shell, where they
can be added without fragile main-thread coordination. Contract export/import
is also deferred as the first v0.4 feature.

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
