from hris_reconcile.config.models import MappingValues
from hris_reconcile.mapping.models import MappingStatus
from hris_reconcile.mapping.resolver import MappingResolver


def resolver() -> MappingResolver:
    return MappingResolver(
        {
            "DE_GERMANY": MappingValues(left=["DE01"], right=["1000"]),
            "CH_SWITZERLAND": MappingValues(left=["CH01"], right=["2000"]),
        }
    )


def test_left_value_resolves() -> None:
    result = resolver().resolve("DE01", side="left")

    assert result.status is MappingStatus.MAPPED
    assert result.canonical_value == "DE_GERMANY"


def test_right_value_resolves() -> None:
    result = resolver().resolve("1000", side="right")

    assert result.status is MappingStatus.MAPPED
    assert result.canonical_value == "DE_GERMANY"


def test_unmapped_value_is_explicit() -> None:
    result = resolver().resolve("UNKNOWN", side="left")

    assert result.status is MappingStatus.UNMAPPED
    assert result.canonical_value is None


def test_null_remains_null() -> None:
    result = resolver().resolve(None, side="right")

    assert result.status is MappingStatus.NULL
    assert result.canonical_value is None
