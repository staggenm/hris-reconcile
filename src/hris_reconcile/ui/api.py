"""Pure request handlers for the local reconciliation JSON API."""

import re
from collections import Counter
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.engine import ReconciliationEngine
from hris_reconcile.reconciliation.models import FieldComparisonStatus
from hris_reconcile.ui.contract_builder import (
    ComparisonMode,
    FieldSelection,
    ValueMappingSelection,
    WizardConfiguration,
    WizardConfigurationError,
    build_contract,
)
from hris_reconcile.ui.csv_upload import parse_csv_bytes
from hris_reconcile.ui.mapping_analysis import analyze_observed_pairs
from hris_reconcile.ui.profiling import profile_dataset
from hris_reconcile.ui.results_analysis import (
    DISCREPANCY_STATUSES,
    aggregate_mismatches_by_field,
    aggregate_mismatches_by_pair,
    mismatch_details,
    reconciliation_csv,
    reconciliation_json,
)
from hris_reconcile.ui.session import Session
from hris_reconcile.ui.suggestions import (
    score_identity_pair,
    suggest_field_mappings,
    suggest_identity,
)

Side = Literal["left", "right"]
JsonObject = dict[str, Any]
_MISSING = "<missing>"


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DatasetNameRequest(RequestModel):
    name: str = Field(min_length=1)


class IdentityPairRequest(RequestModel):
    left_column: str = Field(min_length=1)
    right_column: str = Field(min_length=1)


class FieldRequest(RequestModel):
    left_column: str = Field(min_length=1)
    right_column: str = Field(min_length=1)
    mode: ComparisonMode = ComparisonMode.EXACT


class FieldsConfirmRequest(RequestModel):
    fields: tuple[FieldRequest, ...]


class MappingObservedRequest(RequestModel):
    left_field: str = Field(min_length=1)
    right_field: str = Field(min_length=1)


class ValueMappingRequest(RequestModel):
    canonical_value: str = Field(min_length=1)
    left_values: tuple[str, ...]
    right_values: tuple[str, ...]


class FieldMappingsRequest(RequestModel):
    left_column: str = Field(min_length=1)
    mappings: tuple[ValueMappingRequest, ...]


class MappingsConfirmRequest(RequestModel):
    fields: tuple[FieldMappingsRequest, ...]


class RunRequest(RequestModel):
    name: str = Field(min_length=1)


def _dataset(session: Session, side: Side) -> Dataset:
    try:
        return session.datasets[side]
    except KeyError as error:
        raise ValueError(f"upload the {side} dataset first") from error


def _both_datasets(session: Session) -> tuple[Dataset, Dataset]:
    return _dataset(session, "left"), _dataset(session, "right")


def _require_identity(session: Session) -> tuple[str, str]:
    if session.identity_pair is None:
        raise ValueError("confirm employee identity fields first")
    return session.identity_pair


def _require_fields(session: Session) -> tuple[FieldSelection, ...]:
    if session.field_selections is None:
        raise ValueError("confirm field mappings first")
    return session.field_selections


def _require_result(session: Session) -> None:
    if session.result is None or session.contract is None:
        raise ValueError("run the reconciliation first")


def _display(value: str | None) -> str:
    return _MISSING if value is None else value


def _dataclass_json(value: object) -> JsonObject:
    return asdict(cast(Any, value))


def upload_dataset(
    session: Session, side: Side, content: bytes, filename: str
) -> JsonObject:
    # v0.3 intentionally uses browser file input: native tkinter dialogs require
    # main-thread coordination that would be replaced by the v0.4 desktop shell.
    # Bytes stay in user-owned process memory and are discarded after parsing.
    name = Path(filename).stem or side.title()
    dataset = parse_csv_bytes(content, name=name)
    session.set_dataset(side, dataset)
    return dataset_view(dataset)


def dataset_view(dataset: Dataset) -> JsonObject:
    return {
        "name": dataset.name,
        "row_count": len(dataset.records),
        "column_count": len(dataset.columns),
        "columns": list(dataset.columns),
        "preview": [dict(record) for record in dataset.records[:5]],
        "profile": [_dataclass_json(item) for item in profile_dataset(dataset)],
    }


def delete_dataset(session: Session, side: Side) -> JsonObject:
    session.delete_dataset(side)
    return {"ok": True}


def set_dataset_name(
    session: Session, side: Side, request: DatasetNameRequest
) -> JsonObject:
    _dataset(session, side)
    name = request.name.strip()
    if not name:
        raise ValueError("dataset name cannot be blank")
    session.set_dataset_name(side, name)
    return {"name": name}


def identity_suggestion(session: Session) -> JsonObject:
    left, right = _both_datasets(session)
    return _dataclass_json(suggest_identity(left, right))


def identity_score(session: Session, request: IdentityPairRequest) -> JsonObject:
    left, right = _both_datasets(session)
    return _dataclass_json(
        score_identity_pair(
            left,
            right,
            left_column=request.left_column,
            right_column=request.right_column,
        )
    )


def confirm_identity(session: Session, request: IdentityPairRequest) -> JsonObject:
    identity_score(session, request)
    session.set_identity(request.left_column, request.right_column)
    return {"confirmed": True}


def field_suggestions(session: Session) -> list[JsonObject]:
    left, right = _both_datasets(session)
    identity = _require_identity(session)
    return [
        _dataclass_json(item)
        for item in suggest_field_mappings(
            left.columns,
            right.columns,
            excluded_left={identity[0]},
            excluded_right={identity[1]},
        )
    ]


def confirm_fields(session: Session, request: FieldsConfirmRequest) -> JsonObject:
    left, right = _both_datasets(session)
    identity = _require_identity(session)
    fields = tuple(
        FieldSelection(item.left_column, item.right_column, item.mode)
        for item in request.fields
    )
    active = tuple(item for item in fields if item.mode is not ComparisonMode.IGNORE)
    if not active:
        raise WizardConfigurationError("select at least one comparison field")
    if len({item.left_column for item in active}) != len(active) or len(
        {item.right_column for item in active}
    ) != len(active):
        raise WizardConfigurationError(
            "a field cannot be mapped more than once on either side"
        )
    for item in fields:
        if (
            item.left_column not in left.columns
            or item.right_column not in right.columns
        ):
            raise WizardConfigurationError("field mappings contain an unknown column")
        if item.left_column == identity[0] or item.right_column == identity[1]:
            raise WizardConfigurationError(
                "identity fields cannot also be comparison fields"
            )
    session.set_fields(fields)
    return {"confirmed": True, "field_count": len(active)}


def observed_mappings(
    session: Session, request: MappingObservedRequest
) -> list[JsonObject]:
    left, right = _both_datasets(session)
    identity = _require_identity(session)
    fields = _require_fields(session)
    if not any(
        item.left_column == request.left_field
        and item.right_column == request.right_field
        and item.mode is ComparisonMode.VALUE_MAPPING
        for item in fields
    ):
        raise WizardConfigurationError("select Value mapping for this field first")
    observed = analyze_observed_pairs(
        left,
        right,
        left_identity=identity[0],
        right_identity=identity[1],
        left_field=request.left_field,
        right_field=request.right_field,
    )
    return [
        {
            **_dataclass_json(item),
            "left_display": _display(item.left_value),
            "right_display": _display(item.right_value),
            "assessment": "High confidence" if item.suggested else "Review",
            "canonical_value": f"CANONICAL_{index:03d}",
        }
        for index, item in enumerate(observed, start=1)
    ]


def confirm_mappings(session: Session, request: MappingsConfirmRequest) -> JsonObject:
    fields = _require_fields(session)
    supplied = {item.left_column: item for item in request.fields}
    mapped: list[FieldSelection] = []
    for field_selection in fields:
        if field_selection.mode is not ComparisonMode.VALUE_MAPPING:
            mapped.append(field_selection)
            continue
        requested = supplied.get(field_selection.left_column)
        if requested is None or not requested.mappings:
            raise WizardConfigurationError(
                "confirm at least one value mapping for "
                f"{field_selection.left_column!r}"
            )
        selections = tuple(
            ValueMappingSelection(
                item.canonical_value,
                item.left_values,
                item.right_values,
            )
            for item in requested.mappings
        )
        if any(
            not item.left_values
            or not item.right_values
            or _MISSING in item.left_values
            or _MISSING in item.right_values
            for item in selections
        ):
            raise WizardConfigurationError(
                "included mappings require non-missing values on both sides"
            )
        mapped.append(replace(field_selection, value_mappings=selections))
    session.set_mapped_fields(tuple(mapped))
    return {"confirmed": True}


def suggested_contract_name(session: Session) -> str:
    left = session.dataset_names.get("left", "left")
    right = session.dataset_names.get("right", "right")
    value = f"{left}_vs_{right}".casefold()
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_") or "ui_reconciliation"


def run_reconciliation(session: Session, request: RunRequest) -> JsonObject:
    left, right = _both_datasets(session)
    identity = _require_identity(session)
    fields = session.mapped_field_selections
    if fields is None:
        raise ValueError("confirm accepted semantic mappings first")
    left_name = session.dataset_names.get("left", left.name)
    right_name = session.dataset_names.get("right", right.name)
    contract = build_contract(
        WizardConfiguration(
            contract_name=request.name,
            left_name=left_name,
            right_name=right_name,
            left_identity=identity[0],
            right_identity=identity[1],
            fields=fields,
        )
    )
    result = ReconciliationEngine().reconcile(
        contract=contract,
        left_dataset=Dataset(left_name, left.columns, left.records),
        right_dataset=Dataset(right_name, right.columns, right.records),
    )
    session.set_reconciliation(contract, result)
    return results_summary(session)


def results_summary(session: Session) -> JsonObject:
    _require_result(session)
    assert session.result is not None
    result = session.result
    identities = Counter(item.status for item in result.identity_results)
    fields = Counter(item.status for item in result.field_results)
    matches = sum(
        fields[status]
        for status in (
            FieldComparisonStatus.MATCH_EXACT,
            FieldComparisonStatus.MATCH_NORMALIZED,
            FieldComparisonStatus.MATCH_MAPPED,
            FieldComparisonStatus.BOTH_NULL,
        )
    )
    discrepancies = sum(fields[status] for status in DISCREPANCY_STATUSES)
    return {
        "datasets": {
            "left": _dataclass_json(result.left_dataset),
            "right": _dataclass_json(result.right_dataset),
        },
        "identity_counts": {
            status.value: identities[status] for status in IdentityStatus
        },
        "field_counts": {
            status.value: fields[status] for status in FieldComparisonStatus
        },
        "metrics": {
            "matched_employees": identities[IdentityStatus.MATCHED],
            "missing_left": identities[IdentityStatus.MISSING_LEFT],
            "missing_right": identities[IdentityStatus.MISSING_RIGHT],
            "duplicate_identities": identities[IdentityStatus.DUPLICATE_LEFT]
            + identities[IdentityStatus.DUPLICATE_RIGHT],
            "field_matches": matches,
            "field_discrepancies": discrepancies,
            "unmapped_values": fields[FieldComparisonStatus.UNMAPPED_LEFT]
            + fields[FieldComparisonStatus.UNMAPPED_RIGHT],
        },
    }


def results_by_field(session: Session) -> list[JsonObject]:
    _require_result(session)
    assert session.result is not None
    return [
        _dataclass_json(item) for item in aggregate_mismatches_by_field(session.result)
    ]


def results_by_pair(session: Session, field_name: str) -> list[JsonObject]:
    _require_result(session)
    assert session.result is not None
    return [
        {**_dataclass_json(item), "status": item.status.value}
        for item in aggregate_mismatches_by_pair(session.result, field_name=field_name)
    ]


def result_details(
    session: Session,
    field_name: str,
    *,
    left_value: str | None = None,
    right_value: str | None = None,
    filter_left: bool = False,
    filter_right: bool = False,
) -> list[JsonObject]:
    _require_result(session)
    assert session.result is not None
    arguments: JsonObject = {"field_name": field_name}
    if filter_left:
        arguments["left_value"] = left_value
    if filter_right:
        arguments["right_value"] = right_value
    return [
        {**_dataclass_json(item), "status": item.status.value}
        for item in mismatch_details(session.result, **arguments)
    ]


def matching_results(session: Session) -> list[JsonObject]:
    _require_result(session)
    assert session.result is not None
    return [
        {**_dataclass_json(item), "status": item.status.value}
        for item in session.result.field_results
        if item.status not in DISCREPANCY_STATUSES
    ]


def download(session: Session, name: str) -> tuple[bytes, str, str]:
    _require_result(session)
    assert session.result is not None and session.contract is not None
    root = session.contract.name
    if name == "full.csv":
        return reconciliation_csv(session.result), "text/csv", f"{root}_full.csv"
    if name == "mismatches.csv":
        return (
            reconciliation_csv(session.result, mismatches_only=True),
            "text/csv",
            f"{root}_mismatches.csv",
        )
    if name == "report.json":
        return (
            reconciliation_json(session.contract, session.result),
            "application/json",
            f"{root}.json",
        )
    raise ValueError("unknown download")
