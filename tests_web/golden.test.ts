import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { generateReconciliationCsv, generateReconciliationJson } from "./support/exports";
import { parseContractDocument } from "../src/web/core/contract_document";
import { buildReportMetadata } from "../src/web/core/export";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { sha256HexSync } from "../src/web/core/sha256";

// Golden files are the reference output of the web engine. Regenerate them only
// for an intended behaviour change, and list the diff in the phase report:
//   UPDATE_GOLDEN=1 npx vitest run tests_web/golden.test.ts
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const goldenRoot = path.resolve(__dirname, "fixtures/golden");

const CASES = [
  { name: "core_hr_vs_payroll", left: "core_hr", right: "payroll" },
  { name: "status_matrix", left: "left", right: "right" },
] as const;

// Report metadata from the fixture files themselves; generated_at is fixed so
// the golden report is reproducible.
const GENERATED_AT = new Date(Date.UTC(2026, 0, 1));

function runGoldenCase(testCase: (typeof CASES)[number]) {
  const directory = path.join(goldenRoot, testCase.name);
  const read = (file: string) => fs.readFileSync(path.join(directory, file), "utf8");
  const source = (name: string) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(directory, `${name}.csv`)));
    return { fileName: `${name}.csv`, encoding: "utf-8" as const, sha256: sha256HexSync(bytes), byteLength: bytes.byteLength };
  };
  const contract = parseContractDocument(JSON.parse(read("contract.json")));
  const left = parseCsvContent(read(`${testCase.left}.csv`), testCase.left);
  const right = parseCsvContent(read(`${testCase.right}.csv`), testCase.right);
  const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
  const metadata = buildReportMetadata({
    sources: { left: source(testCase.left), right: source(testCase.right) }, excelSafe: true, now: GENERATED_AT,
  });
  return {
    directory,
    outputs: {
      "report.json": generateReconciliationJson(contract, result, metadata),
      "full.csv": generateReconciliationCsv(result),
      "mismatches.csv": generateReconciliationCsv(result, { mismatchesOnly: true }),
    },
  };
}

describe("golden files", () => {
  for (const testCase of CASES) {
    it(`${testCase.name} reproduces committed outputs byte-for-byte`, () => {
      const { directory, outputs } = runGoldenCase(testCase);
      for (const [file, actual] of Object.entries(outputs)) {
        const target = path.join(directory, file);
        if (UPDATE) fs.writeFileSync(target, actual);
        expect(actual, file).toBe(fs.readFileSync(target, "utf8"));
      }
    });
  }

  it("status_matrix covers every public identity and field status", () => {
    const report = JSON.parse(runGoldenCase(CASES[1]).outputs["report.json"]);
    for (const [summary, size] of [["identity_summary", 7], ["field_comparison_summary", 9]] as const) {
      const counts = Object.values(report[summary]) as number[];
      expect(counts).toHaveLength(size);
      expect(counts.every((count) => count > 0), summary).toBe(true);
    }
  });
});
