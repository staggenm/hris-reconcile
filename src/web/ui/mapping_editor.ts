import { AppError } from "../core/errors";
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
  assessment: "High confidence" | "Review" | "Manual" | "Imported";
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

// Accepted rows that share a value on either side describe one group of
// equivalent values ("Mgr" = "Manager" = "MGR"), so they are merged before the
// contract is built and a 1:N or N:1 translation never conflicts. The group
// keeps its rows' canonical name when they agree, else takes its first B value.
export function selectionsFromRows(fieldLabel: string, rows: MappingEditorRow[]): ValueMappingSelection[] {
  const accepted = rows.filter((row) => row.accepted);
  if (accepted.length === 0) {
    throw new AppError("MAPPING_INCOMPLETE", `tick at least one translation for '${fieldLabel}', or compare it another way`);
  }
  for (const row of accepted) {
    if (row.left === null || row.right === null) {
      throw new AppError("MAPPING_INCOMPLETE", `every ticked translation for '${fieldLabel}' needs a value on both sides`);
    }
  }
  const parent = accepted.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  for (const side of ["left", "right"] as const) {
    const firstWith = new Map<string, number>();
    accepted.forEach((row, index) => {
      const prior = firstWith.get(row[side]!);
      if (prior === undefined) firstWith.set(row[side]!, index);
      else parent[root(index)] = root(prior);
    });
  }
  const groups = new Map<number, MappingEditorRow[]>();
  accepted.forEach((row, index) => {
    const group = groups.get(root(index));
    if (group) group.push(row);
    else groups.set(root(index), [row]);
  });
  const usedCanonicals = new Set<string>();
  return Array.from(groups.values(), (group) => {
    const named = group[0].canonical.trim() !== "" && group.every((row) => row.canonical === group[0].canonical);
    const base = named ? group[0].canonical : group[0].right!;
    // Two groups must never share a canonical name, or they would merge.
    let canonical = base;
    for (let suffix = 2; usedCanonicals.has(canonical); suffix++) canonical = `${base} (${suffix})`;
    usedCanonicals.add(canonical);
    return {
      canonical_value: canonical,
      left_values: [...new Set(group.map((row) => row.left!))],
      right_values: [...new Set(group.map((row) => row.right!))],
    };
  });
}
