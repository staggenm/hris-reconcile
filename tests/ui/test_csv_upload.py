import pytest

from hris_reconcile.ui.csv_upload import CsvParseError, parse_csv_bytes


def test_uploaded_csv_is_parsed_to_domain_dataset() -> None:
    dataset = parse_csv_bytes(
        b"person_id,name,note\n001,Alpha,\n002,Beta,Present\n",
        name="Core HR",
    )

    assert dataset.name == "Core HR"
    assert dataset.columns == ("person_id", "name", "note")
    assert dataset.records == (
        {"person_id": "001", "name": "Alpha", "note": None},
        {"person_id": "002", "name": "Beta", "note": "Present"},
    )


def test_semicolon_separated_csv_is_detected() -> None:
    dataset = parse_csv_bytes(
        b'person_id;name;company\n001;"Alpha, Beta";0001\n',
        name="Payroll",
    )

    assert dataset.columns == ("person_id", "name", "company")
    assert dataset.records == (
        {"person_id": "001", "name": "Alpha, Beta", "company": "0001"},
    )


@pytest.mark.parametrize("content", [b"", b"person_id,name\n"])
def test_empty_uploaded_dataset_fails(content: bytes) -> None:
    with pytest.raises(CsvParseError, match="empty"):
        parse_csv_bytes(content, name="Empty")


def test_duplicate_headers_fail_explicitly() -> None:
    with pytest.raises(CsvParseError, match=r"duplicate column.*name"):
        parse_csv_bytes(b"id,name,name\n001,Alpha,Beta\n", name="People")


def test_missing_header_fails_explicitly() -> None:
    with pytest.raises(CsvParseError, match="header"):
        parse_csv_bytes(b",name\n001,Alpha\n", name="People")


def test_invalid_utf8_fails_clearly() -> None:
    with pytest.raises(CsvParseError, match="UTF-8"):
        parse_csv_bytes(b"id,name\n001,\xff\n", name="People")


def test_inconsistent_row_width_fails() -> None:
    with pytest.raises(CsvParseError, match="row 2"):
        parse_csv_bytes(b"id,name\n001,Alpha,Extra\n", name="People")
