export type RecordRow = Record<string, string | null>;

export interface Dataset {
  name: string;
  columns: string[];
  records: RecordRow[];
}

export interface DatasetSummary {
  name: string;
  columns: string[];
  recordCount: number;
  previewRecords: RecordRow[];
}

export type IdentityStatus =
  | "matched"
  | "missing_left"
  | "missing_right"
  | "duplicate_left"
  | "duplicate_right";

export interface IdentityResult {
  identity: string;
  status: IdentityStatus;
  leftRecord?: RecordRow;
  rightRecord?: RecordRow;
}

export type FieldComparisonStatus =
  | "match_exact"
  | "match_normalized"
  | "match_mapped"
  | "both_null"
  | "left_null"
  | "right_null"
  | "unmapped_left"
  | "unmapped_right"
  | "mismatch";

export type ComparisonMode = "Exact" | "Normalized text" | "Value mapping" | "Ignore";

export type NormalizerName =
  | "trim"
  | "uppercase"
  | "lowercase"
  | "casefold"
  | "collapse_whitespace";

export interface MappingValues {
  left: string[];
  right: string[];
}

export type MappingConfig = Record<string, MappingValues>;

export interface FieldConfig {
  name: string;
  left: string;
  right: string;
  normalize: NormalizerName[];
  valueMapping?: string | null;
}

export interface ReconciliationContract {
  name: string;
  left: { name: string };
  right: { name: string };
  identity: { left: string; right: string };
  fields: FieldConfig[];
  valueMappings: Record<string, MappingConfig>;
}

export interface FieldComparisonResult {
  identity: string;
  fieldName: string;
  leftRawValue: string | null;
  rightRawValue: string | null;
  leftNormalizedValue: string | null;
  rightNormalizedValue: string | null;
  leftCanonicalValue: string | null;
  rightCanonicalValue: string | null;
  status: FieldComparisonStatus;
  mappingName?: string | null;
}

export interface DatasetStatistics {
  name: string;
  recordCount: number;
  columnCount: number;
}

export interface ReconciliationResult {
  leftDataset: DatasetStatistics;
  rightDataset: DatasetStatistics;
  identityResults: IdentityResult[];
  fieldResults: FieldComparisonResult[];
}
