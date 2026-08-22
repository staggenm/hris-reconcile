"""Exact, deterministic identity indexing and record matching."""

from collections import defaultdict

from hris_reconcile.adapters.base import Dataset, Record
from hris_reconcile.identity.models import IdentityResult, IdentityStatus


def _index_records(dataset: Dataset, key: str) -> dict[str, list[Record]]:
    index: dict[str, list[Record]] = defaultdict(list)
    for record in dataset.records:
        identity = record[key]
        if identity is None or identity == "":
            raise ValueError(f"dataset {dataset.name!r} contains a null identity")
        index[identity].append(record)
    return dict(index)


def reconcile_identities(
    left: Dataset, right: Dataset, *, left_key: str, right_key: str
) -> list[IdentityResult]:
    left_index = _index_records(left, left_key)
    right_index = _index_records(right, right_key)
    results: list[IdentityResult] = []

    for identity in sorted(left_index.keys() | right_index.keys()):
        left_records = left_index.get(identity, [])
        right_records = right_index.get(identity, [])
        if len(left_records) > 1 or len(right_records) > 1:
            if len(left_records) > 1:
                results.append(IdentityResult(identity, IdentityStatus.DUPLICATE_LEFT))
            if len(right_records) > 1:
                results.append(IdentityResult(identity, IdentityStatus.DUPLICATE_RIGHT))
        elif not left_records:
            results.append(
                IdentityResult(
                    identity,
                    IdentityStatus.MISSING_LEFT,
                    right_record=right_records[0],
                )
            )
        elif not right_records:
            results.append(
                IdentityResult(
                    identity,
                    IdentityStatus.MISSING_RIGHT,
                    left_record=left_records[0],
                )
            )
        else:
            results.append(
                IdentityResult(
                    identity,
                    IdentityStatus.MATCHED,
                    left_record=left_records[0],
                    right_record=right_records[0],
                )
            )
    return results

