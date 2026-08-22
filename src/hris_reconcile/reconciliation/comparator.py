"""Compare one configured field while retaining its decision trail."""

from hris_reconcile.adapters.base import Record
from hris_reconcile.config.models import FieldConfig, MappingConfig, MappingValues
from hris_reconcile.mapping.models import MappingStatus
from hris_reconcile.mapping.resolver import MappingResolver
from hris_reconcile.normalization.registry import normalize
from hris_reconcile.reconciliation.models import (
    FieldComparisonResult,
    FieldComparisonStatus,
)


def _normalized_mapping(
    mapping: MappingConfig, field: FieldConfig
) -> MappingConfig:
    return {
        canonical: MappingValues(
            left=[normalize(value, field.normalize) for value in values.left],
            right=[normalize(value, field.normalize) for value in values.right],
        )
        for canonical, values in mapping.items()
    }


def compare_field(
    *,
    identity: str,
    left_record: Record,
    right_record: Record,
    field: FieldConfig,
    value_mappings: dict[str, MappingConfig],
) -> FieldComparisonResult:
    left_raw = left_record[field.left]
    right_raw = right_record[field.right]
    left_normalized = (
        normalize(left_raw, field.normalize) if left_raw is not None else None
    )
    right_normalized = (
        normalize(right_raw, field.normalize) if right_raw is not None else None
    )

    status: FieldComparisonStatus
    left_canonical: str | None = None
    right_canonical: str | None = None

    if left_raw is None and right_raw is None:
        status = FieldComparisonStatus.BOTH_NULL
    elif left_raw is None:
        status = FieldComparisonStatus.LEFT_NULL
    elif right_raw is None:
        status = FieldComparisonStatus.RIGHT_NULL
    elif field.value_mapping is not None:
        mapping = _normalized_mapping(value_mappings[field.value_mapping], field)
        resolver = MappingResolver(mapping)
        left_resolution = resolver.resolve(left_normalized, side="left")
        right_resolution = resolver.resolve(right_normalized, side="right")
        left_canonical = left_resolution.canonical_value
        right_canonical = right_resolution.canonical_value
        if left_resolution.status is MappingStatus.UNMAPPED:
            status = FieldComparisonStatus.UNMAPPED_LEFT
        elif right_resolution.status is MappingStatus.UNMAPPED:
            status = FieldComparisonStatus.UNMAPPED_RIGHT
        elif left_canonical == right_canonical:
            status = FieldComparisonStatus.MATCH_MAPPED
        else:
            status = FieldComparisonStatus.MISMATCH
    elif left_raw == right_raw:
        status = FieldComparisonStatus.MATCH_EXACT
    elif left_normalized == right_normalized:
        status = FieldComparisonStatus.MATCH_NORMALIZED
    else:
        status = FieldComparisonStatus.MISMATCH

    return FieldComparisonResult(
        identity=identity,
        field_name=field.name,
        left_raw_value=left_raw,
        right_raw_value=right_raw,
        left_normalized_value=left_normalized,
        right_normalized_value=right_normalized,
        left_canonical_value=left_canonical,
        right_canonical_value=right_canonical,
        status=status,
        mapping_name=field.value_mapping,
    )
