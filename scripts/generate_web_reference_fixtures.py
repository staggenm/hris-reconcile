#!/usr/bin/env python3
"""Create the checked-in TypeScript differential reference from Python APIs."""

from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hris_reconcile.adapters.csv_adapter import CsvAdapter  # noqa: E402
from hris_reconcile.config.loader import load_contract  # noqa: E402
from hris_reconcile.config.models import ReconciliationContract  # noqa: E402
from hris_reconcile.reconciliation.engine import ReconciliationEngine  # noqa: E402
from hris_reconcile.reporting.json_report import build_report  # noqa: E402
from hris_reconcile.ui.results_analysis import reconciliation_csv  # noqa: E402

FIXTURE = ROOT / "tests_web/fixtures/python_reference/core_hr_vs_payroll"
STATUS_FIXTURE = ROOT / "tests_web/fixtures/python_reference/status_matrix"
EXAMPLE = ROOT / "examples/core_hr_vs_payroll"


def git_revision() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def outputs(revision: str) -> dict[str, bytes]:
    contract = load_contract(EXAMPLE / "contract.yaml")
    adapter = CsvAdapter()
    left = adapter.load(contract.left, base_directory=EXAMPLE)
    right = adapter.load(contract.right, base_directory=EXAMPLE)
    result = ReconciliationEngine().reconcile(
        contract=contract, left_dataset=left, right_dataset=right
    )
    report = build_report(contract, result)
    return {
        "core_hr.csv": (EXAMPLE / "core_hr.csv").read_bytes(),
        "payroll.csv": (EXAMPLE / "payroll.csv").read_bytes(),
        "contract.yaml": (EXAMPLE / "contract.yaml").read_bytes(),
        "contract.json": (contract.model_dump_json(indent=2) + "\n").encode(),
        "report.json": (report.model_dump_json(indent=2) + "\n").encode(),
        "full.csv": reconciliation_csv(result),
        "mismatches.csv": reconciliation_csv(result, mismatches_only=True),
        "provenance.json": json.dumps(
            {
                "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                "unicode": unicodedata.unidata_version,
                "source_revision": revision,
                "generator": "scripts/generate_web_reference_fixtures.py",
            },
            indent=2,
        ).encode() + b"\n",
    }


def status_outputs(revision: str) -> dict[str, bytes]:
    contract = ReconciliationContract.model_validate({
        "name": "status_matrix",
        "left": {"name": "left"}, "right": {"name": "right"},
        "identity": {"left": "id", "right": "id"},
        "fields": [
            {"name": "text", "left": "text", "right": "text", "normalize": ["trim", "casefold"]},
            {"name": "mapped", "left": "mapped", "right": "mapped", "value_mapping": "codes"},
        ],
        "value_mappings": {"codes": {"CANONICAL": {"left": ["L"], "right": ["R"]}}},
    })
    left_rows = [
        ["001", "Exact", "L"], ["2", " Straße ", "L"], ["3", "Same", "L"],
        ["4", 'left,"quoted"\r\nline', "L"], ["5", "", "L"], ["6", "right", "L"],
        ["7", "", "L"], ["8", "Same", "unknown-left"], ["9", "Same", "L"],
        ["11", "Missing", "L"], ["12", "Duplicate", "L"], ["12", "Duplicate", "L"],
        ["13", "Duplicate", "L"], ["14", "Duplicate", "L"], ["14", "Duplicate", "L"],
    ]
    right_rows = [
        ["001", "Exact", "L"], ["2", "STRASSE", "L"], ["3", "Same", "R"],
        ["4", 'right,"quoted"\r\nline', "L"], ["5", "present", "L"], ["6", "", "L"],
        ["7", "", "L"], ["8", "Same", "R"], ["9", "Same", "unknown-right"],
        ["10", "Missing", "L"], ["12", "Duplicate", "L"], ["13", "Duplicate", "L"],
        ["13", "Duplicate", "L"], ["14", "Duplicate", "L"], ["14", "Duplicate", "L"],
    ]
    def csv_bytes(rows: list[list[str]]) -> bytes:
        stream = io.StringIO(newline="")
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(["id", "text", "mapped"])
        writer.writerows(rows)
        return stream.getvalue().encode()
    left_bytes, right_bytes = csv_bytes(left_rows), csv_bytes(right_rows)
    from hris_reconcile.adapters.csv_adapter import parse_csv_bytes
    left = parse_csv_bytes(left_bytes, name="left")
    right = parse_csv_bytes(right_bytes, name="right")
    result = ReconciliationEngine().reconcile(contract=contract, left_dataset=left, right_dataset=right)
    report = build_report(contract, result)
    return {
        "left.csv": left_bytes, "right.csv": right_bytes,
        "contract.json": (contract.model_dump_json(indent=2) + "\n").encode(),
        "report.json": (report.model_dump_json(indent=2) + "\n").encode(),
        "full.csv": reconciliation_csv(result),
        "mismatches.csv": reconciliation_csv(result, mismatches_only=True),
        "provenance.json": json.dumps({
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "unicode": unicodedata.unidata_version,
            "source_revision": revision,
            "generator": "scripts/generate_web_reference_fixtures.py",
        }, indent=2).encode() + b"\n",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        provenance_path = FIXTURE / "provenance.json"
        if not provenance_path.exists():
            print("reference fixtures are missing; run the generator", file=sys.stderr)
            return 1
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        if provenance["python"] != python_version or provenance["unicode"] != unicodedata.unidata_version:
            print(f"reference requires Python {provenance['python']} / Unicode {provenance['unicode']}", file=sys.stderr)
            return 1
        expected = outputs(provenance["source_revision"])
        mismatches = [name for name, content in expected.items() if not (FIXTURE / name).exists() or (FIXTURE / name).read_bytes() != content]
        status_provenance = json.loads((STATUS_FIXTURE / "provenance.json").read_text(encoding="utf-8"))
        if status_provenance["python"] != python_version or status_provenance["unicode"] != unicodedata.unidata_version:
            print("status matrix fixture uses a different Python/Unicode reference", file=sys.stderr)
            return 1
        status_expected = status_outputs(status_provenance["source_revision"])
        mismatches.extend(f"status_matrix/{name}" for name, content in status_expected.items() if not (STATUS_FIXTURE / name).exists() or (STATUS_FIXTURE / name).read_bytes() != content)
        if mismatches:
            print("fixture differences: " + ", ".join(mismatches), file=sys.stderr)
            return 1
        print("Python reference fixtures match")
        return 0
    FIXTURE.mkdir(parents=True, exist_ok=True)
    for name, content in outputs(git_revision()).items():
        (FIXTURE / name).write_bytes(content)
    STATUS_FIXTURE.mkdir(parents=True, exist_ok=True)
    revision = git_revision()
    for name, content in status_outputs(revision).items():
        (STATUS_FIXTURE / name).write_bytes(content)
    (STATUS_FIXTURE / "README.md").write_text(
        "# Status matrix fixture\n\nSynthetic data generated by the Python contract, CSV adapter, reconciliation engine, and report/export functions. Covers all five identity statuses and all nine field statuses, including duplicate identities on both sides. Regenerate and check with `scripts/generate_web_reference_fixtures.py`.\n",
        encoding="utf-8",
    )
    (FIXTURE / "README.md").write_text(
        "# Python reference fixtures\n\nGenerated from `examples/core_hr_vs_payroll` using the Python contract loader, CSV adapter, reconciliation engine, `build_report`, and `reconciliation_csv`. The committed inputs and outputs are synthetic and ordinary Node tests read only these files. Regenerate with `.venv/bin/python scripts/generate_web_reference_fixtures.py`; verify with `.venv/bin/python scripts/generate_web_reference_fixtures.py --check`. Python and Unicode versions plus source revision are recorded in `provenance.json`.\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
