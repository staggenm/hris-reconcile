import { AppError } from "../core/errors";

// Only CSV files are accepted, whether chosen or dropped.
export function isCsvFile(name: string, type: string): boolean {
  return /\.csv$/i.test(name) || type === "text/csv";
}

export function assertCsvFile(name: string, type: string): void {
  if (!isCsvFile(name, type)) {
    throw new AppError("FILE_TYPE", `'${name}' is not a CSV file. Export the data as .csv and upload that file.`);
  }
}
