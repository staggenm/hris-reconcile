import { describe, expect, it } from "vitest";
import { AppError } from "../src/web/core/errors";
import { assertCsvFile, isCsvFile } from "../src/web/ui/files";

describe("CSV file check", () => {
  it("accepts .csv names (any case) and the text/csv type", () => {
    expect(isCsvFile("people.csv", "")).toBe(true);
    expect(isCsvFile("PEOPLE.CSV", "application/octet-stream")).toBe(true);
    expect(isCsvFile("export", "text/csv")).toBe(true);
  });

  it("rejects other files with FILE_TYPE", () => {
    expect(isCsvFile("people.xlsx", "application/vnd.ms-excel")).toBe(false);
    expect(isCsvFile("notes.txt", "text/plain")).toBe(false);
    let error: AppError | undefined;
    try {
      assertCsvFile("notes.txt", "text/plain");
    } catch (caught) {
      error = caught as AppError;
    }
    expect([error?.code, error?.message]).toEqual(["FILE_TYPE", "'notes.txt' is not a CSV file. Export the data as .csv and upload that file."]);
  });
});
