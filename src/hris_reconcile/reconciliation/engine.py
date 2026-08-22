"""Orchestrate the deterministic reconciliation stages."""

from collections.abc import Mapping
from pathlib import Path

from hris_reconcile.adapters.base import (
    Dataset,
    DatasetAdapter,
    validate_required_columns,
)
from hris_reconcile.config.models import DatasetConfig, ReconciliationContract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.identity.resolver import reconcile_identities
from hris_reconcile.reconciliation.comparator import compare_field
from hris_reconcile.reconciliation.models import (
    DatasetStatistics,
    FieldComparisonResult,
    ReconciliationResult,
)


def _required_columns(contract: ReconciliationContract) -> tuple[set[str], set[str]]:
    left = {contract.identity.left, *(field.left for field in contract.fields)}
    right = {contract.identity.right, *(field.right for field in contract.fields)}
    return left, right


def _statistics(dataset: Dataset) -> DatasetStatistics:
    return DatasetStatistics(dataset.name, len(dataset.records), len(dataset.columns))


class ReconciliationEngine:
    def __init__(self, adapters: Mapping[str, DatasetAdapter]) -> None:
        self._adapters = dict(adapters)

    def _load(self, config: DatasetConfig, base_directory: Path) -> Dataset:
        try:
            adapter = self._adapters[config.type]
        except KeyError as error:
            message = f"no adapter registered for type {config.type!r}"
            raise ValueError(message) from error
        return adapter.load(config, base_directory=base_directory)

    def reconcile(
        self, contract: ReconciliationContract, *, base_directory: Path
    ) -> ReconciliationResult:
        left_dataset = self._load(contract.left, base_directory)
        right_dataset = self._load(contract.right, base_directory)
        left_columns, right_columns = _required_columns(contract)
        validate_required_columns(left_dataset, left_columns)
        validate_required_columns(right_dataset, right_columns)

        identity_results = reconcile_identities(
            left_dataset,
            right_dataset,
            left_key=contract.identity.left,
            right_key=contract.identity.right,
        )
        field_results: list[FieldComparisonResult] = []
        for identity_result in identity_results:
            if identity_result.status is not IdentityStatus.MATCHED:
                continue
            if (
                identity_result.left_record is None
                or identity_result.right_record is None
            ):
                raise AssertionError("matched identity must contain both records")
            for field in contract.fields:
                field_results.append(
                    compare_field(
                        identity=identity_result.identity,
                        left_record=identity_result.left_record,
                        right_record=identity_result.right_record,
                        field=field,
                        value_mappings=contract.value_mappings,
                    )
                )

        return ReconciliationResult(
            left_dataset=_statistics(left_dataset),
            right_dataset=_statistics(right_dataset),
            identity_results=tuple(identity_results),
            field_results=tuple(field_results),
        )
