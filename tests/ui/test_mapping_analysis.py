import pytest

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.ui.mapping_analysis import analyze_observed_pairs


def datasets(
    pairs: list[tuple[str | None, str | None]],
) -> tuple[Dataset, Dataset]:
    left = Dataset(
        name="Left",
        columns=("id", "value"),
        records=tuple(
            {"id": str(index), "value": pair[0]}
            for index, pair in enumerate(pairs, start=1)
        ),
    )
    right = Dataset(
        name="Right",
        columns=("employee_id", "value"),
        records=tuple(
            {"employee_id": str(index), "value": pair[1]}
            for index, pair in enumerate(pairs, start=1)
        ),
    )
    return left, right


def test_stable_one_to_one_pair_is_high_confidence() -> None:
    left, right = datasets([("Employee", "EMP"), ("Employee", "EMP")])

    evidence = analyze_observed_pairs(
        left,
        right,
        left_identity="id",
        right_identity="employee_id",
        left_field="value",
        right_field="value",
    )

    assert evidence[0].count == 2
    assert evidence[0].consistency_percentage == 100.0
    assert evidence[0].suggested is True


def test_one_to_many_pair_has_lower_consistency() -> None:
    left, right = datasets(
        [("Employee", "EMP"), ("Employee", "EMP"), ("Employee", "EXT")]
    )

    evidence = analyze_observed_pairs(
        left,
        right,
        left_identity="id",
        right_identity="employee_id",
        left_field="value",
        right_field="value",
    )

    assert evidence[0].right_value == "EMP"
    assert evidence[0].consistency_percentage == pytest.approx(66.67)
    assert evidence[0].suggested is False


def test_missing_values_remain_explicit() -> None:
    left, right = datasets([(None, "EMP"), ("Employee", None)])

    evidence = analyze_observed_pairs(
        left,
        right,
        left_identity="id",
        right_identity="employee_id",
        left_field="value",
        right_field="value",
    )

    assert {(item.left_value, item.right_value) for item in evidence} == {
        (None, "EMP"),
        ("Employee", None),
    }
    assert all(item.suggested is False for item in evidence)


def test_pair_percentage_uses_all_matched_employees() -> None:
    left, right = datasets([("A", "X"), ("A", "X"), ("B", "Y"), ("C", "Z")])

    evidence = analyze_observed_pairs(
        left,
        right,
        left_identity="id",
        right_identity="employee_id",
        left_field="value",
        right_field="value",
    )

    assert evidence[0].count == 2
    assert evidence[0].matched_percentage == 50.0
