import {
  ComparisonMode,
  FieldConfig,
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
  fields: FieldSelection[];
}

const NORMALIZED_TEXT_CHAIN: NormalizerName[] = [
  "trim",
  "collapse_whitespace",
  "casefold",
];

function mappingName(index: number, fieldName: string): string {
  const slug = casefold(fieldName).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `field_${index}_${slug || "mapping"}`;
}

function buildMapping(field: FieldSelection): MappingConfig {
  if (!field.value_mappings || field.value_mappings.length === 0) {
    throw new WizardConfigurationError(
      `value mapping field '${field.left_column}' has no confirmed mappings`,
    );
  }
  const mapping = Object.create(null) as MappingConfig;
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
    if (Object.prototype.hasOwnProperty.call(mapping, selection.canonical_value)) {
      throw new WizardConfigurationError(
        `canonical value '${selection.canonical_value}' is used more than once`,
      );
    }
    mapping[selection.canonical_value] = {
      left: [...selection.left_values],
      right: [...selection.right_values],
    };
  }
  validateMapping(field.left_column, mapping);
  const normalizers = field.mode === "Normalized text" ? NORMALIZED_TEXT_CHAIN : [];
  validateMapping(field.left_column, mapping, normalizers);
  return mapping;
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
    },
    fields: configuredFields,
    valueMappings,
  };
}
