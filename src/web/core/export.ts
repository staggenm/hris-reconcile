import {
  ReconciliationContract,
  ReconciliationResult,
} from "./types";
import { isDiscrepancy } from "../analysis/results_analysis";

const CSV_COLUMNS = [
  "record_type",
  "identity",
  "field_name",
  "left_raw_value",
  "right_raw_value",
  "left_normalized_value",
  "right_normalized_value",
  "left_canonical_value",
  "right_canonical_value",
  "mapping_name",
  "comparison_status",
  "identity_status",
] as const;

const IDENTITY_PUBLIC: Record<ReconciliationResult["identityResults"][number]["status"], string> = {
  matched: "MATCHED",
  missing_left: "MISSING_LEFT",
  missing_right: "MISSING_RIGHT",
  duplicate_left: "DUPLICATE_LEFT",
  duplicate_right: "DUPLICATE_RIGHT",
  missing_identity_left: "MISSING_IDENTITY_LEFT",
  missing_identity_right: "MISSING_IDENTITY_RIGHT",
};
const FIELD_PUBLIC: Record<ReconciliationResult["fieldResults"][number]["status"], string> = {
  match_exact: "MATCH_EXACT",
  match_normalized: "MATCH_NORMALIZED",
  match_mapped: "MATCH_MAPPED",
  mismatch: "MISMATCH",
  left_null: "LEFT_NULL",
  right_null: "RIGHT_NULL",
  both_null: "BOTH_NULL",
  unmapped_left: "UNMAPPED_LEFT",
  unmapped_right: "UNMAPPED_RIGHT",
};

// Spreadsheet formula triggers (ASCII and full-width) at the start of a cell.
const FORMULA_TRIGGER = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

// Neutralizes CSV formula injection by prefixing an apostrophe, which
// spreadsheets treat as "text". Plain numbers such as -12 stay numeric.
export function excelSafeCell(value: string): string {
  return FORMULA_TRIGGER.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
}

function escapeCsvCell(value: string | null | undefined, excelSafe = false): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = excelSafe ? excelSafeCell(String(value)) : String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateReconciliationCsv(
  result: ReconciliationResult,
  options: { mismatchesOnly?: boolean; excelSafe?: boolean } = {},
): string {
  const mismatchesOnly = options.mismatchesOnly ?? false;
  const excelSafe = options.excelSafe ?? true;
  const cell = (value: string | null | undefined) => escapeCsvCell(value, excelSafe);
  const lines: string[] = [];

  // Header line
  lines.push(CSV_COLUMNS.join(","));

  for (const identity of result.identityResults) {
    if (mismatchesOnly && identity.status === "matched") {
      continue;
    }
    const row = [
      "identity",
      cell(identity.identity),
      "", // field_name
      "", // left_raw_value
      "", // right_raw_value
      "", // left_normalized_value
      "", // right_normalized_value
      "", // left_canonical_value
      "", // right_canonical_value
      "", // mapping_name
      "", // comparison_status
      cell(IDENTITY_PUBLIC[identity.status]),
    ];
    lines.push(row.join(","));
  }

  for (const field of result.fieldResults) {
    if (mismatchesOnly && !isDiscrepancy(field)) {
      continue;
    }
    const row = [
      "field_comparison",
      cell(field.identity),
      cell(field.fieldName),
      cell(field.leftRawValue),
      cell(field.rightRawValue),
      cell(field.leftNormalizedValue),
      cell(field.rightNormalizedValue),
      cell(field.leftCanonicalValue),
      cell(field.rightCanonicalValue),
      cell(field.mappingName),
      cell(FIELD_PUBLIC[field.status]),
      "", // identity_status
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n") + "\n";
}

export interface JsonReport {
  run_metadata: {
    format_version: string;
    engine_version: string;
    processing_mode: string;
  };
  contract_name: string;
  datasets: {
    left: { name: string; record_count: number; column_count: number };
    right: { name: string; record_count: number; column_count: number };
  };
  identity_summary: Record<string, number>;
  field_comparison_summary: Record<string, number>;
  details: {
    identities: Array<{ identity: string | null; status: string }>;
    field_comparisons: Array<{
      identity: string;
      field_name: string;
      left_raw_value: string | null;
      right_raw_value: string | null;
      left_normalized_value: string | null;
      right_normalized_value: string | null;
      left_canonical_value: string | null;
      right_canonical_value: string | null;
      status: string;
      mapping_name: string | null;
    }>;
  };
}

export function generateReconciliationJson(
  contract: ReconciliationContract,
  result: ReconciliationResult,
): string {
  const identitySummary: Record<string, number> = {
    MATCHED: 0,
    MISSING_LEFT: 0,
    MISSING_RIGHT: 0,
    DUPLICATE_LEFT: 0,
    DUPLICATE_RIGHT: 0,
    MISSING_IDENTITY_LEFT: 0,
    MISSING_IDENTITY_RIGHT: 0,
  };
  for (const id of result.identityResults) {
    identitySummary[IDENTITY_PUBLIC[id.status]]++;
  }

  const fieldComparisonSummary: Record<string, number> = {
    MATCH_EXACT: 0,
    MATCH_NORMALIZED: 0,
    MATCH_MAPPED: 0,
    BOTH_NULL: 0,
    LEFT_NULL: 0,
    RIGHT_NULL: 0,
    UNMAPPED_LEFT: 0,
    UNMAPPED_RIGHT: 0,
    MISMATCH: 0,
  };
  for (const f of result.fieldResults) {
    fieldComparisonSummary[FIELD_PUBLIC[f.status]]++;
  }

  const report: JsonReport = {
    run_metadata: {
      format_version: "1.0",
      engine_version: "0.3.0",
      processing_mode: "browser",
    },
    contract_name: contract.name,
    datasets: {
      left: {
        name: result.leftDataset.name,
        record_count: result.leftDataset.recordCount,
        column_count: result.leftDataset.columnCount,
      },
      right: {
        name: result.rightDataset.name,
        record_count: result.rightDataset.recordCount,
        column_count: result.rightDataset.columnCount,
      },
    },
    identity_summary: identitySummary,
    field_comparison_summary: fieldComparisonSummary,
    details: {
      identities: result.identityResults.map((id) => ({
        identity: id.identity,
        status: IDENTITY_PUBLIC[id.status],
      })),
      field_comparisons: result.fieldResults.map((f) => ({
        identity: f.identity,
        field_name: f.fieldName,
        left_raw_value: f.leftRawValue,
        right_raw_value: f.rightRawValue,
        left_normalized_value: f.leftNormalizedValue,
        right_normalized_value: f.rightNormalizedValue,
        left_canonical_value: f.leftCanonicalValue,
        right_canonical_value: f.rightCanonicalValue,
        status: FIELD_PUBLIC[f.status],
        mapping_name: f.mappingName ?? null,
      })),
    },
  };

  return JSON.stringify(report, null, 2) + "\n";
}
