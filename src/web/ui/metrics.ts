import { ResultsSummary } from "../analysis/results_analysis";

export type Tone = "ok" | "bad" | "warn" | "neutral";

// How a metric's value is judged:
// - problem: any occurrence is bad, none is ok (missing, duplicates, discrepancies);
// - warning: any occurrence needs attention, none is ok (unmapped values, missing identities);
// - good: some is ok, none is bad (matched employees);
// - bonus: some is ok, none is neutral (field matches);
// - count: always neutral (record counts).
export type MetricKind = "problem" | "warning" | "good" | "bonus" | "count";

export function toneFor(kind: MetricKind, value: number): Tone {
  switch (kind) {
    case "problem": return value > 0 ? "bad" : "ok";
    case "warning": return value > 0 ? "warn" : "ok";
    case "good": return value > 0 ? "ok" : "bad";
    case "bonus": return value > 0 ? "ok" : "neutral";
    case "count": return "neutral";
  }
}

export interface MetricTile {
  label: string;
  value: number;
  tone: Tone;
}

export function metricTiles(summary: ResultsSummary): MetricTile[] {
  const { metrics, datasets } = summary;
  const tiles: Array<[string, number, MetricKind]> = [
    [`${datasets.left.name} records`, datasets.left.record_count, "count"],
    [`${datasets.right.name} records`, datasets.right.record_count, "count"],
    ["Matched employees", metrics.matched_employees, "good"],
    ["Missing in Dataset A", metrics.missing_left, "problem"],
    ["Missing in Dataset B", metrics.missing_right, "problem"],
    ["Duplicate identities", metrics.duplicate_identities, "problem"],
    ["Missing identity values", metrics.missing_identities, "warning"],
    ["Field matches", metrics.field_matches, "bonus"],
    ["Field discrepancies", metrics.field_discrepancies, "problem"],
    ["Unmapped values", metrics.unmapped_values, "warning"],
  ];
  return tiles.map(([label, value, kind]) => ({ label, value, tone: toneFor(kind, value) }));
}
