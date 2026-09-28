import { describe, expect, it } from "vitest";
import { PairMismatchSummary } from "../src/web/analysis/results_analysis";
import { ALL_PAIRS, pairOptions, selectedPair } from "../src/web/ui/drilldown";

const pair = (left: string | null, right: string | null, count: number): PairMismatchSummary => ({
  field_name: "f", left_value: left, right_value: right, status: "mismatch", employee_count: count, percentage: 0,
});
const rows = [pair("10: odd", "X", 3), pair(null, "Y", 1)];

describe("drill-down options", () => {
  it("puts the index in the option value and keeps it out of the label", () => {
    expect(pairOptions(rows)).toEqual([
      { value: ALL_PAIRS, label: "All mismatch pairs" },
      { value: "0", label: "10: odd ↔ X (3)" },
      { value: "1", label: "<missing> ↔ Y (1)" },
    ]);
  });

  it("resolves a selected value back to its pair", () => {
    expect(selectedPair(ALL_PAIRS, rows)).toBeNull();
    expect(selectedPair("1", rows)).toBe(rows[1]);
    expect(selectedPair("7", rows)).toBeNull();
    expect(selectedPair("1x", rows)).toBeNull();
  });
});
