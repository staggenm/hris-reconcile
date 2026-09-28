import { normalize } from "./normalization";
import { MappingResolver, normalizedResolver, validateMapping } from "./mapping";
import {
  FieldComparisonResult,
  FieldComparisonStatus,
  FieldConfig,
  MappingConfig,
  RecordRow,
} from "./types";

export function compareField(options: {
  identity: string;
  leftRecord: RecordRow;
  rightRecord: RecordRow;
  field: FieldConfig;
  valueMappings: Record<string, MappingConfig>;
}): FieldComparisonResult {
  const { field, valueMappings } = options;
  let resolver: MappingResolver | undefined;
  if (field.valueMapping) {
    const mapping = valueMappings[field.valueMapping];
    if (!mapping) throw new Error(`value mapping '${field.valueMapping}' not found`);
    validateMapping(field.valueMapping, mapping, field.normalize);
    resolver = normalizedResolver(field.valueMapping, mapping, field.normalize);
  }
  return compareFieldWithResolver(options, resolver);
}

export function compareFieldWithResolver(
  options: {
    identity: string;
    leftRecord: RecordRow;
    rightRecord: RecordRow;
    field: FieldConfig;
    valueMappings: Record<string, MappingConfig>;
  },
  resolver?: MappingResolver,
): FieldComparisonResult {
  const { identity, leftRecord, rightRecord, field } = options;
  const leftRaw = leftRecord[field.left] ?? null;
  const rightRaw = rightRecord[field.right] ?? null;

  const leftNormalized =
    leftRaw !== null ? normalize(leftRaw, field.normalize) : null;
  const rightNormalized =
    rightRaw !== null ? normalize(rightRaw, field.normalize) : null;

  let status: FieldComparisonStatus;
  let leftCanonical: string | null = null;
  let rightCanonical: string | null = null;

  if (leftRaw === null && rightRaw === null) {
    status = "both_null";
  } else if (leftRaw === null) {
    status = "left_null";
  } else if (rightRaw === null) {
    status = "right_null";
  } else if (leftRaw === rightRaw) {
    status = "match_exact";
  } else if (field.valueMapping) {
    if (!resolver) throw new Error(`value mapping '${field.valueMapping}' not found`);
    const leftRes = resolver.resolve(leftNormalized, "left");
    const rightRes = resolver.resolve(rightNormalized, "right");
    leftCanonical = leftRes.canonicalValue;
    rightCanonical = rightRes.canonicalValue;

    if (leftRes.status === "unmapped") {
      status = "unmapped_left";
    } else if (rightRes.status === "unmapped") {
      status = "unmapped_right";
    } else if (leftCanonical === rightCanonical) {
      status = "match_mapped";
    } else {
      status = "mismatch";
    }
  } else if (leftNormalized === rightNormalized) {
    status = "match_normalized";
  } else {
    status = "mismatch";
  }

  return {
    identity,
    fieldName: field.name,
    leftRawValue: leftRaw,
    rightRawValue: rightRaw,
    leftNormalizedValue: leftNormalized,
    rightNormalizedValue: rightNormalized,
    leftCanonicalValue: leftCanonical,
    rightCanonicalValue: rightCanonical,
    status,
    mappingName: field.valueMapping || null,
  };
}
