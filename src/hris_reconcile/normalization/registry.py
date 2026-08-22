"""Explicit registry and composition of configured normalizers."""

from collections.abc import Callable, Iterable, Mapping

from hris_reconcile.config.models import NormalizerName
from hris_reconcile.normalization import builtins

Normalizer = Callable[[str], str]


class NormalizerRegistry:
    def __init__(self, normalizers: Mapping[str, Normalizer]) -> None:
        self._normalizers = dict(normalizers)

    def resolve(self, name: str) -> Normalizer:
        try:
            return self._normalizers[name]
        except KeyError as error:
            raise ValueError(f"unknown normalizer: {name}") from error


NORMALIZERS = NormalizerRegistry(
    {
        NormalizerName.TRIM: builtins.trim,
        NormalizerName.UPPERCASE: builtins.uppercase,
        NormalizerName.LOWERCASE: builtins.lowercase,
        NormalizerName.CASEFOLD: builtins.casefold,
        NormalizerName.COLLAPSE_WHITESPACE: builtins.collapse_whitespace,
    }
)


def normalize(
    value: str, names: Iterable[str], registry: NormalizerRegistry = NORMALIZERS
) -> str:
    result = value
    for name in names:
        result = registry.resolve(name)(result)
    return result

