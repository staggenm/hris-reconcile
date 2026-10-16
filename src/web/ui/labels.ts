// Plain-language wording shared by the screen and the readable exports, so
// both always describe a result the same way.

import type { ErrorCode } from "../core/errors";
import type { ComparisonMode, FieldComparisonStatus, IdentityNormalizerName, ValueFormat } from "../core/types";
import type { CellState, RowStatus } from "../analysis/result_rows";

// "How to compare" choices. The value encodes mode and format.
export interface ModeChoice {
  value: string;
  mode: ComparisonMode;
  format?: ValueFormat;
  label: string;
}

export const MODE_CHOICES: ModeChoice[] = [
  { value: "exact", mode: "Exact", label: "Exactly the same" },
  { value: "text", mode: "Normalized text", label: "Ignore capitals and spaces" },
  { value: "number", mode: "Number", format: "decimal_point", label: "As numbers (1,234.56)" },
  { value: "number-comma", mode: "Number", format: "decimal_comma", label: "As numbers (1.234,56)" },
  { value: "date-dmy", mode: "Date", format: "dmy", label: "As dates, day first (31/12/2026)" },
  { value: "date-mdy", mode: "Date", format: "mdy", label: "As dates, month first (12/31/2026)" },
  { value: "mapping", mode: "Value mapping", label: "Translate codes (F = Female)" },
];

export function modeChoice(mode: ComparisonMode, format?: ValueFormat): ModeChoice {
  return MODE_CHOICES.find((choice) => choice.mode === mode && (choice.format === undefined || choice.format === (format ?? defaultFormat(mode))))
    ?? MODE_CHOICES[0];
}

function defaultFormat(mode: ComparisonMode): ValueFormat | undefined {
  return mode === "Number" ? "decimal_point" : mode === "Date" ? "dmy" : undefined;
}

// Short verb phrase for messages: "Compare as numbers".
export function modeAction(mode: ComparisonMode): string {
  switch (mode) {
    case "Normalized text": return "Ignore capitals and spaces";
    case "Number": return "Compare as numbers";
    case "Date": return "Compare as dates";
    case "Value mapping": return "Translate codes";
    default: return "Compare exactly";
  }
}

export const IDENTITY_OPTION_LABELS: Record<IdentityNormalizerName, string> = {
  trim: "Ignore spaces around keys",
  strip_leading_zeros: "Ignore leading zeros (00123 = 123)",
  casefold: "Ignore capitals (ab12 = AB12)",
};

export const ROW_STATUS: Record<RowStatus, { icon: string; label: string }> = {
  match: { icon: "✓", label: "Match" },
  differs: { icon: "≠", label: "Differs" },
  only_a: { icon: "A", label: "Only in A" },
  only_b: { icon: "B", label: "Only in B" },
  duplicate: { icon: "!", label: "Duplicate key" },
  blank_key: { icon: "!", label: "Blank key" },
};

export const CELL_STATE: Record<CellState, string> = {
  same: "Same",
  differs: "Different",
  a_empty: "Empty in A",
  b_empty: "Empty in B",
  absent: "",
};

export const FIELD_STATUS_WORDS: Record<FieldComparisonStatus, string> = {
  match_exact: "Same",
  match_normalized: "Same (after formatting)",
  match_mapped: "Same (translated)",
  both_null: "Both empty",
  left_null: "Empty in A",
  right_null: "Empty in B",
  unmapped_left: "No translation for the A value",
  unmapped_right: "No translation for the B value",
  mismatch: "Different",
};

// Counts with thousands separators, in one fixed format everywhere.
export function count(value: number): string {
  return value.toLocaleString("en-US");
}

export function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count(value)} ${value === 1 ? singular : pluralForm}`;
}

export function percent(part: number, whole: number): string {
  if (whole === 0) return "0%";
  const value = (part / whole) * 100;
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)}%`;
}

// What happened and what to do next, per error code. The technical message is
// shown below this as the detail.
export const FRIENDLY_ERRORS: Partial<Record<ErrorCode, string>> = {
  FILE_TYPE: "This isn't a CSV file. In Excel, use File › Save As › CSV, then load that file.",
  CSV_EMPTY: "This file has no data rows. Check that you exported the right sheet.",
  CSV_ENCODING: "Some characters in this file can't be read. Try another text encoding under “File options”.",
  CSV_HEADER: "The first row of the file should hold the column names, and one of them is empty.",
  CSV_DUP_HEADER: "Two columns in this file have the same name. Rename one of them and load the file again.",
  CSV_ROW_WIDTH: "A row has a different number of values than the header. This is often a stray separator or quote.",
  CSV_PARSE: "The file's structure couldn't be read as CSV.",
  LIMIT_FILE_SIZE: "This file is too large to compare in the browser.",
  LIMIT_ROWS: "This file has too many rows to compare in the browser.",
  LIMIT_COLUMNS: "This file has too many columns. Remove columns you don't need and try again.",
  LIMIT_CELLS: "This file is too large to compare in the browser. Remove columns you don't need and try again.",
  LIMIT_COMPARISONS: "Too many values to compare at once. Compare fewer columns.",
  LIMIT_DISCREPANCIES: "Almost everything differs. The key columns are probably wrong; check “Match rows on”.",
  CONTRACT_INVALID: "The match settings aren't complete yet.",
  COLUMNS_MISSING: "The saved settings expect columns these files don't have.",
  MAPPING_CONFLICT: "Two translations disagree about the same value. Untick one of them.",
  MAPPING_AMBIGUOUS: "Two translations disagree about the same value. Untick one of them.",
  MAPPING_INCOMPLETE: "A translation is missing a value. Fill in both sides or untick it.",
  WORKER_CRASHED: "The browser ran out of memory and the session was reset. Try smaller files or fewer columns.",
};
