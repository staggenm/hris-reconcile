import {
  FieldComparisonResult,
  FieldComparisonStatus,
  ReconciliationContract,
  ReconciliationResult,
} from "./types";
import type { CsvEncoding } from "../analysis/csv";
import { contractSha256, serializeContract } from "./contract_document";
import { DEFAULT_LIMITS, Limits } from "./limits";
import { FIELD_STATUSES, IDENTITY_PUBLIC } from "./status";
import { APP_VERSION } from "./version";

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
  "left_source_rows",
  "right_source_rows",
] as const;

const FIELD_PUBLIC: Record<FieldComparisonStatus, string> = {
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

// Exports are produced as text chunks of about CHUNK_CHARS characters and
// assembled into a Blob, so no report-sized string is ever built.
export const CHUNK_CHARS = 64 * 1024;

function* batched(pieces: Iterable<string>): Generator<string> {
  let buffer: string[] = [];
  let size = 0;
  for (const piece of pieces) {
    buffer.push(piece);
    size += piece.length;
    if (size >= CHUNK_CHARS) {
      yield buffer.join("");
      buffer = [];
      size = 0;
    }
  }
  if (size > 0) yield buffer.join("");
}

// Chunks are folded into the Blob every BLOB_FOLD_CHARS characters, which
// hands the text to the browser's Blob storage, so the worker's JS heap never
// holds the whole export.
export const BLOB_FOLD_CHARS = 8 * 1024 * 1024;

export function exportBlob(chunks: Iterable<string>, type: string): Blob {
  let blob = new Blob([], { type });
  let pending: string[] = [];
  let size = 0;
  for (const chunk of chunks) {
    pending.push(chunk);
    size += chunk.length;
    if (size >= BLOB_FOLD_CHARS) {
      blob = new Blob([blob, ...pending], { type });
      pending = [];
      size = 0;
    }
  }
  return pending.length > 0 ? new Blob([blob, ...pending], { type }) : blob;
}

function* csvLines(
  result: ReconciliationResult,
  mismatchesOnly: boolean,
  excelSafe: boolean,
): Generator<string> {
  const cell = (value: string | null | undefined) => escapeCsvCell(value, excelSafe);
  yield `${CSV_COLUMNS.join(",")}\n`;

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
      identity.leftLines.join(";"),
      identity.rightLines.join(";"),
    ];
    yield `${row.join(",")}\n`;
  }

  for (const field of mismatchesOnly ? result.discrepancies : result.fieldResults()) {
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
      String(field.leftLine),
      String(field.rightLine),
    ];
    yield `${row.join(",")}\n`;
  }
}

export function csvChunks(
  result: ReconciliationResult,
  options: { mismatchesOnly?: boolean; excelSafe?: boolean } = {},
): Generator<string> {
  return batched(csvLines(result, options.mismatchesOnly ?? false, options.excelSafe ?? true));
}

export const REPORT_FORMAT_VERSION = "2.0";

export interface SourceInfo {
  fileName: string;
  encoding: CsvEncoding;
  // SHA-256 of the raw file bytes, computed before decoding.
  sha256: string;
  byteLength: number;
}

export interface ReportMetadata {
  appVersion: string;
  generatedAt: string;
  excelSafe: boolean;
  limits: Limits;
  sources: { left: SourceInfo; right: SourceInfo };
}

export function buildReportMetadata(options: {
  sources: { left: SourceInfo; right: SourceInfo };
  excelSafe: boolean;
  limits?: Limits;
  now?: Date;
}): ReportMetadata {
  return {
    appVersion: APP_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    excelSafe: options.excelSafe,
    limits: options.limits ?? DEFAULT_LIMITS,
    sources: options.sources,
  };
}

export const DETAIL_SCOPE = {
  kind: "discrepancies_and_identity_issues",
  description:
    "details.identities lists identity issues only (every status except MATCHED); details.field_comparisons lists discrepancies only " +
    "(MISMATCH, LEFT_NULL, RIGHT_NULL, UNMAPPED_LEFT, UNMAPPED_RIGHT). Matches are counted in identity_summary and " +
    "field_comparison_summary. full.csv contains every identity and every comparison.",
} as const;

// A JSON array whose items are produced on demand while writing.
class LazyArray {
  constructor(readonly items: () => Iterable<unknown>) {}
}

// Streams `value` exactly as JSON.stringify(value, null, 2) would print it.
// Arrays (and LazyArrays) are written item by item; each item is small and is
// stringified whole, then re-indented to its depth.
function* prettyJson(value: unknown, indent: string): Generator<string> {
  const inner = `${indent}  `;
  if (value instanceof LazyArray || Array.isArray(value)) {
    const items = value instanceof LazyArray ? value.items() : value;
    let first = true;
    for (const item of items) {
      yield `${first ? "[\n" : ",\n"}${inner}${JSON.stringify(item, null, 2).replace(/\n/g, `\n${inner}`)}`;
      first = false;
    }
    yield first ? "[]" : `\n${indent}]`;
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) {
      yield "{}";
      return;
    }
    yield "{\n";
    for (let index = 0; index < entries.length; index++) {
      const [key, item] = entries[index];
      yield `${inner}${JSON.stringify(key)}: `;
      yield* prettyJson(item, inner);
      yield index < entries.length - 1 ? ",\n" : "\n";
    }
    yield `${indent}}`;
    return;
  }
  yield JSON.stringify(value);
}

function jsonComparison(f: FieldComparisonResult) {
  return {
    identity: f.identity,
    field_name: f.fieldName,
    left_row: f.leftLine,
    right_row: f.rightLine,
    left_raw_value: f.leftRawValue,
    right_raw_value: f.rightRawValue,
    left_normalized_value: f.leftNormalizedValue,
    right_normalized_value: f.rightNormalizedValue,
    left_canonical_value: f.leftCanonicalValue,
    right_canonical_value: f.rightCanonicalValue,
    status: FIELD_PUBLIC[f.status],
    mapping_name: f.mappingName ?? null,
  };
}

export function jsonChunks(
  contract: ReconciliationContract,
  result: ReconciliationResult,
  metadata: ReportMetadata,
): Generator<string> {
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
  for (const counts of result.fieldCounts.values()) {
    for (const status of FIELD_STATUSES) fieldComparisonSummary[FIELD_PUBLIC[status]] += counts[status];
  }

  const source = (side: "left" | "right") => {
    const stats = side === "left" ? result.leftDataset : result.rightDataset;
    const info = metadata.sources[side];
    return {
      name: stats.name,
      file_name: info.fileName,
      encoding: info.encoding,
      sha256: info.sha256,
      byte_length: info.byteLength,
      record_count: stats.recordCount,
      column_count: stats.columnCount,
    };
  };

  const report = {
    report_format_version: REPORT_FORMAT_VERSION,
    run_metadata: {
      app_version: metadata.appVersion,
      generated_at: metadata.generatedAt,
      contract_sha256: contractSha256(contract),
      processing_mode: "browser",
      excel_safe: metadata.excelSafe,
      limits: {
        max_file_bytes: metadata.limits.maxFileBytes,
        max_rows: metadata.limits.maxRows,
        max_columns: metadata.limits.maxColumns,
        max_cells: metadata.limits.maxCells,
        max_comparisons: metadata.limits.maxComparisons,
        max_discrepancies: metadata.limits.maxDiscrepancies,
      },
    },
    sources: { left: source("left"), right: source("right") },
    contract: serializeContract(contract),
    detail_scope: DETAIL_SCOPE,
    identity_summary: identitySummary,
    field_comparison_summary: fieldComparisonSummary,
    details: {
      identities: new LazyArray(function* () {
        for (const id of result.identityResults) {
          if (id.status === "matched") continue;
          yield { identity: id.identity, status: IDENTITY_PUBLIC[id.status], left_rows: id.leftLines, right_rows: id.rightLines };
        }
      }),
      field_comparisons: new LazyArray(function* () {
        for (const f of result.discrepancies) yield jsonComparison(f);
      }),
    },
  };

  return batched((function* () {
    yield* prettyJson(report, "");
    yield "\n";
  })());
}
