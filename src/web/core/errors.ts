// The error-code catalogue. Codes are stable identifiers shown in the UI and
// carried across the worker boundary; messages may change, codes may not.
export const ERROR_CATALOGUE = {
  CSV_EMPTY: "The CSV file has no header or no data rows.",
  CSV_ENCODING: "The file is not valid text in the selected encoding.",
  CSV_HEADER: "The CSV header is missing or contains an empty column name.",
  CSV_DUP_HEADER: "The CSV header repeats a column name.",
  CSV_ROW_WIDTH: "A CSV row has a different number of values than the header.",
  CSV_PARSE: "The CSV structure could not be parsed.",
  LIMIT_FILE_SIZE: "The file is larger than the configured size limit.",
  LIMIT_ROWS: "The dataset has more rows than the configured limit.",
  LIMIT_COLUMNS: "The dataset has more columns than the configured limit.",
  LIMIT_COMPARISONS: "The run would perform more field comparisons than the configured limit.",
  CONTRACT_INVALID: "The wizard configuration is incomplete or inconsistent.",
  COLUMNS_MISSING: "A dataset lacks a column the contract requires.",
  NORMALIZER_UNKNOWN: "A contract names a normalizer that does not exist.",
  IDENTITY_NORMALIZER_UNSUPPORTED: "An identity normalizer is not one of trim, strip_leading_zeros, casefold.",
  IDENTITY_COLUMN_UNKNOWN: "The selected identity column does not exist in the dataset.",
  MAPPING_CONFLICT: "Two accepted mapping rows give one value different canonical values.",
  MAPPING_AMBIGUOUS: "A value mapping resolves one alias to different canonical values.",
  MAPPING_INCOMPLETE: "An accepted value mapping lacks a canonical value or a value on one side.",
  MAPPING_NOT_FOUND: "A field refers to a value mapping the contract does not define.",
  SESSION_STATE: "The request does not match the current session (upload, run, or results changed).",
  WORKER_CRASHED: "The processing worker stopped, most likely because it ran out of memory.",
  WORKER_PROTOCOL: "The processing worker received a request it does not understand.",
  INTERNAL: "An internal consistency check failed.",
  UNKNOWN: "An unexpected error without a code.",
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CATALOGUE, value);
}

export function errorCodeOf(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : "UNKNOWN";
}

export interface SerializedError {
  message: string;
  code: string;
}

export function serializeError(error: unknown): SerializedError {
  return { message: error instanceof Error ? error.message : String(error), code: errorCodeOf(error) };
}

export function deserializeError(error: SerializedError): AppError {
  return new AppError(isErrorCode(error.code) ? error.code : "UNKNOWN", error.message);
}
