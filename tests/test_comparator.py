from hris_reconcile.config.models import FieldConfig, MappingValues
from hris_reconcile.reconciliation.comparator import compare_field
from hris_reconcile.reconciliation.models import FieldComparisonStatus

COMPANY_MAPPING = {
    "DE_GERMANY": MappingValues(left=["DE01"], right=["1000"]),
    "CH_SWITZERLAND": MappingValues(left=["CH01"], right=["2000"]),
}


def compare(
    left: str | None,
    right: str | None,
    *,
    normalize: list[str] | None = None,
    mapped: bool = False,
):
    field = FieldConfig(
        name="company" if mapped else "name",
        left="left_value",
        right="right_value",
        normalize=normalize or [],
        value_mapping="company" if mapped else None,
    )
    mappings = {"company": COMPANY_MAPPING} if mapped else {}
    return compare_field(
        identity="001",
        left_record={"left_value": left},
        right_record={"right_value": right},
        field=field,
        value_mappings=mappings,
    )


def test_exact_match() -> None:
    result = compare("Alpha", "Alpha")

    assert result.status is FieldComparisonStatus.MATCH_EXACT
    assert result.left_raw_value == "Alpha"
    assert result.left_normalized_value == "Alpha"


def test_normalized_match() -> None:
    result = compare(" Alpha ", "alpha", normalize=["trim", "casefold"])

    assert result.status is FieldComparisonStatus.MATCH_NORMALIZED
    assert result.left_normalized_value == "alpha"


def test_mapped_match() -> None:
    result = compare("DE01", "1000", mapped=True)

    assert result.status is FieldComparisonStatus.MATCH_MAPPED
    assert result.left_canonical_value == "DE_GERMANY"
    assert result.right_canonical_value == "DE_GERMANY"
    assert result.mapping_name == "company"


def test_identical_raw_values_remain_exact_when_mapping_mode_is_enabled() -> None:
    result = compare("SAME", "SAME", mapped=True)

    assert result.status is FieldComparisonStatus.MATCH_EXACT
    assert result.left_canonical_value is None
    assert result.right_canonical_value is None


def test_mismatch() -> None:
    assert compare("Alpha", "Beta").status is FieldComparisonStatus.MISMATCH


def test_unmapped_left() -> None:
    assert (
        compare("UNKNOWN", "1000", mapped=True).status
        is FieldComparisonStatus.UNMAPPED_LEFT
    )


def test_unmapped_right() -> None:
    assert (
        compare("DE01", "9999", mapped=True).status
        is FieldComparisonStatus.UNMAPPED_RIGHT
    )


def test_both_null() -> None:
    result = compare(None, None)

    assert result.status is FieldComparisonStatus.BOTH_NULL
    assert result.left_normalized_value is None
    assert result.right_canonical_value is None


def test_single_null_statuses() -> None:
    assert compare(None, "Alpha").status is FieldComparisonStatus.LEFT_NULL
    assert compare("Alpha", None).status is FieldComparisonStatus.RIGHT_NULL


def test_mapping_aliases_receive_configured_normalization() -> None:
    result = compare(" de01 ", "1000", normalize=["trim", "uppercase"], mapped=True)

    assert result.status is FieldComparisonStatus.MATCH_MAPPED
