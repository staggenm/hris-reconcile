from pathlib import Path

import pytest
from pydantic import ValidationError

from hris_reconcile.config.loader import load_contract

VALID_CONTRACT = """
name: example
left: {name: left, type: csv, path: left.csv}
right: {name: right, type: csv, path: right.csv}
identity: {left: person_id, right: employee_number}
fields:
  - name: first_name
    left: first_name
    right: given_name
    normalize: [trim, casefold]
  - name: company
    left: company
    right: company_code
    value_mapping: company
value_mappings:
  company:
    DE_GERMANY:
      left: [DE01]
      right: ["1000"]
"""


def write_contract(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "contract.yaml"
    path.write_text(content, encoding="utf-8")
    return path


def test_valid_contract_loads(tmp_path: Path) -> None:
    contract = load_contract(write_contract(tmp_path, VALID_CONTRACT))

    assert contract.name == "example"
    assert contract.fields[0].normalize == ["trim", "casefold"]


def test_dataset_source_type_and_path_must_be_provided_together(
    tmp_path: Path,
) -> None:
    content = VALID_CONTRACT.replace("type: csv, path: left.csv", "type: csv")

    with pytest.raises(ValidationError, match="provided together"):
        load_contract(write_contract(tmp_path, content))


def test_missing_identity_configuration_fails(tmp_path: Path) -> None:
    content = VALID_CONTRACT.replace(
        "identity: {left: person_id, right: employee_number}\n", ""
    )

    with pytest.raises(ValidationError):
        load_contract(write_contract(tmp_path, content))


def test_unknown_normalization_function_fails(tmp_path: Path) -> None:
    content = VALID_CONTRACT.replace("[trim, casefold]", "[trim, mystery]")

    with pytest.raises(ValidationError, match="mystery"):
        load_contract(write_contract(tmp_path, content))


@pytest.mark.parametrize(
    "bad_mapping",
    [
        'left: []\n      right: ["1000"]',
        "left: [DE01]\n      right: []",
        'left: DE01\n      right: ["1000"]',
    ],
)
def test_malformed_value_mapping_fails(tmp_path: Path, bad_mapping: str) -> None:
    content = VALID_CONTRACT.replace('left: [DE01]\n      right: ["1000"]', bad_mapping)

    with pytest.raises(ValidationError):
        load_contract(write_contract(tmp_path, content))


def test_ambiguous_mapping_value_fails(tmp_path: Path) -> None:
    content = (
        VALID_CONTRACT
        + """
    CH_SWITZERLAND:
      left: [DE01]
      right: ["2000"]
"""
    )

    with pytest.raises(ValidationError, match="DE01"):
        load_contract(write_contract(tmp_path, content))
