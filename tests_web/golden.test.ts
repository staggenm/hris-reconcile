import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCsvContent } from "../src/web/analysis/csv";
import { generateReconciliationCsv, generateReconciliationJson } from "../src/web/core/export";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { MappingConfig, ReconciliationContract } from "../src/web/core/types";

// Golden files are the reference output of the web engine. Regenerate them only
// for an intended behaviour change, and list the diff in the phase report:
//   UPDATE_GOLDEN=1 npx vitest run tests_web/golden.test.ts
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const goldenRoot = path.resolve(__dirname, "fixtures/golden");

const CASES = [
  { name: "core_hr_vs_payroll", left: "core_hr", right: "payroll" },
  { name: "status_matrix", left: "left", right: "right" },
] as const;

function toTypeScriptContract(source: Record<string, any>): ReconciliationContract {
  const mappings: Record<string, MappingConfig> = Object.create(null);
  for (const [name, entries] of Object.entries(source.value_mappings ?? {})) {
    const mapping: MappingConfig = Object.create(null);
    for (const [canonical, values] of Object.entries(entries as Record<string, any>)) {
      mapping[canonical] = { left: [...values.left], right: [...values.right] };
    }
    mappings[name] = mapping;
  }
  return {
    name: source.name,
    left: { name: source.left.name }, right: { name: source.right.name },
    identity: source.identity,
    fields: source.fields.map((field: Record<string, any>) => ({
      name: field.name, left: field.left, right: field.right,
      normalize: field.normalize ?? [], valueMapping: field.value_mapping ?? null,
    })),
    valueMappings: mappings,
  };
}

function runGoldenCase(testCase: (typeof CASES)[number]) {
  const directory = path.join(goldenRoot, testCase.name);
  const read = (file: string) => fs.readFileSync(path.join(directory, file), "utf8");
  const contract = toTypeScriptContract(JSON.parse(read("contract.json")));
  const left = parseCsvContent(read(`${testCase.left}.csv`), testCase.left);
  const right = parseCsvContent(read(`${testCase.right}.csv`), testCase.right);
  const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
  return {
    directory,
    outputs: {
      "report.json": generateReconciliationJson(contract, result),
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
