"""Build and write the stable public JSON report schema."""

from collections import Counter
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from hris_reconcile import __version__
from hris_reconcile.config.models import ReconciliationContract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.models import (
    DatasetStatistics,
    FieldComparisonStatus,
    ReconciliationResult,
)


class ReportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RunMetadataReport(ReportModel):
    format_version: str
    engine_version: str
    processing_mode: str


class DatasetReport(ReportModel):
    name: str
    record_count: int
    column_count: int


class IdentityDetailReport(ReportModel):
    identity: str
    status: IdentityStatus


class FieldComparisonDetailReport(ReportModel):
    identity: str
    field_name: str
    left_raw_value: str | None
    right_raw_value: str | None
    left_normalized_value: str | None
    right_normalized_value: str | None
    left_canonical_value: str | None
    right_canonical_value: str | None
    status: FieldComparisonStatus
    mapping_name: str | None


class ReportDetails(ReportModel):
    identities: list[IdentityDetailReport]
    field_comparisons: list[FieldComparisonDetailReport]


class ReconciliationReport(ReportModel):
    run_metadata: RunMetadataReport
    contract_name: str
    datasets: dict[str, DatasetReport]
    identity_summary: dict[str, int]
    field_comparison_summary: dict[str, int]
    details: ReportDetails


def _dataset_report(statistics: DatasetStatistics) -> DatasetReport:
    return DatasetReport(
        name=statistics.name,
        record_count=statistics.record_count,
        column_count=statistics.column_count,
    )


def build_report(
    contract: ReconciliationContract, result: ReconciliationResult
) -> ReconciliationReport:
    identity_counts = Counter(item.status for item in result.identity_results)
    field_counts = Counter(item.status for item in result.field_results)
    return ReconciliationReport(
        run_metadata=RunMetadataReport(
            format_version="1.0",
            engine_version=__version__,
            processing_mode="local",
        ),
        contract_name=contract.name,
        datasets={
            "left": _dataset_report(result.left_dataset),
            "right": _dataset_report(result.right_dataset),
        },
        identity_summary={
            status.value: identity_counts[status] for status in IdentityStatus
        },
        field_comparison_summary={
            status.value: field_counts[status] for status in FieldComparisonStatus
        },
        details=ReportDetails(
            identities=[
                IdentityDetailReport(identity=item.identity, status=item.status)
                for item in result.identity_results
            ],
            field_comparisons=[
                FieldComparisonDetailReport(
                    identity=item.identity,
                    field_name=item.field_name,
                    left_raw_value=item.left_raw_value,
                    right_raw_value=item.right_raw_value,
                    left_normalized_value=item.left_normalized_value,
                    right_normalized_value=item.right_normalized_value,
                    left_canonical_value=item.left_canonical_value,
                    right_canonical_value=item.right_canonical_value,
                    status=item.status,
                    mapping_name=item.mapping_name,
                )
                for item in result.field_results
            ],
        ),
    )


def write_json_report(
    contract: ReconciliationContract, result: ReconciliationResult, output: Path
) -> None:
    report = build_report(contract, result)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
