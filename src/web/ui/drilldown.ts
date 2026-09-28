import { PairMismatchSummary } from "../analysis/results_analysis";
import { MISSING_LABEL } from "./mapping_editor";

export const ALL_PAIRS = "all";

export interface SelectOption {
  value: string;
  label: string;
}

const shown = (value: string | null) => value ?? MISSING_LABEL;

// The option value carries the pair's index; the label is only for people.
export function pairOptions(rows: PairMismatchSummary[]): SelectOption[] {
  return [
    { value: ALL_PAIRS, label: "All mismatch pairs" },
    ...rows.map((row, index) => ({ value: String(index), label: `${shown(row.left_value)} ↔ ${shown(row.right_value)} (${row.employee_count})` })),
  ];
}

export function selectedPair(value: string, rows: PairMismatchSummary[]): PairMismatchSummary | null {
  if (!/^\d+$/.test(value)) return null;
  return rows[Number(value)] ?? null;
}
