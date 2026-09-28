import { AppError } from "./errors";

export interface Limits {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxComparisons: number;
}

// PROVISIONAL defaults, pending confirmation from `npm run bench`.
const PROVISIONAL_LIMITS: Limits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxRows: 200_000,
  maxColumns: 200,
  maxComparisons: 5_000_000,
};

// Benchmark builds measure beyond the limits to find where they should be.
const UNLIMITED: Limits = {
  maxFileBytes: Infinity,
  maxRows: Infinity,
  maxColumns: Infinity,
  maxComparisons: Infinity,
};

export const DEFAULT_LIMITS: Limits = __HRIS_BENCH__ ? UNLIMITED : PROVISIONAL_LIMITS;

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
