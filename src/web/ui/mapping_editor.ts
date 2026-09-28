import { ObservedPair } from "../analysis/mapping_analysis";
import { ValueMappingSelection } from "../core/contract_builder";

// Editor rows hold raw dataset values. null means "no value" and is never
// encoded as a string; display sentinels are applied only when rendering.
export interface MappingEditorRow {
  left: string | null;
  right: string | null;
  canonical: string;
  accepted: boolean;
  count: number;
  consistency_percentage: number;
  assessment: "High confidence" | "Review" | "Manual";
}

// Render-only label for a null value (used as the input placeholder).
export const MISSING_LABEL = "<missing>";

// The default canonical value is the Dataset B value (Dataset A if B is
// null), so N:1 rows sharing a B value group without manual edits while a
// genuine 1:N conflict still surfaces as an error.
export function rowsFromEvidence(evidence: ObservedPair[]): MappingEditorRow[] {
  return evidence.map((item) => ({
    left: item.left_value,
    right: item.right_value,
    canonical: item.right_value ?? item.left_value ?? "",
    accepted: item.suggested,
    count: item.count,
    consistency_percentage: item.consistency_percentage,
    assessment: item.suggested ? "High confidence" : "Review",
  }));
}

export function manualRow(): MappingEditorRow {
  return { left: null, right: null, canonical: "", accepted: false, count: 0, consistency_percentage: 0, assessment: "Manual" };
}

// CSV parsing turns empty cells into null, so a real value is never "" and
// the empty input is an exact encoding of null.
export function valueFromInput(text: string): string | null {
  return text === "" ? null : text;
}

export function inputFromValue(value: string | null): string {
  return value ?? "";
}

export function selectionsFromRows(fieldLabel: string, rows: MappingEditorRow[]): ValueMappingSelection[] {
  const accepted = rows.filter((row) => row.accepted);
  if (accepted.length === 0) {
    throw new Error(`confirm at least one value mapping for '${fieldLabel}'`);
  }
  return accepted.map((row) => {
    if (row.left === null || row.right === null) {
      throw new Error(`accepted mappings for '${fieldLabel}' require a value on both sides`);
    }
    if (!row.canonical.trim()) {
      throw new Error(`accepted mappings for '${fieldLabel}' require a canonical value`);
    }
    return { canonical_value: row.canonical, left_values: [row.left], right_values: [row.right] };
  });
}
