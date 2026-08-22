"""Small, side-effect-free built-in string normalizers."""

import re


def trim(value: str) -> str:
    return value.strip()


def uppercase(value: str) -> str:
    return value.upper()


def lowercase(value: str) -> str:
    return value.lower()


def casefold(value: str) -> str:
    return value.casefold()


def collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value)

