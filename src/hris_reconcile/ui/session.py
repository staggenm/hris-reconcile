"""In-memory wizard state with correctness-preserving invalidation."""

from dataclasses import dataclass, field
from threading import RLock

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.config.models import ReconciliationContract
from hris_reconcile.reconciliation.models import ReconciliationResult
from hris_reconcile.ui.contract_builder import FieldSelection


@dataclass
class Session:
    """State for the single local analyst session; never persisted."""

    datasets: dict[str, Dataset] = field(default_factory=dict)
    dataset_names: dict[str, str] = field(default_factory=dict)
    identity_pair: tuple[str, str] | None = None
    field_selections: tuple[FieldSelection, ...] | None = None
    mapped_field_selections: tuple[FieldSelection, ...] | None = None
    contract: ReconciliationContract | None = None
    result: ReconciliationResult | None = None
    lock: RLock = field(default_factory=RLock, repr=False)

    def clear(self) -> None:
        with self.lock:
            self.datasets.clear()
            self.dataset_names.clear()
            self._clear_from_identity()

    def set_dataset(self, side: str, dataset: Dataset) -> None:
        with self.lock:
            self.datasets[side] = dataset
            self.dataset_names[side] = dataset.name
            self._clear_from_identity()

    def delete_dataset(self, side: str) -> None:
        with self.lock:
            self.datasets.pop(side, None)
            self.dataset_names.pop(side, None)
            self._clear_from_identity()

    def set_dataset_name(self, side: str, name: str) -> None:
        with self.lock:
            self.dataset_names[side] = name
            self.contract = None
            self.result = None

    def set_identity(self, left_column: str, right_column: str) -> None:
        with self.lock:
            self.identity_pair = (left_column, right_column)
            self._clear_from_fields()

    def set_fields(self, fields: tuple[FieldSelection, ...]) -> None:
        with self.lock:
            self.field_selections = fields
            self.mapped_field_selections = None
            self.contract = None
            self.result = None

    def set_mapped_fields(self, fields: tuple[FieldSelection, ...]) -> None:
        with self.lock:
            self.mapped_field_selections = fields
            self.contract = None
            self.result = None

    def set_reconciliation(
        self,
        contract: ReconciliationContract,
        result: ReconciliationResult,
    ) -> None:
        with self.lock:
            self.contract = contract
            self.result = result

    def _clear_from_identity(self) -> None:
        self.identity_pair = None
        self._clear_from_fields()

    def _clear_from_fields(self) -> None:
        self.field_selections = None
        self.mapped_field_selections = None
        self.contract = None
        self.result = None
