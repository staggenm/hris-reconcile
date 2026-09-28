import { describe, expect, it } from "vitest";
import { parseCsvContent } from "../src/web/analysis/csv";
import { reconcileIdentities } from "../src/web/core/identity";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { ReconciliationContract } from "../src/web/core/types";

describe("source line numbers", () => {
  it("records the physical start line of each record (header = line 1)", () => {
    const text = [
      "id,note",            // 1
      "1,plain",            // 2
      "",                   // 3 (blank, skipped)
      '2,"two\r\nlines"',   // 4-5 (quoted CRLF)
      "3,after",            // 6
      '4,"a\nb\nc"',        // 7-9
      "5,last",             // 10
    ].join("\n") + "\n";
    const dataset = parseCsvContent(text, "x");
    expect(dataset.records.map((record) => record.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(dataset.recordLines).toEqual([2, 4, 6, 7, 10]);
  });

  it("counts CRLF and lone CR line endings as single line breaks", () => {
    expect(parseCsvContent("id\r\n1\r\n\r\n2\r\n", "x").recordLines).toEqual([2, 4]);
    expect(parseCsvContent("id\r1\r2\r", "x").recordLines).toEqual([2, 3]);
  });

  const left = parseCsvContent("id,v\n1,a\n,blank\n2,b\n2,b2\n3,c\n", "left");
  const right = parseCsvContent("id,v\n1,a\n2,b\n3,x\n\n4,d\n  ,space\n", "right");

  it("attaches source lines to every identity result, including both sides of duplicates", () => {
    const results = reconcileIdentities(left, right, { leftKey: "id", rightKey: "id" });
    expect(results.map((item) => [item.status, item.identity, item.leftLines, item.rightLines])).toEqual([
      ["matched", "1", [2], [2]],
      ["duplicate_left", "2", [4, 5], [3]],
      ["matched", "3", [6], [4]],
      ["missing_left", "4", [], [6]],
      ["missing_identity_left", null, [3], []],
      ["missing_identity_right", "  ", [], [7]],
    ]);
  });

  it("attaches left and right source lines to field comparisons", () => {
    const contract: ReconciliationContract = {
      name: "c", left: { name: "left" }, right: { name: "right" }, identity: { left: "id", right: "id" },
      fields: [{ name: "v", left: "v", right: "v", normalize: [] }], valueMappings: {},
    };
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    expect([...result.fieldResults()].map((item) => [item.identity, item.leftLine, item.rightLine])).toEqual([["1", 2, 2], ["3", 6, 4]]);
    expect(result.discrepancies.map((item) => [item.identity, item.leftLine, item.rightLine])).toEqual([["3", 6, 4]]);
  });

  it("falls back to header + index for datasets built without line numbers", () => {
    const results = reconcileIdentities(
      { name: "l", columns: ["id"], records: [{ id: "a" }, { id: "b" }] },
      { name: "r", columns: ["id"], records: [{ id: "b" }] },
      { leftKey: "id", rightKey: "id" },
    );
    expect(results.map((item) => [item.identity, item.leftLines, item.rightLines])).toEqual([["a", [2], []], ["b", [3], [2]]]);
  });
});

describe("identity issues page", () => {
  it("pages non-matched identities with public statuses and source rows", async () => {
    const { identityIssuesPage } = await import("../src/web/analysis/results_analysis");
    const leftData = parseCsvContent("id,v\n1,a\n2,b\n2,b2\n,c\n", "left");
    const rightData = parseCsvContent("id,v\n1,a\n3,x\n", "right");
    const contract: ReconciliationContract = {
      name: "c", left: { name: "left" }, right: { name: "right" }, identity: { left: "id", right: "id" },
      fields: [{ name: "v", left: "v", right: "v", normalize: [] }], valueMappings: {},
    };
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: leftData, rightDataset: rightData });
    const page = identityIssuesPage(result, { page: 0, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.rows).toEqual([
      { identity: "2", status: "DUPLICATE_LEFT", left_rows: [3, 4], right_rows: [] },
      { identity: "3", status: "MISSING_LEFT", left_rows: [], right_rows: [3] },
    ]);
    expect(identityIssuesPage(result, { page: 1, pageSize: 2 }).rows).toEqual([
      { identity: null, status: "MISSING_IDENTITY_LEFT", left_rows: [5], right_rows: [] },
    ]);
  });
});
