import { AppError } from "./errors";
import { normalize, trim } from "./normalization";
import { compareCodePoints } from "./compare";
import { Dataset, IDENTITY_NORMALIZERS, IdentityNormalizerName, IdentityResult, RecordRow } from "./types";

export function validateIdentityNormalizers(names: readonly string[]): void {
  for (const name of names) {
    if (!(IDENTITY_NORMALIZERS as readonly string[]).includes(name)) {
      throw new AppError("IDENTITY_NORMALIZER_UNSUPPORTED", `unsupported identity normalizer '${name}'`);
    }
  }
}

// Null or all-whitespace identities cannot be keyed; they are reported per
// record as MISSING_IDENTITY instead of aborting the run.
function isMissingIdentity(value: string | null | undefined): boolean {
  return value === null || value === undefined || trim(value) === "";
}

// Records are keyed by the normalized identity, so duplicates are detected
// after normalization.
function indexRecords(
  dataset: Dataset,
  key: string,
  normalizers: readonly IdentityNormalizerName[],
): { index: Map<string, RecordRow[]>; missing: RecordRow[] } {
  const index = new Map<string, RecordRow[]>();
  const missing: RecordRow[] = [];
  for (const record of dataset.records) {
    const identity = record[key];
    if (isMissingIdentity(identity)) {
      missing.push(record);
      continue;
    }
    const normalized = normalize(identity!, normalizers);
    const list = index.get(normalized);
    if (list) {
      list.push(record);
    } else {
      index.set(normalized, [record]);
    }
  }
  return { index, missing };
}

export function reconcileIdentities(
  left: Dataset,
  right: Dataset,
  options: { leftKey: string; rightKey: string; normalize?: readonly IdentityNormalizerName[] },
): IdentityResult[] {
  const normalizers = options.normalize ?? [];
  validateIdentityNormalizers(normalizers);
  const { index: leftIndex, missing: leftMissing } = indexRecords(left, options.leftKey, normalizers);
  const { index: rightIndex, missing: rightMissing } = indexRecords(right, options.rightKey, normalizers);
  const results: IdentityResult[] = [];

  const allIdentities = Array.from(
    new Set([...leftIndex.keys(), ...rightIndex.keys()]),
  ).sort(compareCodePoints);

  for (const identity of allIdentities) {
    const leftRecords = leftIndex.get(identity) || [];
    const rightRecords = rightIndex.get(identity) || [];

    if (leftRecords.length > 1 || rightRecords.length > 1) {
      if (leftRecords.length > 1) {
        results.push({
          identity,
          status: "duplicate_left",
        });
      }
      if (rightRecords.length > 1) {
        results.push({
          identity,
          status: "duplicate_right",
        });
      }
    } else if (leftRecords.length === 0) {
      results.push({
        identity,
        status: "missing_left",
        rightRecord: rightRecords[0],
      });
    } else if (rightRecords.length === 0) {
      results.push({
        identity,
        status: "missing_right",
        leftRecord: leftRecords[0],
      });
    } else {
      results.push({
        identity,
        status: "matched",
        leftRecord: leftRecords[0],
        rightRecord: rightRecords[0],
      });
    }
  }

  for (const record of leftMissing) {
    results.push({ identity: record[options.leftKey] ?? null, status: "missing_identity_left", leftRecord: record });
  }
  for (const record of rightMissing) {
    results.push({ identity: record[options.rightKey] ?? null, status: "missing_identity_right", rightRecord: record });
  }

  return results;
}
