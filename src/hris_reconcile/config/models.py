"""Validated models for reconciliation contracts."""

from enum import StrEnum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    """Common strict and immutable configuration behavior."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class NormalizerName(StrEnum):
    TRIM = "trim"
    UPPERCASE = "uppercase"
    LOWERCASE = "lowercase"
    CASEFOLD = "casefold"
    COLLAPSE_WHITESPACE = "collapse_whitespace"


class DatasetConfig(ContractModel):
    name: str = Field(min_length=1)
    type: Literal["csv"]
    path: Path


class IdentityConfig(ContractModel):
    left: str = Field(min_length=1)
    right: str = Field(min_length=1)


class FieldConfig(ContractModel):
    name: str = Field(min_length=1)
    left: str = Field(min_length=1)
    right: str = Field(min_length=1)
    normalize: list[NormalizerName] = Field(default_factory=list)
    value_mapping: str | None = None


class MappingValues(ContractModel):
    left: list[str] = Field(min_length=1)
    right: list[str] = Field(min_length=1)


MappingConfig = dict[str, MappingValues]


class ReconciliationContract(ContractModel):
    name: str = Field(min_length=1)
    left: DatasetConfig
    right: DatasetConfig
    identity: IdentityConfig
    fields: list[FieldConfig] = Field(min_length=1)
    value_mappings: dict[str, MappingConfig] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_mapping_references_and_uniqueness(self) -> "ReconciliationContract":
        for field in self.fields:
            if field.value_mapping and field.value_mapping not in self.value_mappings:
                raise ValueError(
                    f"field {field.name!r} references unknown value mapping "
                    f"{field.value_mapping!r}"
                )

        for mapping_name, canonical_entries in self.value_mappings.items():
            for side in ("left", "right"):
                seen: dict[str, str] = {}
                for canonical, values in canonical_entries.items():
                    for value in getattr(values, side):
                        if value in seen:
                            raise ValueError(
                                f"value {value!r} is ambiguous on {side} side of "
                                f"mapping {mapping_name!r}: {seen[value]!r} and "
                                f"{canonical!r}"
                            )
                        seen[value] = canonical
        return self

