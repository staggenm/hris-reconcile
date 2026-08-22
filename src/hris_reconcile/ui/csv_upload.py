"""In-memory CSV upload boundary, independent of Streamlit objects."""

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.adapters.csv_adapter import CsvParseError
from hris_reconcile.adapters.csv_adapter import (
    parse_csv_bytes as _parse_csv_bytes,
)

__all__ = ["CsvParseError", "parse_csv_bytes", "parse_uploaded_csv"]


def parse_uploaded_csv(content: bytes, *, name: str) -> Dataset:
    return _parse_csv_bytes(content, name=name)


# The concise alias keeps callers focused on bytes rather than UI framework types.
parse_csv_bytes = parse_uploaded_csv
