import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeResultsSummary } from "../src/web/analysis/results_analysis";
import { generateReconciliationCsv, generateReconciliationJson } from "../src/web/core/export";
import { reconcileIdentities } from "../src/web/core/identity";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";
import { validateJsonSchema } from "./support/json_schema";

const dataset = (name: string, rows: Array<[string | null, string | null]>): Dataset => ({
  name, columns: ["id", "v"], records: rows.map(([id, v]) => ({ id, v })),
});
const left = dataset("left", [[null, "a"], ["001", "x"], ["  ", "b"], [" \t", "c"]]);
const right = dataset("right", [["001", "x"], ["\t", "d"]]);
const contract: ReconciliationContract = {
  name: "missing", left: { name: "left" }, right: { name: "right" },
  identity: { left: "id", right: "id" },
  fields: [{ name: "v", left: "v", right: "v", normalize: [] }],
  valueMappings: {},
};

describe("MISSING_IDENTITY", () => {
  it("reports null and all-whitespace identities per side after the keyed results", () => {
    const results = reconcileIdentities(left, right, { leftKey: "id", rightKey: "id" });
    expect(results.map((item) => [item.status, item.identity])).toEqual([
      ["matched", "001"],
      ["missing_identity_left", null],
      ["missing_identity_left", "  "],
      ["missing_identity_left", " \t"],
      ["missing_identity_right", "\t"],
    ]);
    expect(results[1].leftRecord?.v).toBe("a");
    expect(results[4].rightRecord?.v).toBe("d");
  });

  it("does not abort the run and counts missing identities in the summary", () => {
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    expect(result.fieldResults).toHaveLength(1);
    const summary = computeResultsSummary(result);
    expect(summary.identity_counts.missing_identity_left).toBe(3);
    expect(summary.identity_counts.missing_identity_right).toBe(1);
    expect(summary.metrics.missing_identities).toBe(4);
  });

  it("keeps exact semantics for whitespace-only comparison values", () => {
    const l = dataset("left", [["1", " "], ["2", " "]]);
    const r = dataset("right", [["1", " "], ["2", null]]);
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: l, rightDataset: r });
    expect(result.fieldResults.map((item) => item.status)).toEqual(["match_exact", "right_null"]);
  });

  it("exports missing identities in CSV and a schema-valid JSON report", () => {
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    const csv = generateReconciliationCsv(result, { mismatchesOnly: true });
    expect(csv).toContain("identity,,,,,,,,,,,MISSING_IDENTITY_LEFT\n");
    expect(csv).toContain("identity,\t,,,,,,,,,,MISSING_IDENTITY_RIGHT\n");
    const report = JSON.parse(generateReconciliationJson(contract, result));
    expect(report.identity_summary).toMatchObject({ MISSING_IDENTITY_LEFT: 3, MISSING_IDENTITY_RIGHT: 1 });
    expect(report.details.identities[1]).toEqual({ identity: null, status: "MISSING_IDENTITY_LEFT" });
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../schemas/report.schema.json"), "utf8"));
    expect(validateJsonSchema(schema, report)).toEqual([]);
  });
});
