#!/usr/bin/env python3
"""Validate a generated browser report against the public Python v1 schema."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from hris_reconcile.reporting.json_report import ReconciliationReport  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    path = parser.parse_args().report
    ReconciliationReport.model_validate_json(path.read_text(encoding="utf-8"))
    print(f"valid Python ReconciliationReport v1.0: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
