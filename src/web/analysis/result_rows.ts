// The people-facing view of a result: one row per key with a single status,
// the compared values side by side, and per-cell difference states. Used by
// the results table, the readable exports and the fix hints.

import { compareCodePoints } from "../core/compare";
import { modeNormalizers } from "../core/contract_builder";
import { fieldMode, fieldFormat } from "../core/contract_document";
import { casefold, normalize } from "../core/normalization";
import { isCanonicalNumber, subtractCanonical } from "../core/numbers";
import {
  ComparisonMode,
  FieldComparisonResult,
  FieldConfig,
  IdentityResult,
  ReconciliationContract,
  ReconciliationResult,
  ValueFormat,
} from "../core/types";

export type RowStatus = "match" | "differs" | "only_a" | "only_b" | "duplicate" | "blank_key";
export type RowFilter = "issues" | "all" | "match" | "differs" | "only_a" | "only_b" | "warnings";
export type CellState = "same" | "differs" | "a_empty" | "b_empty" | "absent";

export interface ResultColumn {
  name: string;
  left: string;
  right: string;
  numeric: boolean;
}

export interface ResultCell {
  a: string | null;
  b: string | null;
  state: CellState;
  // Number fields: B − A, as a canonical decimal string.
  delta: string | null;
}

export interface ResultRow {
  status: RowStatus;
  // "a" or "b" for duplicate and blank-key rows: the file the problem is in.
  side: "a" | "b" | null;
  identity: string | null;
  leftLines: number[];
  rightLines: number[];
  cells: ResultCell[];
}

export interface ResultRowsPage {
  columns: ResultColumn[];
  rows: ResultRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RowCounts {
  match: number;
  differs: number;
  only_a: number;
  only_b: number;
  duplicate: number;
  blank_key: number;
}

export function rowStatus(identity: IdentityResult, hasDifferences: boolean): RowStatus {
  switch (identity.status) {
    case "matched": return hasDifferences ? "differs" : "match";
    case "missing_right": return "only_a";
    case "missing_left": return "only_b";
    case "duplicate_left":
    case "duplicate_right": return "duplicate";
    default: return "blank_key";
  }
}

function rowSide(identity: IdentityResult): "a" | "b" | null {
  if (identity.status === "duplicate_left" || identity.status === "missing_identity_left") return "a";
  if (identity.status === "duplicate_right" || identity.status === "missing_identity_right") return "b";
  return null;
}

const isNumberField = (field: FieldConfig) => fieldMode(field) === "Number";

// Discrepancies grouped by key, built once per result.
export class ResultIndex {
  readonly differencesByIdentity = new Map<string, FieldComparisonResult[]>();
  readonly counts: RowCounts = { match: 0, differs: 0, only_a: 0, only_b: 0, duplicate: 0, blank_key: 0 };
  readonly statuses: RowStatus[];

  constructor(readonly contract: ReconciliationContract, readonly result: ReconciliationResult) {
    for (const item of result.discrepancies) {
      const list = this.differencesByIdentity.get(item.identity);
      if (list) list.push(item);
      else this.differencesByIdentity.set(item.identity, [item]);
    }
    this.statuses = result.identityResults.map((identity) => {
      const status = rowStatus(identity, identity.status === "matched" && this.differencesByIdentity.has(identity.identity!));
      this.counts[status]++;
      return status;
    });
  }

  differences(identity: IdentityResult): FieldComparisonResult[] {
    return identity.status === "matched" ? this.differencesByIdentity.get(identity.identity!) ?? [] : [];
  }

  // Fields with at least one difference, in contract order (all fields if none differ).
  differingFields(): FieldConfig[] {
    const differing = this.contract.fields.filter((field) => {
      const counts = this.result.fieldCounts.get(field.name);
      return counts && counts.mismatch + counts.left_null + counts.right_null + counts.unmapped_left + counts.unmapped_right > 0;
    });
    return differing.length > 0 ? differing : this.contract.fields;
  }

  row(index: number, fields: FieldConfig[]): ResultRow {
    const identity = this.result.identityResults[index];
    const differences = this.differences(identity);
    const cells = fields.map((field): ResultCell => {
      const a = identity.leftRecord?.[field.left] ?? null;
      const b = identity.rightRecord?.[field.right] ?? null;
      if (identity.status !== "matched") return { a, b, state: "absent", delta: null };
      const difference = differences.find((item) => item.fieldName === field.name);
      if (!difference) return { a, b, state: "same", delta: null };
      const state: CellState = difference.status === "left_null" ? "a_empty" : difference.status === "right_null" ? "b_empty" : "differs";
      return { a, b, state, delta: numberDelta(field, difference) };
    });
    return {
      status: this.statuses[index],
      side: rowSide(identity),
      identity: identity.identity,
      leftLines: identity.leftLines,
      rightLines: identity.rightLines,
      cells,
    };
  }
}

function numberDelta(field: FieldConfig, difference: FieldComparisonResult): string | null {
  if (!isNumberField(field) || difference.status !== "mismatch") return null;
  const { leftNormalizedValue: a, rightNormalizedValue: b } = difference;
  return a !== null && b !== null && isCanonicalNumber(a) && isCanonicalNumber(b) ? subtractCanonical(a, b) : null;
}

const FILTERS: Record<RowFilter, (status: RowStatus) => boolean> = {
  all: () => true,
  issues: (status) => status !== "match",
  match: (status) => status === "match",
  differs: (status) => status === "differs",
  only_a: (status) => status === "only_a",
  only_b: (status) => status === "only_b",
  warnings: (status) => status === "duplicate" || status === "blank_key",
};

export interface RowQuery {
  filter: RowFilter;
  // Only rows where this field differs (and, optionally, has exactly these raw values).
  field?: string | null;
  pair?: { left: string | null; right: string | null } | null;
  search?: string;
  page: number;
  pageSize: number;
}

export function queryRows(index: ResultIndex, query: RowQuery): ResultRowsPage {
  const field = query.field ? index.contract.fields.find((item) => item.name === query.field) ?? null : null;
  const fields = field ? [field] : query.filter === "match" ? index.contract.fields : index.differingFields();
  const needle = query.search ? casefold(query.search.trim()) : "";
  const start = query.page * query.pageSize;
  const rows: ResultRow[] = [];
  let total = 0;
  const identities = index.result.identityResults;
  for (let position = 0; position < identities.length; position++) {
    if (!FILTERS[query.filter](index.statuses[position])) continue;
    const identity = identities[position];
    if (field) {
      const difference = index.differences(identity).find((item) => item.fieldName === field.name);
      if (!difference) continue;
      if (query.pair && (difference.leftRawValue !== query.pair.left || difference.rightRawValue !== query.pair.right)) continue;
    }
    if (needle && !matchesSearch(identity, index.contract.fields, needle)) continue;
    if (total >= start && rows.length < query.pageSize) rows.push(index.row(position, fields));
    total++;
  }
  return {
    columns: fields.map((item) => ({ name: item.name, left: item.left, right: item.right, numeric: isNumberField(item) })),
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// Searches the key and every compared column, shown or not.
function matchesSearch(identity: IdentityResult, fields: FieldConfig[], needle: string): boolean {
  if (identity.identity !== null && casefold(identity.identity).includes(needle)) return true;
  for (const field of fields) {
    const a = identity.leftRecord?.[field.left];
    const b = identity.rightRecord?.[field.right];
    if ((a && casefold(a).includes(needle)) || (b && casefold(b).includes(needle))) return true;
  }
  return false;
}

// ---------- Fix hints ----------

export interface FixHint {
  field: string;
  mode: ComparisonMode;
  format?: ValueFormat;
  // Differences in this field that the suggested mode would turn into matches.
  fixes: number;
  differences: number;
  example: { a: string; b: string };
}

const HINT_CANDIDATES: Array<{ mode: ComparisonMode; format?: ValueFormat }> = [
  { mode: "Normalized text" },
  { mode: "Number", format: "decimal_point" },
  { mode: "Number", format: "decimal_comma" },
  { mode: "Date", format: "dmy" },
  { mode: "Date", format: "mdy" },
];

export const HINT_SAMPLE = 5000;

// For each field, the mode that would resolve the most of its value
// differences as pure formatting (only for wizard-representable fields).
// Large fields are judged on a sample; the count is then an estimate.
export function fixHints(contract: ReconciliationContract, result: ReconciliationResult): FixHint[] {
  const byField = new Map<string, { total: number; mismatches: FieldComparisonResult[]; mismatchTotal: number }>();
  for (const item of result.discrepancies) {
    let entry = byField.get(item.fieldName);
    if (!entry) byField.set(item.fieldName, entry = { total: 0, mismatches: [], mismatchTotal: 0 });
    entry.total++;
    if (item.status !== "mismatch") continue;
    entry.mismatchTotal++;
    if (entry.mismatches.length < HINT_SAMPLE) entry.mismatches.push(item);
  }
  const hints: FixHint[] = [];
  for (const field of contract.fields) {
    const mode = fieldMode(field);
    const entry = byField.get(field.name);
    if (mode === "Custom" || mode === "Value mapping" || !entry || entry.mismatches.length === 0) continue;
    const currentFormat = fieldFormat(field);
    const { mismatches } = entry;
    let best: FixHint | null = null;
    for (const candidate of HINT_CANDIDATES) {
      if (candidate.mode === mode && candidate.format === currentFormat) continue;
      const chain = modeNormalizers(candidate.mode, candidate.format);
      let fixes = 0;
      let example: { a: string; b: string } | null = null;
      for (const item of mismatches) {
        if (normalize(item.leftRawValue!, chain) === normalize(item.rightRawValue!, chain)) {
          fixes++;
          example ??= { a: item.leftRawValue!, b: item.rightRawValue! };
        }
      }
      // Only suggest a mode that explains at least a fifth of the field's differences.
      if (example && fixes > (best?.fixes ?? 0) && fixes * 5 >= mismatches.length) {
        best = { field: field.name, ...candidate, fixes, differences: entry.total, example };
      }
    }
    if (best) {
      if (entry.mismatchTotal > mismatches.length) best.fixes = Math.round((best.fixes / mismatches.length) * entry.mismatchTotal);
      hints.push(best);
    }
  }
  return hints.sort((a, b) => b.fixes - a.fixes || compareCodePoints(a.field, b.field));
}
