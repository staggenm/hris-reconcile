import { Dataset } from "../core/types";

export interface ColumnProfile {
  column_name: string;
  row_count: number;
  non_null_count: number;
  null_percentage: number;
  distinct_count: number;
  uniqueness_percentage: number;
  sample_values: string[];
}

export function profileDataset(
  dataset: Dataset,
  options: { sampleLimit?: number } = {},
): ColumnProfile[] {
  const sampleLimit = options.sampleLimit ?? 5;
  const rowCount = dataset.records.length;
  const profiles: ColumnProfile[] = [];

  for (const column of dataset.columns) {
    const nonNullValues: string[] = [];
    const seenDistinct = new Set<string>();
    const samples: string[] = [];

    for (const record of dataset.records) {
      const val = record[column];
      if (val !== null && val !== undefined) {
        nonNullValues.push(val);
        if (!seenDistinct.has(val)) {
          seenDistinct.add(val);
          if (samples.length < sampleLimit) {
            samples.push(val);
          }
        }
      }
    }

    const nonNullCount = nonNullValues.length;
    const distinctCount = seenDistinct.size;

    const nullPercentage =
      rowCount > 0
        ? Math.round(((rowCount - nonNullCount) / rowCount) * 10000) / 100
        : 0.0;

    const uniquenessPercentage =
      nonNullCount > 0
        ? Math.round((distinctCount / nonNullCount) * 10000) / 100
        : 0.0;

    profiles.push({
      column_name: column,
      row_count: rowCount,
      non_null_count: nonNullCount,
      null_percentage: nullPercentage,
      distinct_count: distinctCount,
      uniqueness_percentage: uniquenessPercentage,
      sample_values: samples,
    });
  }

  return profiles;
}
