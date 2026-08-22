"""Explainable field and aggregate reconciliation domain results."""

from dataclasses import dataclass
from enum import StrEnum

from hris_reconcile.identity.models import IdentityResult


class FieldComparisonStatus(StrEnum):
    MATCH_EXACT = "MATCH_EXACT"
    MATCH_NORMALIZED = "MATCH_NORMALIZED"
    MATCH_MAPPED = "MATCH_MAPPED"
    MISMATCH = "MISMATCH"
    LEFT_NULL = "LEFT_NULL"
    RIGHT_NULL = "RIGHT_NULL"
    BOTH_NULL = "BOTH_NULL"
    UNMAPPED_LEFT = "UNMAPPED_LEFT"
    UNMAPPED_RIGHT = "UNMAPPED_RIGHT"


@dataclass(frozen=True)
class FieldComparisonResult:
    identity: str
    field_name: str
    left_raw_value: str | None
    right_raw_value: str | None
    left_normalized_value: str | None
    right_normalized_value: str | None
    left_canonical_value: str | None
    right_canonical_value: str | None
    status: FieldComparisonStatus
    mapping_name: str | None = None


@dataclass(frozen=True)
class DatasetStatistics:
    name: str
    record_count: int
    column_count: int


@dataclass(frozen=True)
class ReconciliationResult:
    left_dataset: DatasetStatistics
    right_dataset: DatasetStatistics
    identity_results: tuple[IdentityResult, ...]
    field_results: tuple[FieldComparisonResult, ...]
