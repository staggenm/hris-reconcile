import { AppError, ErrorCode } from "../core/errors";
import { checkCells, checkColumns, checkRows, DEFAULT_LIMITS, Limits } from "../core/limits";
import Papa from "papaparse";
import { compareCodePoints } from "../core/compare";
import { Dataset, RecordRow } from "../core/types";

export class CsvParseError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "CsvParseError";
  }
}

function rawCsvRecords(text: string): string[] {
  const records: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && (text[i] === "\n" || text[i] === "\r")) {
      records.push(text.slice(start, i));
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  if (start < text.length) records.push(text.slice(start));
  return records;
}

function countUnquoted(record: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < record.length; i++) {
    if (record[i] === '"') {
      if (quoted && record[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && record[i] === delimiter) count++;
  }
  return count;
}

function detectDelimiter(text: string): string {
  const records = rawCsvRecords(text.slice(0, 8192)).filter((record) => record !== "");
  let best = { delimiter: ",", consistentRows: 0, columns: 0 };
  for (const delimiter of [",", ";", "\t", "|"]) {
    const counts = records.map((record) => countUnquoted(record, delimiter));
    const columns = counts[0] ?? 0;
    if (columns === 0) continue;
    const consistentRows = counts.filter((count) => count === columns).length;
    if (consistentRows > best.consistentRows || (consistentRows === best.consistentRows && columns > best.columns)) {
      best = { delimiter, consistentRows, columns };
    }
  }
  return best.delimiter;
}

export type CsvEncoding = "utf-8" | "windows-1252";
export const CSV_ENCODINGS: readonly CsvEncoding[] = ["utf-8", "windows-1252"];

export interface ParseOptions {
  limits?: Limits;
  encoding?: CsvEncoding;
}

export function parseCsvContent(
  content: ArrayBuffer | Uint8Array | string,
  name: string,
  options: ParseOptions = {},
): Dataset {
  const limits = options.limits ?? DEFAULT_LIMITS;
  let text: string;

  if (typeof content === "string") {
    text = content;
  } else {
    if (content.byteLength === 0) {
      throw new CsvParseError("CSV_EMPTY", "CSV dataset is empty");
    }
    const encoding = options.encoding ?? "utf-8";
    if (encoding === "windows-1252") {
      // Every byte has a Windows-1252 mapping, so this decode cannot fail.
      text = new TextDecoder("windows-1252").decode(content);
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        throw new CsvParseError(
          "CSV_ENCODING",
          "CSV must use UTF-8 encoding. The file may be Windows-1252 (common for Excel exports): choose Windows-1252 as the encoding and upload it again.",
        );
      }
    }
  }

  // Remove potential UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  if (!text.trim()) {
    throw new CsvParseError("CSV_EMPTY", "CSV dataset is empty");
  }

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter: detectDelimiter(text),
  });

  if (parsed.errors && parsed.errors.length > 0) {
    const criticalError = parsed.errors.find(
      (err) => err.code !== "UndetectableDelimiter",
    );
    if (criticalError) {
      throw new CsvParseError("CSV_PARSE", `CSV could not be parsed: ${criticalError.message}`);
    }
  }

  const rows = parsed.data;
  const rawRecords = rawCsvRecords(text);
  if (!rows || rows.length === 0) {
    throw new CsvParseError("CSV_EMPTY", "CSV dataset is empty");
  }

  const rawHeader = rows[0];
  if (!rawHeader || rawHeader.length === 0 || rawRecords[0] === "") {
    throw new CsvParseError("CSV_HEADER", "CSV header is missing");
  }

  const header = rawHeader;

  if (header.some((col) => col === "")) {
    throw new CsvParseError("CSV_HEADER", "CSV header contains an empty column name");
  }

  // Check duplicate column names
  const seenHeaders = new Set<string>();
  const duplicateHeaders = new Set<string>();
  for (const col of header) {
    if (seenHeaders.has(col)) {
      duplicateHeaders.add(col);
    }
    seenHeaders.add(col);
  }
  if (duplicateHeaders.size > 0) {
    const sortedDups = Array.from(duplicateHeaders).sort(compareCodePoints);
    throw new CsvParseError(
      "CSV_DUP_HEADER",
      `CSV contains duplicate column names: ${sortedDups.join(", ")}`,
    );
  }

  checkColumns(name, header.length, limits);

  const records: RecordRow[] = [];
  const expectedCols = header.length;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (i >= rawRecords.length) continue; // PapaParse's trailing-newline placeholder.
    // Check if row is empty
    // PapaParse represents a truly blank unquoted record as [], while a quoted
    // empty field is [""]. Preserve the latter as a real null-valued row.
    if (rawRecords[i] === "") {
      continue;
    }
    if (row.length !== expectedCols) {
      throw new CsvParseError(
        "CSV_ROW_WIDTH",
        `CSV row ${i + 1} has ${row.length} values; expected ${expectedCols}`,
      );
    }
    const record = Object.create(null) as RecordRow;
    for (let c = 0; c < expectedCols; c++) {
      const val = row[c];
      record[header[c]] = val === "" || val === undefined ? null : val;
    }
    records.push(record);
  }

  if (records.length === 0) {
    throw new CsvParseError("CSV_EMPTY", "CSV dataset is empty; at least one data row is required");
  }

  checkRows(name, records.length, limits);
  checkCells(name, records.length, header.length, limits);

  return {
    name,
    columns: header,
    records,
  };
}
