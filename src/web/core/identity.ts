import { AppError } from "./errors";
import { normalize, trim } from "./normalization";
import { compareCodePoints } from "./compare";
import { Dataset, IDENTITY_NORMALIZERS, IdentityNormalizerName, IdentityResult, recordLine, RecordRow } from "./types";

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

interface IndexedRecord {
  record: RecordRow;
  line: number;
}

// Records are keyed by the normalized identity, so duplicates are detected
// after normalization.
function indexRecords(
  dataset: Dataset,
  key: string,
  normalizers: readonly IdentityNormalizerName[],
): { index: Map<string, IndexedRecord[]>; missing: IndexedRecord[] } {
  const index = new Map<string, IndexedRecord[]>();
  const missing: IndexedRecord[] = [];
  dataset.records.forEach((record, position) => {
    const entry = { record, line: recordLine(dataset, position) };
    const identity = record[key];
    if (isMissingIdentity(identity)) {
      missing.push(entry);
      return;
    }
    const normalized = normalize(identity!, normalizers);
    const list = index.get(normalized);
    if (list) {
      list.push(entry);
    } else {
      index.set(normalized, [entry]);
    }
  });
  return { index, missing };
}

const linesOf = (entries: IndexedRecord[]) => entries.map((entry) => entry.line);

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
    const leftEntries = leftIndex.get(identity) || [];
    const rightEntries = rightIndex.get(identity) || [];
    const leftLines = linesOf(leftEntries);
    const rightLines = linesOf(rightEntries);

    if (leftEntries.length > 1 || rightEntries.length > 1) {
      if (leftEntries.length > 1) {
        results.push({ identity, status: "duplicate_left", leftLines, rightLines });
      }
      if (rightEntries.length > 1) {
        results.push({ identity, status: "duplicate_right", leftLines, rightLines });
      }
    } else if (leftEntries.length === 0) {
      results.push({ identity, status: "missing_left", rightRecord: rightEntries[0].record, leftLines, rightLines });
    } else if (rightEntries.length === 0) {
      results.push({ identity, status: "missing_right", leftRecord: leftEntries[0].record, leftLines, rightLines });
    } else {
      results.push({
        identity,
        status: "matched",
        leftRecord: leftEntries[0].record,
        rightRecord: rightEntries[0].record,
        leftLines,
        rightLines,
      });
    }
  }

  for (const entry of leftMissing) {
    results.push({
      identity: entry.record[options.leftKey] ?? null, status: "missing_identity_left",
      leftRecord: entry.record, leftLines: [entry.line], rightLines: [],
    });
  }
  for (const entry of rightMissing) {
    results.push({
      identity: entry.record[options.rightKey] ?? null, status: "missing_identity_right",
      rightRecord: entry.record, leftLines: [], rightLines: [entry.line],
    });
  }

  return results;
}
