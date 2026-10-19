import type { MappingEditorRow } from "../ui/mapping_editor";
import { compareCodePoints } from "./compare";
import { NORMALIZED_TEXT_CHAIN } from "./contract_builder";
import { AppError } from "./errors";
import { validateIdentityNormalizers } from "./identity";
import { CONTRACT_LIMITS } from "./limits";
import { validateMapping } from "./mapping";
import { NORMALIZERS } from "./normalization";
import { sha256HexSync } from "./sha256";
import {
  ComparisonMode,
  FieldConfig,
  IdentityNormalizerName,
  MappingConfig,
  NormalizerName,
  ReconciliationContract,
  ValueFormat,
} from "./types";

// The saved/imported contract format, also embedded in the JSON report.
export const CONTRACT_SCHEMA_VERSION = "1.0";

export type FieldMode = Exclude<ComparisonMode, "Ignore"> | "Custom";

export interface ContractDocument {
  schema_version: string;
  name: string;
  left: { name: string };
  right: { name: string };
  identity: { left: string; right: string; normalize: IdentityNormalizerName[] };
  fields: Array<{
    name: string;
    left: string;
    right: string;
    mode: FieldMode;
    normalize: NormalizerName[];
    value_mapping: string | null;
    tolerance?: number;
  }>;
  value_mappings: Record<string, MappingConfig>;
}

// The wizard mode a field corresponds to; "Custom" if the wizard cannot express it.
const FORMAT_CHAINS: Record<string, { mode: FieldMode; format: ValueFormat }> = {
  number: { mode: "Number", format: "decimal_point" },
  number_decimal_comma: { mode: "Number", format: "decimal_comma" },
  date_dmy: { mode: "Date", format: "dmy" },
  date_mdy: { mode: "Date", format: "mdy" },
};

export function fieldMode(field: FieldConfig): FieldMode {
  const chain = field.normalize.join(",");
  if (field.valueMapping) return chain === "" ? "Value mapping" : "Custom";
  if (chain === "") return "Exact";
  if (Object.prototype.hasOwnProperty.call(FORMAT_CHAINS, chain)) return FORMAT_CHAINS[chain].mode;
  return chain === NORMALIZED_TEXT_CHAIN.join(",") ? "Normalized text" : "Custom";
}

// The Number or Date format a field uses, if any.
export function fieldFormat(field: FieldConfig): ValueFormat | undefined {
  const chain = field.normalize.join(",");
  return Object.prototype.hasOwnProperty.call(FORMAT_CHAINS, chain) && !field.valueMapping ? FORMAT_CHAINS[chain].format : undefined;
}

export function serializeContract(contract: ReconciliationContract): ContractDocument {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    name: contract.name,
    left: { name: contract.left.name },
    right: { name: contract.right.name },
    identity: { left: contract.identity.left, right: contract.identity.right, normalize: [...(contract.identity.normalize ?? [])] },
    fields: contract.fields.map((field) => ({
      name: field.name,
      left: field.left,
      right: field.right,
      mode: fieldMode(field),
      normalize: [...field.normalize],
      value_mapping: field.valueMapping ?? null,
      // Only written when set, so contracts without tolerances hash as before.
      ...(field.tolerance ? { tolerance: field.tolerance } : {}),
    })),
    value_mappings: contract.valueMappings,
  };
}

const invalid = (message: string) => new AppError("CONTRACT_INVALID", message);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const tooLarge = (message: string) => new AppError("LIMIT_CONTRACT", `contract document: ${message}`);
function checkCount(count: number, limit: number, what: string): void {
  if (count > limit) throw tooLarge(`${what} has ${count} entries; the limit is ${limit}`);
}
function checkLength(value: string, what: string): void {
  if (value.length > CONTRACT_LIMITS.maxStringLength) {
    throw tooLarge(`${what} is ${value.length} characters long; the limit is ${CONTRACT_LIMITS.maxStringLength}`);
  }
}

function parseMappings(value: unknown): Record<string, MappingConfig> {
  if (!isObject(value)) throw invalid("contract document: 'value_mappings' must be an object");
  const mappings = Object.create(null) as Record<string, MappingConfig>;
  const names = Object.keys(value);
  checkCount(names.length, CONTRACT_LIMITS.maxValueMappings, "'value_mappings'");
  let aliases = 0;
  let editorRows = 0;
  for (const name of names) {
    const entries = value[name];
    checkLength(name, "a value mapping name");
    if (!isObject(entries)) throw invalid(`contract document: value mapping '${name}' must be an object`);
    const mapping = Object.create(null) as MappingConfig;
    for (const [canonical, sides] of Object.entries(entries)) {
      checkLength(canonical, `a canonical value in '${name}'`);
      if (!isObject(sides) || !isStringArray(sides.left) || !isStringArray(sides.right) || !sides.left.length || !sides.right.length) {
        throw invalid(`contract document: value mapping '${name}' entry '${canonical}' needs non-empty 'left' and 'right' string lists`);
      }
      checkCount(sides.left.length, CONTRACT_LIMITS.maxAliasesPerValue, `value mapping '${name}' entry '${canonical}' (left)`);
      checkCount(sides.right.length, CONTRACT_LIMITS.maxAliasesPerValue, `value mapping '${name}' entry '${canonical}' (right)`);
      aliases += sides.left.length + sides.right.length;
      editorRows += sides.left.length * sides.right.length;
      checkCount(aliases, CONTRACT_LIMITS.maxAliases, "the value mappings together");
      checkCount(editorRows, CONTRACT_LIMITS.maxEditorRows, "the value mappings' translation rows");
      for (const alias of [...sides.left, ...sides.right]) checkLength(alias, `a value in '${name}' entry '${canonical}'`);
      mapping[canonical] = { left: [...sides.left], right: [...sides.right] };
    }
    mappings[name] = mapping;
  }
  return mappings;
}

// Parses and validates an imported contract document (structure only; see
// validateContractColumns for the fit with the uploaded files).
export function parseContractDocument(input: unknown): ReconciliationContract {
  if (!isObject(input)) throw invalid("not a contract document (expected a JSON object with schema_version)");
  if (input.schema_version !== CONTRACT_SCHEMA_VERSION) {
    throw invalid(`schema_version '${String(input.schema_version)}' is not supported (expected '${CONTRACT_SCHEMA_VERSION}')`);
  }
  const identity = input.identity;
  if (!isObject(identity) || typeof identity.left !== "string" || typeof identity.right !== "string") {
    throw invalid("contract document: 'identity' must be an object with 'left' and 'right' column names");
  }
  const identityNormalize = identity.normalize ?? [];
  if (!isStringArray(identityNormalize)) throw invalid("contract document: 'identity.normalize' must be a list of names");
  checkCount(identityNormalize.length, CONTRACT_LIMITS.maxNormalizers, "'identity.normalize'");
  validateIdentityNormalizers(identityNormalize);
  if (typeof input.name !== "string" || !isObject(input.left) || typeof input.left.name !== "string"
    || !isObject(input.right) || typeof input.right.name !== "string") {
    throw invalid("contract document: 'name', 'left.name' and 'right.name' are required");
  }
  for (const [value, what] of [[input.name, "'name'"], [input.left.name, "'left.name'"], [input.right.name, "'right.name'"],
    [identity.left, "'identity.left'"], [identity.right, "'identity.right'"]] as const) checkLength(value, what);
  if (!Array.isArray(input.fields) || input.fields.length === 0) throw invalid("contract document: 'fields' must be a non-empty list");
  checkCount(input.fields.length, CONTRACT_LIMITS.maxFields, "'fields'");
  const valueMappings = parseMappings(input.value_mappings ?? {});

  const fields: FieldConfig[] = input.fields.map((raw, index) => {
    if (!isObject(raw) || typeof raw.name !== "string" || typeof raw.left !== "string" || typeof raw.right !== "string") {
      throw invalid(`contract document: field ${index + 1} needs string 'name', 'left' and 'right'`);
    }
    for (const key of ["name", "left", "right"] as const) checkLength(raw[key] as string, `field ${index + 1} '${key}'`);
    const normalize = raw.normalize ?? [];
    if (!isStringArray(normalize)) throw invalid(`contract document: field '${raw.name}' 'normalize' must be a list of names`);
    checkCount(normalize.length, CONTRACT_LIMITS.maxNormalizers, `field '${raw.name}' 'normalize'`);
    for (const name of normalize) NORMALIZERS.resolve(name);
    const valueMapping = raw.value_mapping ?? null;
    if (valueMapping !== null && typeof valueMapping !== "string") throw invalid(`contract document: field '${raw.name}' 'value_mapping' must be a name or null`);
    const field: FieldConfig = { name: raw.name, left: raw.left, right: raw.right, normalize: normalize as NormalizerName[], valueMapping };
    if (raw.tolerance !== undefined) {
      if (typeof raw.tolerance !== "number" || !Number.isFinite(raw.tolerance) || raw.tolerance <= 0) {
        throw invalid(`contract document: field '${raw.name}' 'tolerance' must be a positive number`);
      }
      if (fieldMode(field) !== "Number") throw invalid(`contract document: field '${raw.name}' has a tolerance but is not a Number field`);
      field.tolerance = raw.tolerance;
    }
    if (valueMapping !== null) {
      const mapping = valueMappings[valueMapping];
      if (!mapping) throw new AppError("MAPPING_NOT_FOUND", `value mapping '${valueMapping}' not found`);
      validateMapping(valueMapping, mapping, field.normalize);
    }
    const derived = fieldMode(field);
    if (raw.mode !== undefined && raw.mode !== derived) {
      throw invalid(`field '${field.name}' declares mode '${String(raw.mode)}' but its normalizers and value mapping make it '${derived}'`);
    }
    return field;
  });

  return {
    name: input.name,
    left: { name: input.left.name },
    right: { name: input.right.name },
    identity: { left: identity.left, right: identity.right, normalize: identityNormalize as IdentityNormalizerName[] },
    fields,
    valueMappings,
  };
}

// Every column the contract needs must exist in the uploaded files.
export function validateContractColumns(contract: ReconciliationContract, leftColumns: string[], rightColumns: string[]): void {
  const missing = (needed: string[], available: string[]) =>
    [...new Set(needed)].filter((column) => !available.includes(column));
  const leftMissing = missing([contract.identity.left, ...contract.fields.map((field) => field.left)], leftColumns);
  const rightMissing = missing([contract.identity.right, ...contract.fields.map((field) => field.right)], rightColumns);
  const quote = (columns: string[]) => columns.map((column) => `'${column}'`).join(", ");
  const parts = [
    leftMissing.length ? `Dataset A is missing ${quote(leftMissing)}` : "",
    rightMissing.length ? `Dataset B is missing ${quote(rightMissing)}` : "",
  ].filter(Boolean);
  if (parts.length) throw new AppError("COLUMNS_MISSING", `the contract does not fit the uploaded files: ${parts.join("; ")}`);
}

export interface WizardState {
  identity: { left_column: string; right_column: string; normalize: IdentityNormalizerName[] };
  fields: Array<{ left_column: string; right_column: string; mode: ComparisonMode; format?: ValueFormat; tolerance?: number }>;
  // Accepted editor rows per value-mapping field (keyed by left column).
  mappingRows: Map<string, MappingEditorRow[]>;
}

export function wizardStateFromContract(contract: ReconciliationContract): WizardState {
  const mappingRows = new Map<string, MappingEditorRow[]>();
  const fields = contract.fields.map((field) => {
    const mode = fieldMode(field);
    if (mode === "Custom") {
      throw invalid(`field '${field.name}' uses normalizers ${field.normalize.join(", ")}, which the wizard cannot represent`);
    }
    if (mode === "Value mapping") {
      const rows: MappingEditorRow[] = [];
      for (const [canonical, sides] of Object.entries(contract.valueMappings[field.valueMapping!])) {
        for (const left of sides.left) {
          for (const right of sides.right) {
            rows.push({ left, right, canonical, accepted: true, count: 0, consistency_percentage: 0, assessment: "Imported" });
          }
        }
      }
      mappingRows.set(field.left, rows);
    }
    const format = fieldFormat(field);
    return {
      left_column: field.left, right_column: field.right, mode,
      ...(format ? { format } : {}),
      ...(field.tolerance ? { tolerance: field.tolerance } : {}),
    };
  });
  return {
    identity: { left_column: contract.identity.left, right_column: contract.identity.right, normalize: [...(contract.identity.normalize ?? [])] },
    fields,
    mappingRows,
  };
}

// Canonical JSON: object keys sorted by code point, arrays in order, no
// whitespace. Equal contracts always produce the same text, and so the same hash.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalContractJson(contract: ReconciliationContract): string {
  return canonicalJson(serializeContract(contract));
}

// SHA-256 of the canonical contract document, recorded in the report.
export function contractSha256(contract: ReconciliationContract): string {
  return sha256HexSync(new TextEncoder().encode(canonicalContractJson(contract)));
}
