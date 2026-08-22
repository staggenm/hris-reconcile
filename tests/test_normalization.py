import pytest

from hris_reconcile.normalization.builtins import (
    collapse_whitespace,
    lowercase,
    trim,
    uppercase,
)
from hris_reconcile.normalization.registry import NORMALIZERS, normalize


def test_trim() -> None:
    assert trim("  Alpha  ") == "Alpha"


def test_uppercase() -> None:
    assert uppercase("Alpha ß") == "ALPHA SS"


def test_lowercase() -> None:
    assert lowercase("Alpha") == "alpha"


def test_casefold() -> None:
    assert NORMALIZERS.resolve("casefold")("Straße") == "strasse"


def test_collapse_whitespace() -> None:
    assert collapse_whitespace("Alpha\t  Beta\nGamma") == "Alpha Beta Gamma"


def test_chained_normalization() -> None:
    names = ["trim", "collapse_whitespace", "casefold"]

    assert normalize("  Alpha   BETA ", names) == "alpha beta"


def test_unknown_registry_entry_fails() -> None:
    with pytest.raises(ValueError, match="unknown"):
        NORMALIZERS.resolve("unknown")
