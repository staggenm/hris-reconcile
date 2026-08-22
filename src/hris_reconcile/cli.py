"""Command-line entry point for local reconciliation runs."""

from pathlib import Path
from typing import Annotated

import typer

from hris_reconcile.adapters.csv_adapter import CsvAdapter
from hris_reconcile.config.loader import load_contract
from hris_reconcile.reconciliation.engine import ReconciliationEngine
from hris_reconcile.reporting.console import render_console_summary
from hris_reconcile.reporting.json_report import write_json_report

app = typer.Typer(no_args_is_help=True, help="Reconcile local HR datasets.")


@app.callback()
def main() -> None:
    """Run deterministic, local-only HR data reconciliation."""


@app.command()
def run(
    contract_path: Annotated[
        Path,
        typer.Argument(exists=True, file_okay=True, dir_okay=False, readable=True),
    ],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="JSON report path."),
    ] = None,
) -> None:
    """Run a reconciliation contract using local files only."""
    contract = load_contract(contract_path)
    result = ReconciliationEngine({"csv": CsvAdapter()}).reconcile(
        contract, base_directory=contract_path.resolve().parent
    )
    output_path = output or Path("output") / f"{contract.name}.json"
    write_json_report(contract, result, output_path)
    render_console_summary(contract, result, output_path)


if __name__ == "__main__":
    app()
