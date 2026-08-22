import json
from collections import Counter
from pathlib import Path

from typer.testing import CliRunner

from hris_reconcile.adapters.csv_adapter import CsvAdapter
from hris_reconcile.cli import app
from hris_reconcile.config.loader import load_contract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.engine import ReconciliationEngine
from hris_reconcile.reconciliation.models import FieldComparisonStatus
from hris_reconcile.reporting.json_report import write_json_report

EXAMPLE_DIRECTORY = Path(__file__).parent.parent / "examples" / "core_hr_vs_payroll"
CONTRACT_PATH = EXAMPLE_DIRECTORY / "contract.yaml"


def example_result():
    contract = load_contract(CONTRACT_PATH)
    adapter = CsvAdapter()
    result = ReconciliationEngine().reconcile(
        contract=contract,
        left_dataset=adapter.load(contract.left, base_directory=EXAMPLE_DIRECTORY),
        right_dataset=adapter.load(contract.right, base_directory=EXAMPLE_DIRECTORY),
    )
    return contract, result


def test_example_reconciliation_has_expected_counts() -> None:
    _, result = example_result()

    identity_counts = Counter(item.status for item in result.identity_results)
    field_counts = Counter(item.status for item in result.field_results)
    assert identity_counts == {
        IdentityStatus.MATCHED: 9,
        IdentityStatus.MISSING_LEFT: 1,
        IdentityStatus.MISSING_RIGHT: 1,
    }
    assert field_counts == {
        FieldComparisonStatus.MATCH_EXACT: 15,
        FieldComparisonStatus.MATCH_NORMALIZED: 2,
        FieldComparisonStatus.MATCH_MAPPED: 8,
        FieldComparisonStatus.MISMATCH: 1,
        FieldComparisonStatus.UNMAPPED_LEFT: 1,
    }


def test_json_report_has_deliberate_schema(tmp_path: Path) -> None:
    contract, result = example_result()
    output = tmp_path / "result.json"

    write_json_report(contract, result, output)
    report = json.loads(output.read_text(encoding="utf-8"))

    assert report["run_metadata"]["format_version"] == "1.0"
    assert report["contract_name"] == "core_hr_vs_payroll"
    assert report["datasets"]["left"]["record_count"] == 10
    assert report["identity_summary"]["MATCHED"] == 9
    assert report["field_comparison_summary"]["UNMAPPED_LEFT"] == 1
    assert len(report["details"]["field_comparisons"]) == 27


def test_cli_runs_example_without_printing_pii(tmp_path: Path) -> None:
    output = tmp_path / "report.json"

    invocation = CliRunner().invoke(
        app, ["run", str(CONTRACT_PATH), "--output", str(output)]
    )

    assert invocation.exit_code == 0, invocation.output
    assert "HRIS Reconciliation" in invocation.output
    assert "Matched" in invocation.output
    assert "Zephyra" not in invocation.output
    assert output.exists()
