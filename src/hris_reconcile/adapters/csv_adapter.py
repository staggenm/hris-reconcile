"""CSV input adapter; pandas objects do not cross this module boundary."""

from pathlib import Path
from typing import cast

import pandas as pd

from hris_reconcile.adapters.base import Dataset, Record
from hris_reconcile.config.models import DatasetConfig


class CsvAdapter:
    def load(self, config: DatasetConfig, *, base_directory: Path) -> Dataset:
        path = (
            config.path
            if config.path.is_absolute()
            else base_directory / config.path
        )
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        columns = tuple(str(column) for column in frame.columns)
        records: list[Record] = []
        for raw_record in frame.to_dict(orient="records"):
            record = {
                str(key): None if value == "" else cast(str, value)
                for key, value in raw_record.items()
            }
            records.append(record)
        return Dataset(config.name, columns, tuple(records))
