import { AppError } from "./errors";

export interface Limits {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxComparisons: number;
  maxDiscrepancies: number;
  maxExportBytes: number;
}

// Limits benchmarked with `npm run bench` (Phase 3, 2026-09-28; Apple M5,
// Chromium 153; synthetic employee_id + 30 fields):
// - 200k rows × 30 fields (78 MB per file, 6M comparisons): every step ≤ 7 s;
//   worker heap retained 618 MB, peak 1.17 GB at 5% differences.
// - Worst case, every comparison different: retained 924 MB, peak 2.5 GB.
// Memory grows with cells (about 50 bytes per cell), so cells per file are
// capped (8M ≈ 200k × 40) as well as columns. Stored discrepancies are capped
// at 1.5M (about 5.5× the 5% case at 200k rows): beyond that, the result is
// almost always a wrong identity field or mapping, not a data finding.
// Exports are capped at 1 GiB of text: the largest export at 5% differences
// (raw results CSV, 200k × 30) is about 1 GB, and beyond that browsers may
// page Blobs to disk or fail the download. No spreadsheet opens a file that
// large anyway (Excel stops at 1,048,576 rows).
const BENCHMARKED_LIMITS: Limits = {
  maxFileBytes: 100 * 1024 * 1024,
  maxRows: 200_000,
  maxColumns: 200,
  maxCells: 8_000_000,
  maxComparisons: 6_000_000,
  maxDiscrepancies: 1_500_000,
  maxExportBytes: 1024 * 1024 * 1024,
};

export const DEFAULT_LIMITS: Limits = BENCHMARKED_LIMITS;

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// Pre-flight: runs before a file is read.
export function checkFileSize(name: string, bytes: number, limits: Limits = DEFAULT_LIMITS): void {
  if (bytes > limits.maxFileBytes) {
    throw new AppError("LIMIT_FILE_SIZE", `file '${name}' is ${megabytes(bytes)}; the limit is ${megabytes(limits.maxFileBytes)}`);
  }
}

export function checkColumns(name: string, columns: number, limits: Limits = DEFAULT_LIMITS): void {
  if (columns > limits.maxColumns) {
    throw new AppError("LIMIT_COLUMNS", `dataset '${name}' has ${columns} columns; the limit is ${limits.maxColumns}`);
  }
}

export function checkRows(name: string, rows: number, limits: Limits = DEFAULT_LIMITS): void {
  if (rows > limits.maxRows) {
    throw new AppError("LIMIT_ROWS", `dataset '${name}' has ${rows} rows; the limit is ${limits.maxRows}`);
  }
}

export function checkCells(name: string, rows: number, columns: number, limits: Limits = DEFAULT_LIMITS): void {
  if (rows * columns > limits.maxCells) {
    throw new AppError("LIMIT_CELLS", `dataset '${name}' has ${rows * columns} cells (${rows} rows × ${columns} columns); the limit is ${limits.maxCells}`);
  }
}

export const TOO_MANY_DIFFERENCES =
  "Too many differences. This usually means the identity field or value mappings are wrong. Check the configuration before rerunning.";

// Checked while reconciling, so a misconfigured run stops early.
export function checkDiscrepancies(stored: number, limits: Limits = DEFAULT_LIMITS): void {
  if (stored > limits.maxDiscrepancies) throw new AppError("LIMIT_DISCREPANCIES", TOO_MANY_DIFFERENCES);
}

export function estimateComparisons(leftRows: number, rightRows: number, fields: number): number {
  return Math.min(leftRows, rightRows) * fields;
}

// Pre-flight: runs before reconciling.
export function checkComparisons(leftRows: number, rightRows: number, fields: number, limits: Limits = DEFAULT_LIMITS): void {
  const estimate = estimateComparisons(leftRows, rightRows, fields);
  if (estimate > limits.maxComparisons) {
    throw new AppError(
      "LIMIT_COMPARISONS",
      `this run needs about ${estimate} field comparisons (${Math.min(leftRows, rightRows)} rows × ${fields} fields); the limit is ${limits.maxComparisons}`,
    );
  }
}

// Checked while an export is assembled, so an oversized export stops early.
// `chars` counts UTF-16 code units, which is close to the UTF-8 size for the
// mostly-ASCII text of an HR export.
export function checkExportSize(chars: number, limits: Limits = DEFAULT_LIMITS): void {
  if (chars > limits.maxExportBytes) {
    throw new AppError("LIMIT_EXPORT_SIZE", `the export is larger than ${megabytes(limits.maxExportBytes)}, the limit for an export`);
  }
}

// Saved settings files are small: the app writes a few KB, and a large value
// mapping a few hundred KB. These caps stop a wrong or malicious file from
// exhausting memory while it is read, validated and shown in the editor.
export const CONTRACT_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  // One field per compared column, so the column limit applies.
  maxFields: BENCHMARKED_LIMITS.maxColumns,
  maxValueMappings: BENCHMARKED_LIMITS.maxColumns,
  // Values per side for one canonical value, and in all mappings together.
  maxAliasesPerValue: 1_000,
  maxAliases: 100_000,
  // The editor shows one row per (left, right) pair of a canonical value.
  maxEditorRows: 100_000,
  // Normalizers per field or identity.
  maxNormalizers: 20,
  // Any name, column name, canonical value or alias.
  maxStringLength: 1_000,
} as const;

// Pre-flight: runs before a settings file is read.
export function checkContractFileSize(name: string, bytes: number): void {
  if (bytes > CONTRACT_LIMITS.maxFileBytes) {
    throw new AppError("LIMIT_CONTRACT", `settings file '${name}' is ${megabytes(bytes)}; the limit is ${megabytes(CONTRACT_LIMITS.maxFileBytes)}`);
  }
}
