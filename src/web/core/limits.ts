import { AppError } from "./errors";

export interface Limits {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxComparisons: number;
  maxDiscrepancies: number;
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
const BENCHMARKED_LIMITS: Limits = {
  maxFileBytes: 100 * 1024 * 1024,
  maxRows: 200_000,
  maxColumns: 200,
  maxCells: 8_000_000,
  maxComparisons: 6_000_000,
  maxDiscrepancies: 1_500_000,
};

// Benchmark builds measure beyond the limits.
const UNLIMITED: Limits = {
  maxFileBytes: Infinity,
  maxRows: Infinity,
  maxColumns: Infinity,
  maxCells: Infinity,
  maxComparisons: Infinity,
  maxDiscrepancies: Infinity,
};

export const DEFAULT_LIMITS: Limits = __HRIS_BENCH__ ? UNLIMITED : BENCHMARKED_LIMITS;

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
