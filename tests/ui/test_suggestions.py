from pathlib import Path

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.adapters.csv_adapter import parse_csv_bytes
from hris_reconcile.ui.suggestions import (
    score_field_pair,
    suggest_field_mappings,
    suggest_identity,
)


def dataset(name: str, records: tuple[dict[str, str | None], ...]) -> Dataset:
    return Dataset(name=name, columns=tuple(records[0]), records=records)


def test_exact_identifier_headers_are_suggested_confidently() -> None:
    left = dataset(
        "Core HR",
        (
            {"employee_id": "001", "department": "A"},
            {"employee_id": "002", "department": "A"},
            {"employee_id": "003", "department": "B"},
        ),
    )
    right = dataset(
        "Payroll",
        (
            {"employee_id": "001", "pay_group": "X"},
            {"employee_id": "002", "pay_group": "X"},
            {"employee_id": "003", "pay_group": "Y"},
        ),
    )

    suggestion = suggest_identity(left, right)

    assert suggestion.left_column == "employee_id"
    assert suggestion.right_column == "employee_id"
    assert suggestion.confident is True
    assert suggestion.overlap_percentage == 100.0


def test_different_identifier_headers_can_use_value_overlap() -> None:
    left = dataset(
        "Core HR",
        tuple({"person_id_external": f"P{i:03d}"} for i in range(1, 11)),
    )
    right = dataset(
        "Payroll",
        tuple({"personnel_number": f"P{i:03d}"} for i in range(1, 11)),
    )

    suggestion = suggest_identity(left, right)

    assert suggestion.left_column == "person_id_external"
    assert suggestion.right_column == "personnel_number"
    assert suggestion.confident is True
    assert suggestion.overlap_percentage == 100.0


def test_non_unique_candidate_scores_lower() -> None:
    left = dataset(
        "Left",
        (
            {"id": "1", "group": "A"},
            {"id": "2", "group": "A"},
            {"id": "3", "group": "B"},
        ),
    )
    right = dataset(
        "Right",
        (
            {"id": "1", "group": "A"},
            {"id": "2", "group": "A"},
            {"id": "3", "group": "B"},
        ),
    )

    suggestion = suggest_identity(left, right)

    assert suggestion.left_column == "id"
    assert suggestion.score > suggestion.candidates[1].score


def test_weak_identity_candidate_is_not_confident() -> None:
    left = dataset("Left", ({"department": "A"}, {"department": "A"}))
    right = dataset("Right", ({"pay_group": "X"}, {"pay_group": "Y"}))

    suggestion = suggest_identity(left, right)

    assert suggestion.confident is False


def test_exact_field_header_match_scores_highest() -> None:
    assert score_field_pair("department", "department") == 1.0


def test_underscore_and_case_variation_scores_highly() -> None:
    assert score_field_pair("cost_center", "CostCentre") >= 0.85


def test_common_hr_near_equivalents_score_highly() -> None:
    assert score_field_pair("last_name", "surname") >= 0.85
    assert score_field_pair("standard_hours", "weekly_hours") >= 0.85


def test_unrelated_fields_score_low() -> None:
    assert score_field_pair("birth_city", "pay_group") < 0.5


def test_field_suggestions_are_one_to_one_and_exclude_identity() -> None:
    suggestions = suggest_field_mappings(
        ("person_id", "first_name", "cost_center"),
        ("employee_number", "given_name", "costcentre"),
        excluded_left={"person_id"},
        excluded_right={"employee_number"},
    )

    assert {(item.left_column, item.right_column) for item in suggestions} == {
        ("cost_center", "costcentre"),
        ("first_name", "given_name"),
    }
    assert len({item.left_column for item in suggestions}) == len(suggestions)
    assert len({item.right_column for item in suggestions}) == len(suggestions)


def test_example_prefers_employee_identifiers_over_matching_names() -> None:
    example = Path(__file__).parents[2] / "examples" / "core_hr_vs_payroll"
    left = parse_csv_bytes((example / "core_hr.csv").read_bytes(), name="Core HR")
    right = parse_csv_bytes((example / "payroll.csv").read_bytes(), name="Payroll")

    suggestion = suggest_identity(left, right)

    assert (suggestion.left_column, suggestion.right_column) == (
        "person_id",
        "employee_number",
    )
