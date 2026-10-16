import type { RowCounts, RowFilter } from "../analysis/result_rows";
import { ROW_STATUS } from "./labels";

export type Tone = "ok" | "diff" | "a" | "b" | "warn";

// KPI tiles double as the table filters.
export interface KpiTile {
  filter: RowFilter;
  icon: string;
  label: string;
  value: number;
  tone: Tone;
}

export function kpiTiles(counts: RowCounts, names: { a: string; b: string }): KpiTile[] {
  const tiles: KpiTile[] = [
    { filter: "match", icon: ROW_STATUS.match.icon, label: "Matched", value: counts.match, tone: "ok" },
    { filter: "differs", icon: ROW_STATUS.differs.icon, label: "Differ", value: counts.differs, tone: "diff" },
    { filter: "only_a", icon: "A", label: `Only in ${names.a}`, value: counts.only_a, tone: "a" },
    { filter: "only_b", icon: "B", label: `Only in ${names.b}`, value: counts.only_b, tone: "b" },
  ];
  const warnings = counts.duplicate + counts.blank_key;
  // The warnings tile appears only when there is something to warn about.
  if (warnings > 0) tiles.push({ filter: "warnings", icon: "!", label: "Duplicate or blank keys", value: warnings, tone: "warn" });
  return tiles;
}
