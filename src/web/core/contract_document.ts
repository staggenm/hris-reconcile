import type { MappingEditorRow } from "../ui/mapping_editor";
import { NORMALIZED_TEXT_CHAIN } from "./contract_builder";
import { AppError } from "./errors";
import { validateIdentityNormalizers } from "./identity";
import { validateMapping } from "./mapping";
import { NORMALIZERS } from "./normalization";
import {
  ComparisonMode,
  FieldConfig,
  IdentityNormalizerName,
  MappingConfig,
  NormalizerName,
  ReconciliationContract,
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
  }>;
  value_mappings: Record<string, MappingConfig>;
}

// The wizard mode a field corresponds to; "Custom" if the wizard cannot express it.
export function fieldMode(field: FieldConfig): FieldMode {
  const chain = field.normalize.join(",");
  if (field.valueMapping) return chain === "" ? "Value mapping" : "Custom";
  if (chain === "") return "Exact";
  return chain === NORMALIZED_TEXT_CHAIN.join(",") ? "Normalized text" : "Custom";
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
    })),
    value_mappings: contract.valueMappings,
  };
}

const invalid = (message: string) => new AppError("CONTRACT_INVALID", message);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function parseMappings(value: unknown): Record<string, MappingConfig> {
  if (!isObject(value)) throw invalid("contract document: 'value_mappings' must be an object");
  const mappings = Object.create(null) as Record<string, MappingConfig>;
  for (const [name, entries] of Object.entries(value)) {
    if (!isObject(entries)) throw invalid(`contract document: value mapping '${name}' must be an object`);
    const mapping = Object.create(null) as MappingConfig;
    for (const [canonical, sides] of Object.entries(entries)) {
      if (!isObject(sides) || !isStringArray(sides.left) || !isStringArray(sides.right) || !sides.left.length || !sides.right.length) {
        throw invalid(`contract document: value mapping '${name}' entry '${canonical}' needs non-empty 'left' and 'right' string lists`);
      }
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
  validateIdentityNormalizers(identityNormalize);
  if (typeof input.name !== "string" || !isObject(input.left) || typeof input.left.name !== "string"
    || !isObject(input.right) || typeof input.right.name !== "string") {
    throw invalid("contract document: 'name', 'left.name' and 'right.name' are required");
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) throw invalid("contract document: 'fields' must be a non-empty list");
  const valueMappings = parseMappings(input.value_mappings ?? {});

  const fields: FieldConfig[] = input.fields.map((raw, index) => {
    if (!isObject(raw) || typeof raw.name !== "string" || typeof raw.left !== "string" || typeof raw.right !== "string") {
      throw invalid(`contract document: field ${index + 1} needs string 'name', 'left' and 'right'`);
    }
    const normalize = raw.normalize ?? [];
    if (!isStringArray(normalize)) throw invalid(`contract document: field '${raw.name}' 'normalize' must be a list of names`);
    for (const name of normalize) NORMALIZERS.resolve(name);
    const valueMapping = raw.value_mapping ?? null;
    if (valueMapping !== null && typeof valueMapping !== "string") throw invalid(`contract document: field '${raw.name}' 'value_mapping' must be a name or null`);
    const field: FieldConfig = { name: raw.name, left: raw.left, right: raw.right, normalize: normalize as NormalizerName[], valueMapping };
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
  fields: Array<{ left_column: string; right_column: string; mode: ComparisonMode }>;
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
    return { left_column: field.left, right_column: field.right, mode };
  });
  return {
    identity: { left_column: contract.identity.left, right_column: contract.identity.right, normalize: [...(contract.identity.normalize ?? [])] },
    fields,
    mappingRows,
  };
}
