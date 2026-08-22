"""Adapter boundary types consumed by the reconciliation domain."""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from hris_reconcile.config.models import DatasetConfig

Record = Mapping[str, str | None]


@dataclass(frozen=True)
class Dataset:
    name: str
    columns: tuple[str, ...]
    records: tuple[Record, ...]


class DatasetAdapter(Protocol):
    def load(self, config: DatasetConfig, *, base_directory: Path) -> Dataset: ...


def validate_required_columns(dataset: Dataset, required: set[str]) -> None:
    missing = sorted(required.difference(dataset.columns))
    if missing:
        names = ", ".join(missing)
        raise ValueError(f"dataset {dataset.name!r} missing required columns: {names}")
