"""Explainable deterministic suggestions for identities and field mappings."""

import re
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from hris_reconcile.adapters.base import Dataset
from hris_reconcile.ui.profiling import ColumnProfile, profile_dataset

_FIELD_ALIASES = {
    frozenset(("firstname", "givenname")): 0.92,
    frozenset(("lastname", "surname")): 0.92,
    frozenset(("standardhours", "weeklyhours")): 0.9,
    frozenset(("personid", "employeenumber")): 0.88,
    frozenset(("company", "companycode")): 0.85,
}


def _header_parts(value: str) -> tuple[str, tuple[str, ...]]:
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", value)
    tokens = tuple(
        token for token in re.split(r"[^a-z0-9]+", spaced.casefold()) if token
    )
    return "".join(tokens), tokens


def score_field_pair(left_column: str, right_column: str) -> float:
    left_compact, left_tokens = _header_parts(left_column)
    right_compact, right_tokens = _header_parts(right_column)
    if left_compact == right_compact:
        return 1.0

    character_score = SequenceMatcher(None, left_compact, right_compact).ratio()
    left_set = set(left_tokens)
    right_set = set(right_tokens)
    token_score = (
        len(left_set & right_set) / len(left_set | right_set)
        if left_set or right_set
        else 0.0
    )
    alias_score = _FIELD_ALIASES.get(frozenset((left_compact, right_compact)), 0.0)
    return round(max(character_score, token_score, alias_score), 4)


def _normalized_values(dataset: Dataset, column: str) -> set[str]:
    return {
        value.strip().casefold()
        for record in dataset.records
        if (value := record[column]) is not None and value.strip() != ""
    }


def _population(profile: ColumnProfile) -> float:
    return profile.non_null_count / profile.row_count if profile.row_count else 0.0


def _identity_header_affinity(column: str) -> float:
    compact, tokens = _header_parts(column)
    if set(tokens) & {"id", "identifier", "key", "number"}:
        return 1.0
    if compact.endswith("id") or "personnelnumber" in compact:
        return 1.0
    return 0.0


@dataclass(frozen=True)
class IdentityCandidate:
    left_column: str
    right_column: str
    score: float
    header_similarity: float
    overlap_percentage: float
    left_population_percentage: float
    right_population_percentage: float
    left_uniqueness_percentage: float
    right_uniqueness_percentage: float
    confident: bool
    reasons: tuple[str, ...]
    candidates: tuple["IdentityCandidate", ...] = ()


def _identity_candidate(
    left: Dataset,
    right: Dataset,
    left_profile: ColumnProfile,
    right_profile: ColumnProfile,
) -> IdentityCandidate:
    header_score = score_field_pair(left_profile.column_name, right_profile.column_name)
    left_values = _normalized_values(left, left_profile.column_name)
    right_values = _normalized_values(right, right_profile.column_name)
    overlap = (
        len(left_values & right_values) / max(len(left_values), len(right_values))
        if left_values or right_values
        else 0.0
    )
    left_population = _population(left_profile)
    right_population = _population(right_profile)
    uniqueness = (
        min(
            left_profile.uniqueness_percentage,
            right_profile.uniqueness_percentage,
        )
        / 100
    )
    identity_affinity = min(
        _identity_header_affinity(left_profile.column_name),
        _identity_header_affinity(right_profile.column_name),
    )
    score = round(
        0.2 * header_score
        + 0.15 * min(left_population, right_population)
        + 0.2 * uniqueness
        + 0.35 * overlap
        + 0.1 * identity_affinity,
        4,
    )
    confident = score >= 0.72 and overlap >= 0.5 and uniqueness >= 0.8
    reasons = (
        f"header similarity: {header_score * 100:.1f}%",
        f"conservative value overlap: {overlap * 100:.1f}%",
        f"lowest population: {min(left_population, right_population) * 100:.1f}%",
        f"lowest uniqueness: {uniqueness * 100:.1f}%",
        f"identifier header signal: {identity_affinity * 100:.0f}%",
    )
    return IdentityCandidate(
        left_column=left_profile.column_name,
        right_column=right_profile.column_name,
        score=score,
        header_similarity=round(header_score * 100, 2),
        overlap_percentage=round(overlap * 100, 2),
        left_population_percentage=round(left_population * 100, 2),
        right_population_percentage=round(right_population * 100, 2),
        left_uniqueness_percentage=left_profile.uniqueness_percentage,
        right_uniqueness_percentage=right_profile.uniqueness_percentage,
        confident=confident,
        reasons=reasons,
    )


def suggest_identity(left: Dataset, right: Dataset) -> IdentityCandidate:
    candidates = [
        _identity_candidate(left, right, left_profile, right_profile)
        for left_profile in profile_dataset(left)
        for right_profile in profile_dataset(right)
    ]
    if not candidates:
        raise ValueError("both datasets must contain at least one column")
    candidates.sort(key=lambda item: (-item.score, item.left_column, item.right_column))
    return replace(candidates[0], candidates=tuple(candidates))


def score_identity_pair(
    left: Dataset,
    right: Dataset,
    *,
    left_column: str,
    right_column: str,
) -> IdentityCandidate:
    left_profiles = {item.column_name: item for item in profile_dataset(left)}
    right_profiles = {item.column_name: item for item in profile_dataset(right)}
    try:
        return _identity_candidate(
            left,
            right,
            left_profiles[left_column],
            right_profiles[right_column],
        )
    except KeyError as error:
        raise ValueError(f"unknown identity column: {error.args[0]}") from error


@dataclass(frozen=True)
class FieldSuggestion:
    left_column: str
    right_column: str
    score: float
    confident: bool
    reason: str


def suggest_field_mappings(
    left_columns: tuple[str, ...],
    right_columns: tuple[str, ...],
    *,
    excluded_left: set[str] | None = None,
    excluded_right: set[str] | None = None,
    minimum_score: float = 0.65,
) -> tuple[FieldSuggestion, ...]:
    excluded_left = excluded_left or set()
    excluded_right = excluded_right or set()
    candidates = [
        FieldSuggestion(
            left_column=left_column,
            right_column=right_column,
            score=score_field_pair(left_column, right_column),
            confident=score_field_pair(left_column, right_column) >= 0.8,
            reason="deterministic header-name similarity",
        )
        for left_column in left_columns
        for right_column in right_columns
        if left_column not in excluded_left and right_column not in excluded_right
    ]
    candidates.sort(key=lambda item: (-item.score, item.left_column, item.right_column))
    selected: list[FieldSuggestion] = []
    used_left: set[str] = set()
    used_right: set[str] = set()
    for candidate in candidates:
        if candidate.score < minimum_score:
            continue
        if candidate.left_column in used_left or candidate.right_column in used_right:
            continue
        selected.append(candidate)
        used_left.add(candidate.left_column)
        used_right.add(candidate.right_column)
    return tuple(selected)
