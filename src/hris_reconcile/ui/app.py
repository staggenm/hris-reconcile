"""Local Streamlit workbench for guided HR dataset reconciliation."""

import hashlib
import re
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Protocol, cast

import pandas as pd
import streamlit as st

from hris_reconcile import __version__
from hris_reconcile.adapters.base import Dataset
from hris_reconcile.config.models import ReconciliationContract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.engine import ReconciliationEngine
from hris_reconcile.reconciliation.models import (
    FieldComparisonStatus,
    ReconciliationResult,
)
from hris_reconcile.ui.contract_builder import (
    ComparisonMode,
    FieldSelection,
    ValueMappingSelection,
    WizardConfiguration,
    WizardConfigurationError,
    build_contract,
)
from hris_reconcile.ui.csv_upload import CsvParseError, parse_uploaded_csv
from hris_reconcile.ui.mapping_analysis import analyze_observed_pairs
from hris_reconcile.ui.profiling import ColumnProfile, profile_dataset
from hris_reconcile.ui.results_analysis import (
    DISCREPANCY_STATUSES,
    aggregate_mismatches_by_field,
    aggregate_mismatches_by_pair,
    mismatch_details,
    reconciliation_csv,
    reconciliation_json,
)
from hris_reconcile.ui.suggestions import (
    score_identity_pair,
    suggest_field_mappings,
    suggest_identity,
)

_MISSING = "<missing>"
_DOWNSTREAM_KEYS = (
    "identity_confirmed_pair",
    "field_selections",
    "mapping_editor",
    "mapped_field_selections",
    "contract",
    "result",
)


class UploadedCsv(Protocol):
    name: str

    def getvalue(self) -> bytes: ...


def _clear_keys(*keys: str) -> None:
    for key in keys:
        st.session_state.pop(key, None)


def _reset_after_upload() -> None:
    _clear_keys(*_DOWNSTREAM_KEYS)
    for key in tuple(st.session_state):
        if str(key).startswith(("field_editor", "value_editor")):
            del st.session_state[key]


def _parse_upload(side: str, uploaded: UploadedCsv | None) -> Dataset | None:
    dataset_key = f"{side}_dataset"
    signature_key = f"{side}_upload_signature"
    if uploaded is None:
        if dataset_key in st.session_state:
            _clear_keys(dataset_key, signature_key)
            _reset_after_upload()
        return None

    content = uploaded.getvalue()
    signature = (uploaded.name, hashlib.sha256(content).hexdigest())
    if st.session_state.get(signature_key) != signature:
        try:
            dataset = parse_uploaded_csv(
                content,
                name=Path(uploaded.name).stem or side.title(),
            )
        except CsvParseError as error:
            _clear_keys(dataset_key, signature_key)
            _reset_after_upload()
            st.error(f"Could not read {uploaded.name}: {error}")
            return None
        st.session_state[dataset_key] = dataset
        st.session_state[signature_key] = signature
        st.session_state[f"{side}_logical_name"] = dataset.name
        _reset_after_upload()
    return cast(Dataset, st.session_state[dataset_key])


def _preview(dataset: Dataset) -> pd.DataFrame:
    return pd.DataFrame([dict(record) for record in dataset.records[:5]])


def _profile_table(dataset: Dataset) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Column": profile.column_name,
                "Rows": profile.row_count,
                "Non-null": profile.non_null_count,
                "Null %": profile.null_percentage,
                "Distinct": profile.distinct_count,
                "Unique %": profile.uniqueness_percentage,
                "Samples": ", ".join(profile.sample_values),
            }
            for profile in profile_dataset(dataset)
        ]
    )


def _render_dataset_card(dataset: Dataset, side: str) -> None:
    st.text_input(
        "Logical source name",
        key=f"{side}_logical_name",
        help="Used only in this reconciliation report.",
        on_change=_clear_keys,
        args=("contract_name", "contract", "result"),
    )
    first, second = st.columns(2)
    first.metric("Rows", len(dataset.records))
    second.metric("Columns", len(dataset.columns))
    st.caption("Detected columns: " + ", ".join(dataset.columns))
    st.dataframe(_preview(dataset), width="stretch", hide_index=True)
    with st.expander("Column profile"):
        st.dataframe(_profile_table(dataset), width="stretch", hide_index=True)


def _render_upload_step() -> tuple[Dataset | None, Dataset | None]:
    st.header("1. Upload datasets")
    st.write(
        "Choose two CSV exports to compare. Only the first five rows are previewed."
    )
    left_column, right_column = st.columns(2)
    with left_column:
        st.subheader("Dataset A")
        left_upload = st.file_uploader("Upload CSV", type=["csv"], key="left_upload")
        left = _parse_upload("left", cast(UploadedCsv | None, left_upload))
        if left is not None and left_upload is not None:
            st.caption(f"File: {left_upload.name}")
            _render_dataset_card(left, "left")
    with right_column:
        st.subheader("Dataset B")
        right_upload = st.file_uploader("Upload CSV", type=["csv"], key="right_upload")
        right = _parse_upload("right", cast(UploadedCsv | None, right_upload))
        if right is not None and right_upload is not None:
            st.caption(f"File: {right_upload.name}")
            _render_dataset_card(right, "right")
    return left, right


def _profile_for(dataset: Dataset, column: str) -> ColumnProfile:
    return next(item for item in profile_dataset(dataset) if item.column_name == column)


def _identity_profile_text(profile: ColumnProfile) -> str:
    population = (
        profile.non_null_count / profile.row_count * 100 if profile.row_count else 0.0
    )
    return f"{population:.1f}% populated · {profile.uniqueness_percentage:.1f}% unique"


def _render_identity_step(left: Dataset, right: Dataset) -> tuple[str, str] | None:
    st.header("2. Match employees")
    st.write("Which fields identify the same employee in both datasets?")
    suggestion = suggest_identity(left, right)
    if suggestion.confident:
        st.info(
            "Suggested identity mapping: "
            f"**{suggestion.left_column}** ↔ **{suggestion.right_column}**\n\n"
            + " · ".join(suggestion.reasons)
        )
    else:
        st.warning(
            "No high-confidence identity pair was found. Review the profiles and "
            "choose both fields explicitly."
        )

    left_options = list(left.columns)
    right_options = list(right.columns)
    st.session_state.setdefault("left_identity", suggestion.left_column)
    st.session_state.setdefault("right_identity", suggestion.right_column)
    if st.session_state.left_identity not in left_options:
        st.session_state.left_identity = left_options[0]
    if st.session_state.right_identity not in right_options:
        st.session_state.right_identity = right_options[0]

    left_column, arrow_column, right_column = st.columns((5, 1, 5))
    with left_column:
        left_identity = st.selectbox(
            st.session_state.left_logical_name,
            left_options,
            key="left_identity",
        )
        st.caption(_identity_profile_text(_profile_for(left, left_identity)))
    with arrow_column:
        st.write("↔")
    with right_column:
        right_identity = st.selectbox(
            st.session_state.right_logical_name,
            right_options,
            key="right_identity",
        )
        st.caption(_identity_profile_text(_profile_for(right, right_identity)))

    evidence = score_identity_pair(
        left,
        right,
        left_column=left_identity,
        right_column=right_identity,
    )
    st.caption(
        "Conservative trimmed/case-insensitive value overlap for selection: "
        f"{evidence.overlap_percentage:.1f}%. Reconciliation itself keeps exact "
        "identity matching."
    )
    pair = (left_identity, right_identity)
    if st.button("Confirm employee identity", type="primary"):
        st.session_state.identity_confirmed_pair = pair
        _clear_keys("field_selections", "mapped_field_selections", "contract", "result")
    if st.session_state.get("identity_confirmed_pair") == pair:
        st.success("Employee identity fields confirmed.")
        return pair
    return None


def _initial_field_rows(
    left: Dataset, right: Dataset, identity_pair: tuple[str, str]
) -> list[dict[str, object]]:
    suggestions = suggest_field_mappings(
        left.columns,
        right.columns,
        excluded_left={identity_pair[0]},
        excluded_right={identity_pair[1]},
    )
    return [
        {
            "Dataset A field": item.left_column,
            "Dataset B field": item.right_column,
            "Mode": ComparisonMode.EXACT.value,
        }
        for item in suggestions
    ]


def _field_rows_to_selections(
    editor: pd.DataFrame,
) -> tuple[FieldSelection, ...]:
    selections: list[FieldSelection] = []
    for row in editor.to_dict(orient="records"):
        left_column = row.get("Dataset A field")
        right_column = row.get("Dataset B field")
        mode_value = row.get("Mode", ComparisonMode.EXACT.value)
        if pd.isna(left_column) and pd.isna(right_column):
            continue
        if not isinstance(left_column, str) or not isinstance(right_column, str):
            raise WizardConfigurationError("each field mapping requires both columns")
        selections.append(
            FieldSelection(
                left_column=left_column,
                right_column=right_column,
                mode=ComparisonMode(str(mode_value)),
            )
        )
    active = [item for item in selections if item.mode is not ComparisonMode.IGNORE]
    if not active:
        raise WizardConfigurationError("select at least one comparison field")
    if len({item.left_column for item in active}) != len(active) or len(
        {item.right_column for item in active}
    ) != len(active):
        raise WizardConfigurationError(
            "a field cannot be mapped more than once on either side"
        )
    return tuple(selections)


def _render_field_step(
    left: Dataset, right: Dataset, identity_pair: tuple[str, str]
) -> tuple[FieldSelection, ...] | None:
    st.header("3. Match fields")
    st.write(
        "Confirm corresponding fields. Exact comparison is the default; add "
        "normalization or semantic mappings only where they are intended."
    )
    st.caption(
        "For code differences such as 1 ↔ 0001, click the field's Mode cell, "
        "choose 'Value mapping', then confirm the field mappings."
    )
    rows = _initial_field_rows(left, right, identity_pair)
    editor = st.data_editor(
        pd.DataFrame(rows),
        key="field_editor",
        num_rows="dynamic",
        width="stretch",
        hide_index=True,
        on_change=_clear_keys,
        args=("field_selections", "mapped_field_selections", "contract", "result"),
        column_config={
            "Dataset A field": st.column_config.SelectboxColumn(
                options=[item for item in left.columns if item != identity_pair[0]],
                required=True,
            ),
            "Dataset B field": st.column_config.SelectboxColumn(
                options=[item for item in right.columns if item != identity_pair[1]],
                required=True,
            ),
            "Mode": st.column_config.SelectboxColumn(
                options=[mode.value for mode in ComparisonMode],
                default=ComparisonMode.EXACT.value,
                required=True,
            ),
        },
    )
    if st.button("Confirm field mappings", type="primary"):
        try:
            selections = _field_rows_to_selections(editor)
        except (ValueError, WizardConfigurationError) as error:
            st.error(str(error))
        else:
            st.session_state.field_selections = selections
            _clear_keys("mapped_field_selections", "contract", "result")
    stored_selections: object = st.session_state.get("field_selections")
    if isinstance(stored_selections, tuple) and all(
        isinstance(item, FieldSelection) for item in stored_selections
    ):
        st.success("Field mappings confirmed.")
        return cast(tuple[FieldSelection, ...], stored_selections)
    return None


def _display_value(value: str | None) -> str:
    return _MISSING if value is None else value


def _mapping_editor_rows(
    left: Dataset,
    right: Dataset,
    identity_pair: tuple[str, str],
    field: FieldSelection,
) -> list[dict[str, object]]:
    evidence = analyze_observed_pairs(
        left,
        right,
        left_identity=identity_pair[0],
        right_identity=identity_pair[1],
        left_field=field.left_column,
        right_field=field.right_column,
    )
    return [
        {
            "Accept semantic mapping": item.suggested,
            "Canonical value": f"CANONICAL_{index:03d}",
            "Dataset A value": _display_value(item.left_value),
            "Dataset B value": _display_value(item.right_value),
            "Employees": item.count,
            "Consistency %": item.consistency_percentage,
            "Assessment": "High confidence" if item.suggested else "Review",
        }
        for index, item in enumerate(evidence, start=1)
    ]


def _editor_to_value_mappings(
    editor: pd.DataFrame,
) -> tuple[ValueMappingSelection, ...]:
    mappings: list[ValueMappingSelection] = []
    for row in editor.to_dict(orient="records"):
        if not bool(row.get("Accept semantic mapping", False)):
            continue
        canonical = row.get("Canonical value")
        left_value = row.get("Dataset A value")
        right_value = row.get("Dataset B value")
        if (
            not isinstance(canonical, str)
            or not canonical
            or not isinstance(left_value, str)
            or not left_value
            or not isinstance(right_value, str)
            or not right_value
        ):
            raise WizardConfigurationError(
                "included mappings require values on both sides"
            )
        if left_value == _MISSING or right_value == _MISSING:
            raise WizardConfigurationError(
                "missing values cannot be semantic mapping aliases"
            )
        mappings.append(
            ValueMappingSelection(
                canonical_value=canonical,
                left_values=(left_value,),
                right_values=(right_value,),
            )
        )
    return tuple(mappings)


def _render_mapping_step(
    left: Dataset,
    right: Dataset,
    identity_pair: tuple[str, str],
    fields: tuple[FieldSelection, ...],
) -> tuple[FieldSelection, ...] | None:
    st.header("4. Review value mappings")
    mapping_fields = [
        field for field in fields if field.mode is ComparisonMode.VALUE_MAPPING
    ]
    editors: dict[int, pd.DataFrame] = {}
    if not mapping_fields:
        st.warning(
            "No fields currently use semantic value mapping. To maintain one, "
            "change that field's Mode to 'Value mapping' in step 3 and click "
            "'Confirm field mappings' again."
        )
    for index, field in enumerate(mapping_fields):
        st.subheader(f"{field.left_column} ↔ {field.right_column}")
        st.caption(
            "Observed pairs are advisory. High confidence requires at least two "
            "employees and at least 95% one-to-one consistency. Select "
            "'Accept semantic mapping' only for pairs you confirm as equivalent. "
            "You can edit values or add a row to maintain a mapping manually."
        )
        rows = _mapping_editor_rows(left, right, identity_pair, field)
        editors[index] = st.data_editor(
            pd.DataFrame(rows),
            key=f"value_editor_{index}_{field.left_column}",
            num_rows="dynamic",
            width="stretch",
            hide_index=True,
            disabled=["Employees", "Consistency %", "Assessment"],
            on_change=_clear_keys,
            args=("mapped_field_selections", "contract", "result"),
        )
    if st.button("Confirm accepted semantic mappings", type="primary"):
        try:
            replacements = {
                field.left_column: _editor_to_value_mappings(editors[index])
                for index, field in enumerate(mapping_fields)
            }
            mapped_fields = tuple(
                replace(field, value_mappings=replacements.get(field.left_column, ()))
                for field in fields
            )
            for field in mapping_fields:
                if not replacements[field.left_column]:
                    raise WizardConfigurationError(
                        f"confirm at least one value mapping for {field.left_column!r}"
                    )
        except WizardConfigurationError as error:
            st.error(str(error))
        else:
            st.session_state.mapped_field_selections = mapped_fields
            _clear_keys("contract", "result")
    mapped = st.session_state.get("mapped_field_selections")
    if mapped is not None:
        st.success("Value mapping review complete.")
        return cast(tuple[FieldSelection, ...], mapped)
    return None


def _contract_name(left_name: str, right_name: str) -> str:
    value = f"{left_name}_vs_{right_name}".casefold()
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_") or "ui_reconciliation"


def _renamed(dataset: Dataset, name: str) -> Dataset:
    return Dataset(name=name, columns=dataset.columns, records=dataset.records)


def _render_run_step(
    left: Dataset,
    right: Dataset,
    identity_pair: tuple[str, str],
    fields: tuple[FieldSelection, ...],
) -> tuple[ReconciliationContract, ReconciliationResult] | None:
    st.header("5. Run comparison")
    left_name = str(st.session_state.left_logical_name)
    right_name = str(st.session_state.right_logical_name)
    st.session_state.setdefault("contract_name", _contract_name(left_name, right_name))
    name = st.text_input(
        "Reconciliation name",
        key="contract_name",
        on_change=_clear_keys,
        args=("contract", "result"),
    )
    comparison_count = sum(field.mode is not ComparisonMode.IGNORE for field in fields)
    st.caption(
        f"Identity: {identity_pair[0]} ↔ {identity_pair[1]} · "
        f"Comparison fields: {comparison_count}"
    )
    if st.button("Run reconciliation", type="primary"):
        try:
            contract = build_contract(
                WizardConfiguration(
                    contract_name=name,
                    left_name=left_name,
                    right_name=right_name,
                    left_identity=identity_pair[0],
                    right_identity=identity_pair[1],
                    fields=fields,
                )
            )
            result = ReconciliationEngine().reconcile(
                contract=contract,
                left_dataset=_renamed(left, left_name),
                right_dataset=_renamed(right, right_name),
            )
        except (ValueError, KeyError) as error:
            st.error(f"Reconciliation could not run: {error}")
        else:
            st.session_state.contract = contract
            st.session_state.result = result
    if "contract" in st.session_state and "result" in st.session_state:
        return (
            cast(ReconciliationContract, st.session_state.contract),
            cast(ReconciliationResult, st.session_state.result),
        )
    return None


def _render_results(
    contract: ReconciliationContract, result: ReconciliationResult
) -> None:
    st.header("6. Explore discrepancies")
    identity_counts = Counter(item.status for item in result.identity_results)
    field_counts = Counter(item.status for item in result.field_results)
    matches = sum(
        field_counts[status]
        for status in (
            FieldComparisonStatus.MATCH_EXACT,
            FieldComparisonStatus.MATCH_NORMALIZED,
            FieldComparisonStatus.MATCH_MAPPED,
            FieldComparisonStatus.BOTH_NULL,
        )
    )
    mismatches = sum(field_counts[status] for status in DISCREPANCY_STATUSES)
    unmapped = (
        field_counts[FieldComparisonStatus.UNMAPPED_LEFT]
        + field_counts[FieldComparisonStatus.UNMAPPED_RIGHT]
    )
    duplicate_count = (
        identity_counts[IdentityStatus.DUPLICATE_LEFT]
        + identity_counts[IdentityStatus.DUPLICATE_RIGHT]
    )

    row_one = st.columns(5)
    row_one[0].metric(
        f"{result.left_dataset.name} records", result.left_dataset.record_count
    )
    row_one[1].metric(
        f"{result.right_dataset.name} records", result.right_dataset.record_count
    )
    row_one[2].metric("Matched employees", identity_counts[IdentityStatus.MATCHED])
    row_one[3].metric(
        "Missing in Dataset A", identity_counts[IdentityStatus.MISSING_LEFT]
    )
    row_one[4].metric(
        "Missing in Dataset B", identity_counts[IdentityStatus.MISSING_RIGHT]
    )
    row_two = st.columns(4)
    row_two[0].metric("Duplicate identities", duplicate_count)
    row_two[1].metric("Field matches", matches)
    row_two[2].metric("Field discrepancies", mismatches)
    row_two[3].metric("Unmapped values", unmapped)

    st.subheader("Mismatch analysis by field")
    summaries = aggregate_mismatches_by_field(result)
    if not summaries:
        st.success("No field discrepancies were found.")
    else:
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Field": item.field_name,
                        "Mismatches": item.mismatch_count,
                        "Comparisons": item.comparison_count,
                        "Rate %": item.mismatch_rate_percentage,
                    }
                    for item in summaries
                ]
            ),
            width="stretch",
            hide_index=True,
        )
        selected_field = st.selectbox(
            "Inspect mismatch patterns for field",
            [item.field_name for item in summaries],
        )
        pairs = aggregate_mismatches_by_pair(result, field_name=selected_field)
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Dataset A value": _display_value(item.left_value),
                        "Dataset B value": _display_value(item.right_value),
                        "Status": item.status.value,
                        "Employees": item.employee_count,
                        "Share %": item.percentage,
                    }
                    for item in pairs
                ]
            ),
            width="stretch",
            hide_index=True,
        )
        pair_options = ["All mismatch pairs", *range(len(pairs))]

        def format_pair(option: str | int) -> str:
            if option == "All mismatch pairs":
                return str(option)
            pair = pairs[cast(int, option)]
            return (
                f"{_display_value(pair.left_value)} ↔ "
                f"{_display_value(pair.right_value)} ({pair.employee_count})"
            )

        selected_pair = st.selectbox(
            "Employee drill-down",
            pair_options,
            format_func=format_pair,
        )
        if selected_pair == "All mismatch pairs":
            details = mismatch_details(result, field_name=selected_field)
        else:
            pair = pairs[cast(int, selected_pair)]
            details = mismatch_details(
                result,
                field_name=selected_field,
                left_value=pair.left_value,
                right_value=pair.right_value,
            )
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Employee identity": item.identity,
                        "Field": item.field_name,
                        "Dataset A value": _display_value(item.left_raw_value),
                        "Dataset B value": _display_value(item.right_raw_value),
                        "Comparison status": item.status.value,
                    }
                    for item in details
                ]
            ),
            width="stretch",
            hide_index=True,
        )

    with st.expander("Optional matching comparison details"):
        matching = [
            item
            for item in result.field_results
            if item.status not in DISCREPANCY_STATUSES
        ]
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Employee identity": item.identity,
                        "Field": item.field_name,
                        "Dataset A value": _display_value(item.left_raw_value),
                        "Dataset B value": _display_value(item.right_raw_value),
                        "Comparison status": item.status.value,
                    }
                    for item in matching
                ]
            ),
            width="stretch",
            hide_index=True,
        )

    st.subheader("Download local results")
    first, second, third = st.columns(3)
    first.download_button(
        "Full results CSV",
        reconciliation_csv(result),
        file_name=f"{contract.name}_full.csv",
        mime="text/csv",
    )
    second.download_button(
        "Mismatches only CSV",
        reconciliation_csv(result, mismatches_only=True),
        file_name=f"{contract.name}_mismatches.csv",
        mime="text/csv",
    )
    third.download_button(
        "JSON report",
        reconciliation_json(contract, result),
        file_name=f"{contract.name}.json",
        mime="application/json",
    )


def main() -> None:
    st.set_page_config(
        page_title="HRIS Reconciliation",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    st.title("HRIS Reconciliation")
    st.write("Discover why two HR datasets disagree.")
    st.info(
        "All processing takes place locally on this computer. Uploaded data is "
        "not transmitted to any external service."
    )
    with st.sidebar:
        st.subheader("Local reconciliation")
        st.caption(
            f"Version {__version__} · CSV data is retained only in the active "
            "application session."
        )
        if st.button("Clear session / start over"):
            for key in tuple(st.session_state):
                del st.session_state[key]
            st.rerun()

    left, right = _render_upload_step()
    if left is None or right is None:
        return
    identity_pair = _render_identity_step(left, right)
    if identity_pair is None:
        return
    fields = _render_field_step(left, right, identity_pair)
    if fields is None:
        return
    mapped_fields = _render_mapping_step(left, right, identity_pair, fields)
    if mapped_fields is None:
        return
    completed = _render_run_step(left, right, identity_pair, mapped_fields)
    if completed is not None:
        _render_results(*completed)


if __name__ == "__main__":
    main()
