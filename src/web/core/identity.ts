import { Dataset, IdentityResult, RecordRow } from "./types";

function indexRecords(dataset: Dataset, key: string): Map<string, RecordRow[]> {
  const index = new Map<string, RecordRow[]>();
  for (const record of dataset.records) {
    const identity = record[key];
    if (identity === null || identity === undefined || identity === "") {
      throw new Error(`dataset '${dataset.name}' contains a null identity`);
    }
    const list = index.get(identity);
    if (list) {
      list.push(record);
    } else {
      index.set(identity, [record]);
    }
  }
  return index;
}

export function reconcileIdentities(
  left: Dataset,
  right: Dataset,
  options: { leftKey: string; rightKey: string },
): IdentityResult[] {
  const leftIndex = indexRecords(left, options.leftKey);
  const rightIndex = indexRecords(right, options.rightKey);
  const results: IdentityResult[] = [];

  const allIdentities = Array.from(
    new Set([...leftIndex.keys(), ...rightIndex.keys()]),
  ).sort();

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

  return results;
}
