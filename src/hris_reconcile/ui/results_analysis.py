"""Mismatch-first aggregation and local in-memory result exports."""

import csv
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from io import StringIO

from hris_reconcile.config.models import ReconciliationContract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.models import (
    FieldComparisonResult,
    FieldComparisonStatus,
    ReconciliationResult,
)
from hris_reconcile.reporting.json_report import build_report

DISCREPANCY_STATUSES = frozenset(
    {
        FieldComparisonStatus.MISMATCH,
        FieldComparisonStatus.LEFT_NULL,
        FieldComparisonStatus.RIGHT_NULL,
        FieldComparisonStatus.UNMAPPED_LEFT,
        FieldComparisonStatus.UNMAPPED_RIGHT,
    }
)


class _Unset(Enum):
    TOKEN = "unset"


def is_discrepancy(result: FieldComparisonResult) -> bool:
    return result.status in DISCREPANCY_STATUSES


@dataclass(frozen=True)
class FieldMismatchSummary:
    field_name: str
    mismatch_count: int
    comparison_count: int
    mismatch_rate_percentage: float


def aggregate_mismatches_by_field(
    result: ReconciliationResult,
) -> tuple[FieldMismatchSummary, ...]:
    totals = Counter(item.field_name for item in result.field_results)
    mismatches = Counter(
        item.field_name for item in result.field_results if is_discrepancy(item)
    )
    summaries = [
        FieldMismatchSummary(
            field_name=field,
            mismatch_count=count,
            comparison_count=totals[field],
            mismatch_rate_percentage=round(count / totals[field] * 100, 2),
        )
        for field, count in mismatches.items()
    ]
    summaries.sort(key=lambda item: (-item.mismatch_count, item.field_name))
    return tuple(summaries)


@dataclass(frozen=True)
class PairMismatchSummary:
    field_name: str
    left_value: str | None
    right_value: str | None
    status: FieldComparisonStatus
    employee_count: int
    percentage: float


def aggregate_mismatches_by_pair(
    result: ReconciliationResult, *, field_name: str
) -> tuple[PairMismatchSummary, ...]:
    details = [
        item
        for item in result.field_results
        if item.field_name == field_name and is_discrepancy(item)
    ]
    counts = Counter(
        (item.left_raw_value, item.right_raw_value, item.status) for item in details
    )
    summaries = [
        PairMismatchSummary(
            field_name=field_name,
            left_value=left_value,
            right_value=right_value,
            status=status,
            employee_count=count,
            percentage=round(count / len(details) * 100, 2),
        )
        for (left_value, right_value, status), count in counts.items()
    ]
    summaries.sort(
        key=lambda item: (
            -item.employee_count,
            item.left_value or "",
            item.right_value or "",
            item.status.value,
        )
    )
    return tuple(summaries)


def mismatch_details(
    result: ReconciliationResult,
    *,
    field_name: str,
    left_value: str | _Unset | None = _Unset.TOKEN,
    right_value: str | _Unset | None = _Unset.TOKEN,
) -> tuple[FieldComparisonResult, ...]:
    return tuple(
        item
        for item in result.field_results
        if item.field_name == field_name
        and is_discrepancy(item)
        and (left_value is _Unset.TOKEN or item.left_raw_value == left_value)
        and (right_value is _Unset.TOKEN or item.right_raw_value == right_value)
    )


_CSV_COLUMNS = (
    "record_type",
    "identity",
    "field_name",
    "left_raw_value",
    "right_raw_value",
    "left_normalized_value",
    "right_normalized_value",
    "left_canonical_value",
    "right_canonical_value",
    "mapping_name",
    "comparison_status",
    "identity_status",
)


def reconciliation_csv(
    result: ReconciliationResult, *, mismatches_only: bool = False
) -> bytes:
    stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=_CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for identity in result.identity_results:
        if mismatches_only and identity.status is IdentityStatus.MATCHED:
            continue
        writer.writerow(
            {
                "record_type": "identity",
                "identity": identity.identity,
                "identity_status": identity.status.value,
            }
        )
    for field in result.field_results:
        if mismatches_only and not is_discrepancy(field):
            continue
        writer.writerow(
            {
                "record_type": "field_comparison",
                "identity": field.identity,
                "field_name": field.field_name,
                "left_raw_value": field.left_raw_value,
                "right_raw_value": field.right_raw_value,
                "left_normalized_value": field.left_normalized_value,
                "right_normalized_value": field.right_normalized_value,
                "left_canonical_value": field.left_canonical_value,
                "right_canonical_value": field.right_canonical_value,
                "mapping_name": field.mapping_name,
                "comparison_status": field.status.value,
            }
        )
    return stream.getvalue().encode("utf-8")


def reconciliation_json(
    contract: ReconciliationContract, result: ReconciliationResult
) -> bytes:
    report = build_report(contract, result)
    return (report.model_dump_json(indent=2) + "\n").encode("utf-8")
