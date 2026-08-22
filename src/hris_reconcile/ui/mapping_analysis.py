"""Observed source-value pair evidence across uniquely matched identities."""

from collections import Counter
from dataclasses import dataclass

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.identity.resolver import reconcile_identities


@dataclass(frozen=True)
class ObservedPair:
    left_value: str | None
    right_value: str | None
    count: int
    matched_percentage: float
    consistency_percentage: float
    suggested: bool


def analyze_observed_pairs(
    left: Dataset,
    right: Dataset,
    *,
    left_identity: str,
    right_identity: str,
    left_field: str,
    right_field: str,
) -> tuple[ObservedPair, ...]:
    identities = reconcile_identities(
        left,
        right,
        left_key=left_identity,
        right_key=right_identity,
    )
    pairs: list[tuple[str | None, str | None]] = []
    for identity in identities:
        if identity.status is not IdentityStatus.MATCHED:
            continue
        if identity.left_record is None or identity.right_record is None:
            raise AssertionError("matched identity must contain both records")
        pairs.append(
            (
                identity.left_record[left_field],
                identity.right_record[right_field],
            )
        )

    pair_counts = Counter(pairs)
    left_counts = Counter(left_value for left_value, _ in pairs)
    right_counts = Counter(right_value for _, right_value in pairs)
    total = len(pairs)
    evidence = []
    for (left_value, right_value), count in pair_counts.items():
        consistency = min(
            count / left_counts[left_value], count / right_counts[right_value]
        )
        evidence.append(
            ObservedPair(
                left_value=left_value,
                right_value=right_value,
                count=count,
                matched_percentage=round(count / total * 100, 2) if total else 0.0,
                consistency_percentage=round(consistency * 100, 2),
                suggested=(
                    left_value is not None
                    and right_value is not None
                    and count >= 2
                    and consistency >= 0.95
                ),
            )
        )
    evidence.sort(
        key=lambda item: (
            -item.count,
            item.left_value or "",
            item.right_value or "",
        )
    )
    return tuple(evidence)
