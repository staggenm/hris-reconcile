"""Convert typed wizard selections into the shared reconciliation contract."""

import re
from dataclasses import dataclass
from enum import StrEnum

from hris_reconcile.config.models import (
    DatasetConfig,
    FieldConfig,
    IdentityConfig,
    MappingConfig,
    MappingValues,
    NormalizerName,
    ReconciliationContract,
)


class ComparisonMode(StrEnum):
    EXACT = "Exact"
    NORMALIZED_TEXT = "Normalized text"
    VALUE_MAPPING = "Value mapping"
    IGNORE = "Ignore"


@dataclass(frozen=True)
class ValueMappingSelection:
    canonical_value: str
    left_values: tuple[str, ...]
    right_values: tuple[str, ...]


@dataclass(frozen=True)
class FieldSelection:
    left_column: str
    right_column: str
    mode: ComparisonMode = ComparisonMode.EXACT
    value_mappings: tuple[ValueMappingSelection, ...] = ()


@dataclass(frozen=True)
class WizardConfiguration:
    contract_name: str
    left_name: str
    right_name: str
    left_identity: str
    right_identity: str
    fields: tuple[FieldSelection, ...]


class WizardConfigurationError(ValueError):
    """An incomplete or contradictory wizard selection."""


_NORMALIZED_TEXT_CHAIN = [
    NormalizerName.TRIM,
    NormalizerName.COLLAPSE_WHITESPACE,
    NormalizerName.CASEFOLD,
]


def _mapping_name(index: int, field_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", field_name.casefold()).strip("_")
    return f"field_{index}_{slug or 'mapping'}"


def _build_mapping(field: FieldSelection) -> MappingConfig:
    if not field.value_mappings:
        raise WizardConfigurationError(
            f"value mapping field {field.left_column!r} has no confirmed mappings"
        )
    mapping: MappingConfig = {}
    for selection in field.value_mappings:
        if (
            not selection.canonical_value
            or not selection.left_values
            or not selection.right_values
        ):
            raise WizardConfigurationError(
                "value mapping entries require a canonical value and both sides"
            )
        if selection.canonical_value in mapping:
            raise WizardConfigurationError(
                f"canonical value {selection.canonical_value!r} is used more than once"
            )
        mapping[selection.canonical_value] = MappingValues(
            left=list(selection.left_values),
            right=list(selection.right_values),
        )
    return mapping


def build_contract(configuration: WizardConfiguration) -> ReconciliationContract:
    active_fields = tuple(
        field
        for field in configuration.fields
        if field.mode is not ComparisonMode.IGNORE
    )
    if not active_fields:
        raise WizardConfigurationError("select at least one comparison field")

    seen_left: set[str] = set()
    seen_right: set[str] = set()
    configured_fields: list[FieldConfig] = []
    value_mappings: dict[str, MappingConfig] = {}
    for index, field in enumerate(active_fields, start=1):
        if field.left_column in seen_left or field.right_column in seen_right:
            raise WizardConfigurationError(
                "a field cannot be mapped more than once on either side"
            )
        if (
            field.left_column == configuration.left_identity
            or field.right_column == configuration.right_identity
        ):
            raise WizardConfigurationError(
                "identity fields cannot also be comparison fields"
            )
        seen_left.add(field.left_column)
        seen_right.add(field.right_column)

        mapping_name: str | None = None
        if field.mode is ComparisonMode.VALUE_MAPPING:
            mapping_name = _mapping_name(index, field.left_column)
            value_mappings[mapping_name] = _build_mapping(field)
        normalizers = (
            _NORMALIZED_TEXT_CHAIN
            if field.mode is ComparisonMode.NORMALIZED_TEXT
            else []
        )
        configured_fields.append(
            FieldConfig(
                name=field.left_column,
                left=field.left_column,
                right=field.right_column,
                normalize=normalizers,
                value_mapping=mapping_name,
            )
        )

    return ReconciliationContract(
        name=configuration.contract_name,
        left=DatasetConfig(name=configuration.left_name),
        right=DatasetConfig(name=configuration.right_name),
        identity=IdentityConfig(
            left=configuration.left_identity,
            right=configuration.right_identity,
        ),
        fields=configured_fields,
        value_mappings=value_mappings,
    )
