"""Typed outcomes from semantic mapping resolution."""

from dataclasses import dataclass
from enum import StrEnum


class MappingStatus(StrEnum):
    MAPPED = "MAPPED"
    UNMAPPED = "UNMAPPED"
    NULL = "NULL"


@dataclass(frozen=True)
class MappingResolution:
    status: MappingStatus
    canonical_value: str | None
