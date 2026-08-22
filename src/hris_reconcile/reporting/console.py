"""PII-free Rich console summary."""

from collections import Counter
from pathlib import Path

from rich.console import Console
from rich.table import Table

from hris_reconcile.config.models import ReconciliationContract
from hris_reconcile.identity.models import IdentityStatus
from hris_reconcile.reconciliation.models import (
    FieldComparisonStatus,
    ReconciliationResult,
)


def _summary_table(title: str, rows: list[tuple[str, int]]) -> Table:
    table = Table(title=title, box=None, show_header=False, pad_edge=False)
    table.add_column()
    table.add_column(justify="right")
    for label, count in rows:
        table.add_row(label, str(count))
    return table


def render_console_summary(
    contract: ReconciliationContract,
    result: ReconciliationResult,
    output: Path,
    *,
    console: Console | None = None,
) -> None:
    target = console or Console()
    identities = Counter(item.status for item in result.identity_results)
    fields = Counter(item.status for item in result.field_results)
    unmapped = (
        fields[FieldComparisonStatus.UNMAPPED_LEFT]
        + fields[FieldComparisonStatus.UNMAPPED_RIGHT]
    )
    target.print("[bold]HRIS Reconciliation[/bold]")
    target.print(f"Contract: {contract.name}\n")
    target.print(
        _summary_table(
            "Records",
            [
                ("Matched", identities[IdentityStatus.MATCHED]),
                ("Missing in left", identities[IdentityStatus.MISSING_LEFT]),
                ("Missing in right", identities[IdentityStatus.MISSING_RIGHT]),
                ("Duplicate in left", identities[IdentityStatus.DUPLICATE_LEFT]),
                ("Duplicate in right", identities[IdentityStatus.DUPLICATE_RIGHT]),
            ],
        )
    )
    target.print(
        _summary_table(
            "Field comparisons",
            [
                ("Exact", fields[FieldComparisonStatus.MATCH_EXACT]),
                ("Normalized", fields[FieldComparisonStatus.MATCH_NORMALIZED]),
                ("Mapped", fields[FieldComparisonStatus.MATCH_MAPPED]),
                ("Mismatch", fields[FieldComparisonStatus.MISMATCH]),
                ("Unmapped", unmapped),
                ("Left null", fields[FieldComparisonStatus.LEFT_NULL]),
                ("Right null", fields[FieldComparisonStatus.RIGHT_NULL]),
                ("Both null", fields[FieldComparisonStatus.BOTH_NULL]),
            ],
        )
    )
    target.print(f"\nJSON report written to:\n{output}")

