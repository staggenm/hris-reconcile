import { describe, expect, it } from "vitest";
import { excelSafeCell } from "../src/web/core/export";
import { generateReconciliationCsv, generateReconciliationJson } from "./support/exports";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";

const TRIGGERS = ["=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠"];

const contract: ReconciliationContract = {
  name: "c", left: { name: "l" }, right: { name: "r" },
  identity: { left: "id", right: "id" },
  fields: [{ name: "v", left: "v", right: "v", normalize: [] }], valueMappings: {},
};
const dataset = (name: string, rows: Array<[string, string]>): Dataset =>
  ({ name, columns: ["id", "v"], records: rows.map(([id, v]) => ({ id, v })) });
const result = new ReconciliationEngine().reconcile({
  contract,
  leftDataset: dataset("l", [["=1+1", "=HYPERLINK(\"http://x\",\"a,b\")"], ["-7", "-7"], ["2", "@SUM(A1)"]]),
  rightDataset: dataset("r", [["=1+1", "safe"], ["-7", "-7"], ["2", "+1"]]),
});

describe("excelSafe CSV export", () => {
  it.each(TRIGGERS)("prefixes a value starting with %j", (trigger) => {
    expect(excelSafeCell(`${trigger}x`)).toBe(`'${trigger}x`);
  });

  it("exempts plain numbers, including negatives", () => {
    for (const value of ["12", "-12", "0.5", "-1.5"]) expect(excelSafeCell(value)).toBe(value);
    for (const value of ["-", "-1e5", "--1", "-1.", "+1"]) expect(excelSafeCell(value)).toBe(`'${value}`);
  });

  it("leaves values that only contain a trigger later on", () => {
    for (const value of ["a=b", " =x", "x-1", "", "Straße"]) expect(excelSafeCell(value)).toBe(value);
  });

  it("is on by default and neutralizes every data column before CSV quoting", () => {
    const csv = generateReconciliationCsv(result);
    expect(csv).toContain("identity,'=1+1,,");
    expect(csv).toContain("field_comparison,'=1+1,v,\"'=HYPERLINK(\"\"http://x\"\",\"\"a,b\"\")\",safe,");
    expect(csv).toContain("field_comparison,-7,v,-7,-7,");
    expect(csv).toContain("field_comparison,2,v,'@SUM(A1),'+1,'@SUM(A1),'+1,");
  });

  it("can be switched off", () => {
    const csv = generateReconciliationCsv(result, { excelSafe: false, mismatchesOnly: true });
    expect(csv).toContain("field_comparison,2,v,@SUM(A1),+1,");
    expect(csv).not.toContain("'");
  });

  it("never changes the JSON report", () => {
    const report = JSON.parse(generateReconciliationJson(contract, result));
    expect(report.details.field_comparisons.map((item: { left_raw_value: string }) => item.left_raw_value))
      .toEqual(["@SUM(A1)", "=HYPERLINK(\"http://x\",\"a,b\")"]);
    expect(JSON.stringify(report)).not.toContain("'");
  });
});
