"""Typed identity reconciliation outcomes."""

from dataclasses import dataclass
from enum import StrEnum

from hris_reconcile.adapters.base import Record


class IdentityStatus(StrEnum):
    MATCHED = "MATCHED"
    MISSING_LEFT = "MISSING_LEFT"
    MISSING_RIGHT = "MISSING_RIGHT"
    DUPLICATE_LEFT = "DUPLICATE_LEFT"
    DUPLICATE_RIGHT = "DUPLICATE_RIGHT"


@dataclass(frozen=True)
class IdentityResult:
    identity: str
    status: IdentityStatus
    left_record: Record | None = None
    right_record: Record | None = None
