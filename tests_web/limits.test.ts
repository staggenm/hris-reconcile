import { describe, expect, it } from "vitest";
import { parseCsvContent } from "../src/web/analysis/csv";
import { AppError } from "../src/web/core/errors";
import { checkFileSize, DEFAULT_LIMITS, estimateComparisons, Limits } from "../src/web/core/limits";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";

const limits = (overrides: Partial<Limits>): Limits => ({ ...DEFAULT_LIMITS, ...overrides });

function thrown(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    return error as AppError;
  }
  throw new AppError("INTERNAL", "expected the action to throw");
}

const dataset = (name: string, rows: number): Dataset => ({
  name, columns: ["id", "a", "b"],
  records: Array.from({ length: rows }, (_, i) => ({ id: String(i), a: "x", b: "y" })),
});
const contract: ReconciliationContract = {
  name: "c", left: { name: "l" }, right: { name: "r" }, identity: { left: "id", right: "id" },
  fields: [{ name: "a", left: "a", right: "a", normalize: [] }, { name: "b", left: "b", right: "b", normalize: [] }],
  valueMappings: {},
};

describe("volume limits", () => {
  it("has the benchmarked defaults", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxFileBytes: 100 * 1024 * 1024, maxRows: 200_000, maxColumns: 200, maxCells: 8_000_000,
      maxComparisons: 6_000_000, maxDiscrepancies: 1_500_000,
    });
  });

  it("checks cells (rows × columns) per file after parsing", () => {
    expect(parseCsvContent("a,b\n1,2\n3,4\n", "x", { limits: limits({ maxCells: 4 }) }).records).toHaveLength(2);
    const error = thrown(() => parseCsvContent("a,b\n1,2\n3,4\n5,6\n", "x", { limits: limits({ maxCells: 4 }) }));
    expect([error.code, error.message]).toEqual(["LIMIT_CELLS", "dataset 'x' has 6 cells (3 rows × 2 columns); the limit is 4"]);
  });

  it("aborts reconciliation as soon as stored discrepancies exceed the limit", () => {
    const differing = (name: string) => dataset(name, 10);
    const left = differing("l");
    const right = differing("r");
    right.records.forEach((record, i) => { record.a = `other ${i}`; });
    // Records past the first few must never be compared if the run aborts early.
    right.records = right.records.map((record, i) => i < 4 ? record : new Proxy(record, {
      get(target, key) {
        if (key === "a" || key === "b") throw new AppError("INTERNAL", `record ${i} compared after the limit was reached`);
        return target[key as string];
      },
    }));
    const error = thrown(() => new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right, limits: limits({ maxDiscrepancies: 3 }) }));
    expect([error.code, error.message]).toEqual([
      "LIMIT_DISCREPANCIES",
      "Too many differences. This usually means the identity field or value mappings are wrong. Check the configuration before rerunning.",
    ]);
  });

  it("checks the file size before reading", () => {
    expect(() => checkFileSize("a.csv", 10, limits({ maxFileBytes: 10 }))).not.toThrow();
    const error = thrown(() => checkFileSize("a.csv", 11 * 1024 * 1024, limits({ maxFileBytes: 10 * 1024 * 1024 })));
    expect([error.code, error.message]).toEqual(["LIMIT_FILE_SIZE", "file 'a.csv' is 11.0 MB; the limit is 10.0 MB"]);
  });

  it("checks rows and columns after parsing", () => {
    expect(parseCsvContent("a\n1\n2\n", "x", { limits: limits({ maxRows: 2 }) }).records).toHaveLength(2);
    const rows = thrown(() => parseCsvContent("a\n1\n2\n3\n", "x", { limits: limits({ maxRows: 2 }) }));
    expect([rows.code, rows.message]).toEqual(["LIMIT_ROWS", "dataset 'x' has 3 rows; the limit is 2"]);
    const columns = thrown(() => parseCsvContent("a,b,c\n1,2,3\n", "x", { limits: limits({ maxColumns: 2 }) }));
    expect([columns.code, columns.message]).toEqual(["LIMIT_COLUMNS", "dataset 'x' has 3 columns; the limit is 2"]);
  });

  it("estimates comparisons as min(rows) × fields and checks them before reconciling", () => {
    expect(estimateComparisons(3, 5, 2)).toBe(6);
    const engine = new ReconciliationEngine();
    expect(() => engine.reconcile({ contract, leftDataset: dataset("l", 3), rightDataset: dataset("r", 5), limits: limits({ maxComparisons: 6 }) })).not.toThrow();
    const error = thrown(() => engine.reconcile({ contract, leftDataset: dataset("l", 3), rightDataset: dataset("r", 5), limits: limits({ maxComparisons: 5 }) }));
    expect([error.code, error.message]).toEqual(["LIMIT_COMPARISONS", "this run needs about 6 field comparisons (3 rows × 2 fields); the limit is 5"]);
  });
});
