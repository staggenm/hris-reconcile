from pathlib import Path

import pytest

from hris_reconcile.adapters.base import validate_required_columns
from hris_reconcile.adapters.csv_adapter import CsvAdapter
from hris_reconcile.config.models import DatasetConfig


def test_csv_adapter_converts_rows_to_domain_records(tmp_path: Path) -> None:
    path = tmp_path / "people.csv"
    path.write_text("id,name,note\n001,Alpha,\n", encoding="utf-8")
    config = DatasetConfig(name="people", type="csv", path=Path("people.csv"))

    dataset = CsvAdapter().load(config, base_directory=tmp_path)

    assert dataset.name == "people"
    assert dataset.columns == ("id", "name", "note")
    assert dataset.records == ({"id": "001", "name": "Alpha", "note": None},)


def test_required_column_validation_is_explicit(tmp_path: Path) -> None:
    path = tmp_path / "people.csv"
    path.write_text("id,name\n001,Alpha\n", encoding="utf-8")
    config = DatasetConfig(name="people", type="csv", path=Path("people.csv"))
    dataset = CsvAdapter().load(config, base_directory=tmp_path)

    with pytest.raises(ValueError, match=r"missing required columns.*company"):
        validate_required_columns(dataset, {"id", "company"})
