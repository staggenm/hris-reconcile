import pytest

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.ui.profiling import profile_dataset


def test_profile_counts_nulls_uniqueness_and_samples() -> None:
    dataset = Dataset(
        name="People",
        columns=("id", "department"),
        records=(
            {"id": "001", "department": "Engineering"},
            {"id": "002", "department": "Engineering"},
            {"id": "003", "department": None},
            {"id": "004", "department": "Finance"},
        ),
    )

    profiles = {item.column_name: item for item in profile_dataset(dataset)}

    assert profiles["id"].row_count == 4
    assert profiles["id"].non_null_count == 4
    assert profiles["id"].null_percentage == 0.0
    assert profiles["id"].distinct_count == 4
    assert profiles["id"].uniqueness_percentage == 100.0
    assert profiles["department"].null_percentage == 25.0
    assert profiles["department"].distinct_count == 2
    assert profiles["department"].uniqueness_percentage == pytest.approx(66.67)
    assert profiles["department"].sample_values == ("Engineering", "Finance")


def test_empty_dataset_profiles_without_division_by_zero() -> None:
    dataset = Dataset(name="Empty", columns=("id",), records=())

    profile = profile_dataset(dataset)[0]

    assert profile.row_count == 0
    assert profile.non_null_count == 0
    assert profile.null_percentage == 0.0
    assert profile.uniqueness_percentage == 0.0
    assert profile.sample_values == ()
