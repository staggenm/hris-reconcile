"""Load a YAML reconciliation contract into strict domain configuration."""

from pathlib import Path
from typing import Any

import yaml

from hris_reconcile.config.models import ReconciliationContract


def load_contract(path: Path) -> ReconciliationContract:
    """Read and validate a contract, raising on YAML or model errors."""
    with path.open(encoding="utf-8") as stream:
        raw: Any = yaml.safe_load(stream)
    return ReconciliationContract.model_validate(raw)

