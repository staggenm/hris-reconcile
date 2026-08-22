import pytest

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.identity.resolver import reconcile_identities


def dataset(name: str, key: str, identities: list[str | None]) -> Dataset:
    return Dataset(
        name=name,
        columns=(key,),
        records=tuple({key: identity} for identity in identities),
    )


def statuses(left_ids: list[str], right_ids: list[str]) -> dict[str, IdentityStatus]:
    results = reconcile_identities(
        dataset("left", "person_id", left_ids),
        dataset("right", "employee_number", right_ids),
        left_key="person_id",
        right_key="employee_number",
    )
    return {result.identity: result.status for result in results}


def test_matching_record() -> None:
    assert statuses(["001"], ["001"])["001"] is IdentityStatus.MATCHED


def test_missing_left() -> None:
    assert statuses([], ["001"])["001"] is IdentityStatus.MISSING_LEFT


def test_missing_right() -> None:
    assert statuses(["001"], [])["001"] is IdentityStatus.MISSING_RIGHT


def test_duplicate_identity_is_not_paired() -> None:
    results = reconcile_identities(
        dataset("left", "person_id", ["001", "001"]),
        dataset("right", "employee_number", ["001"]),
        left_key="person_id",
        right_key="employee_number",
    )

    assert len(results) == 1
    assert results[0].status is IdentityStatus.DUPLICATE_LEFT
    assert results[0].left_record is None
    assert results[0].right_record is None


def test_duplicates_on_both_sides_are_both_reported() -> None:
    results = reconcile_identities(
        dataset("left", "person_id", ["001", "001"]),
        dataset("right", "employee_number", ["001", "001"]),
        left_key="person_id",
        right_key="employee_number",
    )

    assert [result.status for result in results] == [
        IdentityStatus.DUPLICATE_LEFT,
        IdentityStatus.DUPLICATE_RIGHT,
    ]


def test_null_identity_fails() -> None:
    with pytest.raises(ValueError, match="null identity"):
        reconcile_identities(
            dataset("left", "person_id", [None]),
            dataset("right", "employee_number", []),
            left_key="person_id",
            right_key="employee_number",
        )
