import pytest

from hris_reconcile.config.models import NormalizerName
from hris_reconcile.ui.contract_builder import (
    ComparisonMode,
    FieldSelection,
    ValueMappingSelection,
    WizardConfiguration,
    WizardConfigurationError,
    build_contract,
)


def configuration(*fields: FieldSelection) -> WizardConfiguration:
    return WizardConfiguration(
        contract_name="ui_reconciliation",
        left_name="Global Core HR",
        right_name="Local Payroll",
        left_identity="person_id",
        right_identity="employee_number",
        fields=fields,
    )


def test_wizard_state_builds_valid_contract_with_exact_default() -> None:
    contract = build_contract(
        configuration(
            FieldSelection(left_column="first_name", right_column="given_name")
        )
    )

    assert contract.left.name == "Global Core HR"
    assert contract.left.path is None
    assert contract.identity.left == "person_id"
    assert contract.fields[0].normalize == []
    assert contract.fields[0].value_mapping is None


def test_normalized_mode_uses_explicit_normalizer_chain() -> None:
    contract = build_contract(
        configuration(
            FieldSelection(
                left_column="last_name",
                right_column="surname",
                mode=ComparisonMode.NORMALIZED_TEXT,
            )
        )
    )

    assert contract.fields[0].normalize == [
        NormalizerName.TRIM,
        NormalizerName.COLLAPSE_WHITESPACE,
        NormalizerName.CASEFOLD,
    ]


def test_value_mapping_mode_uses_existing_semantic_mapping_model() -> None:
    contract = build_contract(
        configuration(
            FieldSelection(
                left_column="company",
                right_column="company_code",
                mode=ComparisonMode.VALUE_MAPPING,
                value_mappings=(
                    ValueMappingSelection(
                        canonical_value="DE_GERMANY",
                        left_values=("DE01",),
                        right_values=("1000",),
                    ),
                ),
            )
        )
    )

    mapping_name = contract.fields[0].value_mapping
    assert mapping_name is not None
    assert contract.value_mappings[mapping_name]["DE_GERMANY"].left == ["DE01"]


def test_duplicate_canonical_mapping_is_rejected() -> None:
    field = FieldSelection(
        left_column="company",
        right_column="company_code",
        mode=ComparisonMode.VALUE_MAPPING,
        value_mappings=(
            ValueMappingSelection("SAME", ("DE01",), ("1000",)),
            ValueMappingSelection("SAME", ("CH01",), ("2000",)),
        ),
    )

    with pytest.raises(WizardConfigurationError, match="canonical value"):
        build_contract(configuration(field))


@pytest.mark.parametrize(
    "fields, message",
    [
        ((), "comparison field"),
        (
            (
                FieldSelection("first_name", "given_name"),
                FieldSelection("first_name", "preferred_name"),
            ),
            "more than once",
        ),
        (
            (FieldSelection("person_id", "given_name"),),
            "identity",
        ),
        (
            (FieldSelection("company", "company_code", ComparisonMode.VALUE_MAPPING),),
            "value mapping",
        ),
    ],
)
def test_invalid_or_incomplete_state_is_rejected(
    fields: tuple[FieldSelection, ...], message: str
) -> None:
    with pytest.raises(WizardConfigurationError, match=message):
        build_contract(configuration(*fields))


def test_ignored_fields_are_not_added_to_contract() -> None:
    contract = build_contract(
        configuration(
            FieldSelection("unused", "unused", ComparisonMode.IGNORE),
            FieldSelection("name", "name"),
        )
    )

    assert [field.name for field in contract.fields] == ["name"]
