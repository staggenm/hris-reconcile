"""Lightweight, deterministic profiling of domain datasets."""

from dataclasses import dataclass

from hris_reconcile.adapters.base import Dataset


@dataclass(frozen=True)
class ColumnProfile:
    column_name: str
    row_count: int
    non_null_count: int
    null_percentage: float
    distinct_count: int
    uniqueness_percentage: float
    sample_values: tuple[str, ...]


def profile_dataset(
    dataset: Dataset, *, sample_limit: int = 5
) -> tuple[ColumnProfile, ...]:
    row_count = len(dataset.records)
    profiles: list[ColumnProfile] = []
    for column in dataset.columns:
        values = [record[column] for record in dataset.records]
        non_null_values = [value for value in values if value is not None]
        distinct_values = set(non_null_values)
        samples = tuple(dict.fromkeys(non_null_values))[:sample_limit]
        null_percentage = (
            round((row_count - len(non_null_values)) / row_count * 100, 2)
            if row_count
            else 0.0
        )
        uniqueness_percentage = (
            round(len(distinct_values) / len(non_null_values) * 100, 2)
            if non_null_values
            else 0.0
        )
        profiles.append(
            ColumnProfile(
                column_name=column,
                row_count=row_count,
                non_null_count=len(non_null_values),
                null_percentage=null_percentage,
                distinct_count=len(distinct_values),
                uniqueness_percentage=uniqueness_percentage,
                sample_values=samples,
            )
        )
    return tuple(profiles)
