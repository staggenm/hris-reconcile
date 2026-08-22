"""CSV path adapter that produces the domain dataset representation."""

import csv
from io import StringIO
from pathlib import Path

from hris_reconcile.adapters.base import Dataset, Record
from hris_reconcile.config.models import DatasetConfig


class CsvParseError(ValueError):
    """A safe, user-facing CSV parsing or structural validation error."""


def _detect_delimiter(text: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        return ","
    return str(dialect.delimiter)


def parse_csv_bytes(content: bytes, *, name: str) -> Dataset:
    """Parse UTF-8 CSV bytes without persisting them or leaking adapter objects."""
    if not content:
        raise CsvParseError("CSV dataset is empty")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise CsvParseError("CSV must use UTF-8 encoding") from error

    try:
        rows = csv.reader(
            StringIO(text, newline=""),
            delimiter=_detect_delimiter(text),
            strict=True,
        )
        header = next(rows, None)
        if header is None or not header:
            raise CsvParseError("CSV header is missing")
        if any(column == "" for column in header):
            raise CsvParseError("CSV header contains an empty column name")
        duplicates = sorted(
            column for column in set(header) if header.count(column) > 1
        )
        if duplicates:
            raise CsvParseError(
                f"CSV contains duplicate column names: {', '.join(duplicates)}"
            )

        records: list[Record] = []
        for row_number, row in enumerate(rows, start=2):
            if not row:
                continue
            if len(row) != len(header):
                raise CsvParseError(
                    f"CSV row {row_number} has {len(row)} values; "
                    f"expected {len(header)}"
                )
            records.append(
                {
                    column: None if value == "" else value
                    for column, value in zip(header, row, strict=True)
                }
            )
    except csv.Error as error:
        raise CsvParseError(f"CSV could not be parsed: {error}") from error

    if not records:
        raise CsvParseError("CSV dataset is empty; at least one data row is required")
    return Dataset(name=name, columns=tuple(header), records=tuple(records))


class CsvAdapter:
    def load(self, config: DatasetConfig, *, base_directory: Path) -> Dataset:
        if config.type != "csv" or config.path is None:
            raise ValueError(
                f"dataset {config.name!r} does not define a CSV file source"
            )
        path = (
            config.path if config.path.is_absolute() else base_directory / config.path
        )
        return parse_csv_bytes(path.read_bytes(), name=config.name)
