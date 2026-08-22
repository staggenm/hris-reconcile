import csv
import json
from io import StringIO

from hris_reconcile.config.models import (
    DatasetConfig,
    IdentityConfig,
    ReconciliationContract,
)
from hris_reconcile.identity.models import IdentityResult, IdentityStatus
from hris_reconcile.reconciliation.models import (
    DatasetStatistics,
    FieldComparisonResult,
    FieldComparisonStatus,
    ReconciliationResult,
)
from hris_reconcile.ui.results_analysis import (
    aggregate_mismatches_by_field,
    aggregate_mismatches_by_pair,
    reconciliation_csv,
    reconciliation_json,
)


def field_result(
    identity: str,
    field: str,
    left: str | None,
    right: str | None,
    status: FieldComparisonStatus,
) -> FieldComparisonResult:
    return FieldComparisonResult(
        identity=identity,
        field_name=field,
        left_raw_value=left,
        right_raw_value=right,
        left_normalized_value=left,
        right_normalized_value=right,
        left_canonical_value=None,
        right_canonical_value=None,
        status=status,
    )


def result() -> ReconciliationResult:
    return ReconciliationResult(
        left_dataset=DatasetStatistics("Left", 4, 3),
        right_dataset=DatasetStatistics("Right", 4, 3),
        identity_results=(
            IdentityResult("001", IdentityStatus.MATCHED),
            IdentityResult("002", IdentityStatus.MATCHED),
            IdentityResult("003", IdentityStatus.MATCHED),
            IdentityResult("004", IdentityStatus.MISSING_RIGHT),
        ),
        field_results=(
            field_result("001", "department", "A", "B", FieldComparisonStatus.MISMATCH),
            field_result("002", "department", "A", "B", FieldComparisonStatus.MISMATCH),
            field_result(
                "003", "department", "C", None, FieldComparisonStatus.RIGHT_NULL
            ),
            field_result(
                "001", "name", "Alpha", "Alpha", FieldComparisonStatus.MATCH_EXACT
            ),
            field_result("002", "name", "Beta", "BETA", FieldComparisonStatus.MISMATCH),
            field_result("003", "name", None, None, FieldComparisonStatus.BOTH_NULL),
        ),
    )


def contract() -> ReconciliationContract:
    return ReconciliationContract(
        name="ui_test",
        left=DatasetConfig(name="Left"),
        right=DatasetConfig(name="Right"),
        identity=IdentityConfig(left="id", right="employee_id"),
        fields=[
            {"name": "department", "left": "department", "right": "department"},
            {"name": "name", "left": "name", "right": "name"},
        ],
    )


def test_mismatches_are_grouped_by_field_and_sorted() -> None:
    summaries = aggregate_mismatches_by_field(result())

    assert [item.field_name for item in summaries] == ["department", "name"]
    assert summaries[0].mismatch_count == 3
    assert summaries[0].mismatch_rate_percentage == 100.0
    assert summaries[1].mismatch_count == 1


def test_mismatches_are_grouped_by_raw_value_pair() -> None:
    pairs = aggregate_mismatches_by_pair(result(), field_name="department")

    assert pairs[0].left_value == "A"
    assert pairs[0].right_value == "B"
    assert pairs[0].employee_count == 2
    assert pairs[0].percentage == 66.67
    assert pairs[1].right_value is None


def test_full_and_mismatch_csv_exports_are_in_memory() -> None:
    full_rows = list(
        csv.DictReader(StringIO(reconciliation_csv(result()).decode("utf-8")))
    )
    mismatch_rows = list(
        csv.DictReader(
            StringIO(reconciliation_csv(result(), mismatches_only=True).decode("utf-8"))
        )
    )

    assert len(full_rows) == 10
    assert "left_canonical_value" in full_rows[0]
    assert "right_canonical_value" in full_rows[0]
    assert "mapping_name" in full_rows[0]
    assert any(row["identity_status"] == "MISSING_RIGHT" for row in full_rows)
    assert len(mismatch_rows) == 5
    assert all(
        row["comparison_status"] not in {"MATCH_EXACT", "BOTH_NULL"}
        for row in mismatch_rows
    )


def test_json_export_uses_existing_report_schema() -> None:
    report = json.loads(reconciliation_json(contract(), result()))

    assert report["contract_name"] == "ui_test"
    assert report["run_metadata"]["processing_mode"] == "local"
