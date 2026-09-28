import { describe, expect, it } from "vitest";
import { ResultsSummary } from "../src/web/analysis/results_analysis";
import { metricTiles, toneFor } from "../src/web/ui/metrics";

function summary(metrics: Partial<ResultsSummary["metrics"]> = {}): ResultsSummary {
  return {
    datasets: { left: { name: "hr", record_count: 10, column_count: 3 }, right: { name: "pay", record_count: 9, column_count: 3 } },
    identity_counts: {} as ResultsSummary["identity_counts"],
    field_counts: {} as ResultsSummary["field_counts"],
    metrics: {
      matched_employees: 8, missing_left: 0, missing_right: 0, duplicate_identities: 0, missing_identities: 0,
      field_matches: 16, field_discrepancies: 0, unmapped_values: 0, ...metrics,
    },
  };
}

describe("metric tiles", () => {
  it("lists every tile in order with labels and values", () => {
    expect(metricTiles(summary()).map((tile) => [tile.label, tile.value])).toEqual([
      ["hr records", 10], ["pay records", 9], ["Matched employees", 8], ["Missing in Dataset A", 0], ["Missing in Dataset B", 0],
      ["Duplicate identities", 0], ["Missing identity values", 0], ["Field matches", 16], ["Field discrepancies", 0], ["Unmapped values", 0],
    ]);
  });

  it("gives tones from values, not positions", () => {
    const clean = Object.fromEntries(metricTiles(summary()).map((tile) => [tile.label, tile.tone]));
    expect(clean).toEqual({
      "hr records": "neutral", "pay records": "neutral", "Matched employees": "ok", "Missing in Dataset A": "ok",
      "Missing in Dataset B": "ok", "Duplicate identities": "ok", "Missing identity values": "ok", "Field matches": "ok",
      "Field discrepancies": "ok", "Unmapped values": "ok",
    });
    const messy = Object.fromEntries(metricTiles(summary({
      matched_employees: 0, missing_left: 2, missing_right: 1, duplicate_identities: 3, missing_identities: 4,
      field_matches: 0, field_discrepancies: 5, unmapped_values: 6,
    })).map((tile) => [tile.label, tile.tone]));
    expect(messy).toMatchObject({
      "Matched employees": "bad", "Missing in Dataset A": "bad", "Missing in Dataset B": "bad", "Duplicate identities": "bad",
      "Missing identity values": "warn", "Field matches": "neutral", "Field discrepancies": "bad", "Unmapped values": "warn",
    });
  });

  it("exposes the individual tone rules", () => {
    expect(toneFor("problem", 0)).toBe("ok");
    expect(toneFor("problem", 1)).toBe("bad");
    expect(toneFor("warning", 1)).toBe("warn");
    expect(toneFor("good", 0)).toBe("bad");
    expect(toneFor("bonus", 0)).toBe("neutral");
    expect(toneFor("count", 7)).toBe("neutral");
  });
});
