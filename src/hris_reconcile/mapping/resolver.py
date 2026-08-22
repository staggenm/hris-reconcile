"""Resolve source-specific values to configured canonical values."""

from typing import Literal

from hris_reconcile.config.models import MappingConfig
from hris_reconcile.mapping.models import MappingResolution, MappingStatus


class MappingResolver:
    def __init__(self, mapping: MappingConfig) -> None:
        self._indexes: dict[str, dict[str, str]] = {"left": {}, "right": {}}
        for canonical, values in mapping.items():
            for side in ("left", "right"):
                for value in getattr(values, side):
                    self._indexes[side][value] = canonical

    def resolve(
        self, value: str | None, *, side: Literal["left", "right"]
    ) -> MappingResolution:
        if value is None:
            return MappingResolution(MappingStatus.NULL, None)
        canonical = self._indexes[side].get(value)
        if canonical is None:
            return MappingResolution(MappingStatus.UNMAPPED, None)
        return MappingResolution(MappingStatus.MAPPED, canonical)
