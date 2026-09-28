import {
  ComparisonMode,
  FieldConfig,
  IDENTITY_NORMALIZERS,
  IdentityNormalizerName,
  MappingConfig,
  NormalizerName,
  ReconciliationContract,
} from "./types";
import { casefold } from "./normalization";
import { validateMapping } from "./mapping";

export class WizardConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WizardConfigurationError";
  }
}

export interface ValueMappingSelection {
  canonical_value: string;
  left_values: string[];
  right_values: string[];
}

export interface FieldSelection {
  left_column: string;
  right_column: string;
  mode: ComparisonMode;
  value_mappings?: ValueMappingSelection[];
}

export interface WizardConfiguration {
  contract_name: string;
  left_name: string;
  right_name: string;
  left_identity: string;
  right_identity: string;
  identity_normalize?: IdentityNormalizerName[];
  fields: FieldSelection[];
}

const NORMALIZED_TEXT_CHAIN: NormalizerName[] = [
  "nfc",
  "trim",
  "collapse_whitespace",
  "casefold",
];

function mappingName(index: number, fieldName: string): string {
  const slug = casefold(fieldName).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `field_${index}_${slug || "mapping"}`;
}

function describeRow(selection: ValueMappingSelection): string {
  const values = (items: string[]) => items.map((item) => `'${item}'`).join(", ");
  return `${values(selection.left_values)} ↔ ${values(selection.right_values)} → '${selection.canonical_value}'`;
}

function buildMapping(field: FieldSelection): MappingConfig {
  if (!field.value_mappings || field.value_mappings.length === 0) {
    throw new WizardConfigurationError(
      `value mapping field '${field.left_column}' has no confirmed mappings`,
    );
  }
  // Rows sharing a canonical value form one N:1 / 1:N entry; aliases are
  // deduplicated in first-seen order. A value claimed by two canonicals is a
  // conflict, reported with both rows.
  const grouped = new Map<string, { left: Set<string>; right: Set<string> }>();
  const claimed = { left: new Map<string, ValueMappingSelection>(), right: new Map<string, ValueMappingSelection>() };
  for (const selection of field.value_mappings) {
    if (
      !selection.canonical_value ||
      !selection.left_values.length ||
      !selection.right_values.length
    ) {
      throw new WizardConfigurationError(
        "value mapping entries require a canonical value and both sides",
      );
    }
    for (const side of ["left", "right"] as const) {
      for (const value of selection[`${side}_values`]) {
        const prior = claimed[side].get(value);
        if (prior && prior.canonical_value !== selection.canonical_value) {
          throw new WizardConfigurationError(
            `value mapping for field '${field.left_column}': rows ${describeRow(prior)} and ${describeRow(selection)} ` +
              `map Dataset ${side === "left" ? "A" : "B"} value '${value}' to different canonical values`,
          );
        }
        claimed[side].set(value, selection);
      }
    }
    let entry = grouped.get(selection.canonical_value);
    if (!entry) {
      entry = { left: new Set(), right: new Set() };
      grouped.set(selection.canonical_value, entry);
    }
    for (const value of selection.left_values) entry.left.add(value);
    for (const value of selection.right_values) entry.right.add(value);
  }
  const mapping = Object.create(null) as MappingConfig;
  for (const [canonical, entry] of grouped) {
    mapping[canonical] = { left: [...entry.left], right: [...entry.right] };
  }
  validateMapping(field.left_column, mapping);
  const normalizers = field.mode === "Normalized text" ? NORMALIZED_TEXT_CHAIN : [];
  validateMapping(field.left_column, mapping, normalizers);
  return mapping;
}

function identityNormalizers(selected: IdentityNormalizerName[] = []): IdentityNormalizerName[] {
  for (const name of selected) {
    if (!IDENTITY_NORMALIZERS.includes(name)) {
      throw new WizardConfigurationError(`unsupported identity normalizer '${name}'`);
    }
  }
  return IDENTITY_NORMALIZERS.filter((name) => selected.includes(name));
}

export function buildContract(configuration: WizardConfiguration): ReconciliationContract {
  const activeFields = configuration.fields.filter(
    (field) => field.mode !== "Ignore",
  );
  if (activeFields.length === 0) {
    throw new WizardConfigurationError("select at least one comparison field");
  }

  const seenLeft = new Set<string>();
  const seenRight = new Set<string>();
  const configuredFields: FieldConfig[] = [];
  const valueMappings = Object.create(null) as Record<string, MappingConfig>;

  for (let index = 1; index <= activeFields.length; index++) {
    const field = activeFields[index - 1];
    if (seenLeft.has(field.left_column) || seenRight.has(field.right_column)) {
      throw new WizardConfigurationError(
        "a field cannot be mapped more than once on either side",
      );
    }
    if (
      field.left_column === configuration.left_identity ||
      field.right_column === configuration.right_identity
    ) {
      throw new WizardConfigurationError(
        "identity fields cannot also be comparison fields",
      );
    }
    seenLeft.add(field.left_column);
    seenRight.add(field.right_column);

    let mapName: string | null = null;
    if (field.mode === "Value mapping") {
      mapName = mappingName(index, field.left_column);
      valueMappings[mapName] = buildMapping(field);
    }

    const normalizers =
      field.mode === "Normalized text" ? [...NORMALIZED_TEXT_CHAIN] : [];

    configuredFields.push({
      name: field.left_column,
      left: field.left_column,
      right: field.right_column,
      normalize: normalizers,
      valueMapping: mapName,
    });
  }

  return {
    name: configuration.contract_name,
    left: { name: configuration.left_name },
    right: { name: configuration.right_name },
    identity: {
      left: configuration.left_identity,
      right: configuration.right_identity,
      normalize: identityNormalizers(configuration.identity_normalize),
    },
    fields: configuredFields,
    valueMappings,
  };
}
