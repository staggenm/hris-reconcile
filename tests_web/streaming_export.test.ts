import { describe, expect, it } from "vitest";
import { BLOB_FOLD_CHARS, CHUNK_CHARS, csvChunks, exportBlob, jsonChunks } from "../src/web/core/export";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, ReconciliationContract } from "../src/web/core/types";

const EMPLOYEES = 20_000;
const dataset = (name: string): Dataset => ({
  name, columns: ["id", "a", "b", "c"],
  records: Array.from({ length: EMPLOYEES }, (_, i) => ({ id: `E${i}`, a: `alpha ${i}`, b: i % 20 === 0 ? `${name}${i}` : "same", c: null })),
});
const contract: ReconciliationContract = {
  name: "stream", left: { name: "l" }, right: { name: "r" }, identity: { left: "id", right: "id" },
  fields: ["a", "b", "c"].map((f) => ({ name: f, left: f, right: f, normalize: [] })), valueMappings: {},
};
const result = new ReconciliationEngine().reconcile({ contract, leftDataset: dataset("l"), rightDataset: dataset("r") });

function expectBoundedChunks(chunks: string[]): void {
  expect(chunks.length).toBeGreaterThan(10);
  // A chunk closes as soon as it reaches CHUNK_CHARS, so it exceeds it by at most one line or item.
  for (const chunk of chunks) expect(chunk.length).toBeLessThan(CHUNK_CHARS + 4096);
}

describe("streaming exports", () => {
  it("emits CSV as bounded chunks, never one report-sized string", () => {
    const chunks = [...csvChunks(result)];
    expectBoundedChunks(chunks);
    expect(chunks.join("").split("\n")).toHaveLength(1 + EMPLOYEES + EMPLOYEES * 3 + 1);
    expect([...csvChunks(result, { mismatchesOnly: true })].join("")).toContain(",b,l0,r0,");
  });

  it("emits JSON as bounded chunks that equal JSON.stringify(report, null, 2)", () => {
    const chunks = [...jsonChunks(contract, result)];
    expectBoundedChunks(chunks);
    const parsed = JSON.parse(chunks.join(""));
    expect(parsed.details.field_comparisons).toHaveLength(EMPLOYEES * 3);
    expect(chunks.join("")).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  });

  it("writes empty detail arrays exactly like JSON.stringify", () => {
    const empty = new ReconciliationEngine().reconcile({
      contract, leftDataset: { ...dataset("l"), records: [] }, rightDataset: { ...dataset("r"), records: [] },
    });
    const text = [...jsonChunks(contract, empty)].join("");
    expect(text).toContain('"identities": [],\n    "field_comparisons": []\n');
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  });

  it("folds chunks into the Blob incrementally for exports larger than the fold size", async () => {
    const full = [...jsonChunks(contract, result)].join("");
    expect(full.length).toBeGreaterThan(BLOB_FOLD_CHARS);
    const blob = exportBlob(jsonChunks(contract, result), "application/json;charset=utf-8");
    expect(await blob.text()).toBe(full);
  });

  it("assembles chunks into a typed Blob", async () => {
    const blob = exportBlob(csvChunks(result, { mismatchesOnly: true }), "text/csv;charset=utf-8");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe([...csvChunks(result, { mismatchesOnly: true })].join(""));
  });
});
