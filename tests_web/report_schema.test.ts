import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateJsonSchema } from "./support/json_schema";

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../schemas/report.schema.json"), "utf8"));
const goldenRoot = path.resolve(__dirname, "fixtures/golden");
const goldenReport = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(goldenRoot, name, "report.json"), "utf8"));

describe("web-owned JSON report schema", () => {
  it("is a draft 2020-12 schema for report format 1.0", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.run_metadata.properties.format_version.const).toBe("1.0");
  });

  for (const name of ["core_hr_vs_payroll", "status_matrix"]) {
    it(`accepts the ${name} golden report`, () => {
      expect(validateJsonSchema(schema, goldenReport(name))).toEqual([]);
    });
  }

  const mutations: Array<[string, (report: any) => void, RegExp]> = [
    ["an extra top-level property", (r) => { r.unexpected = 1; }, /\/unexpected: additional property/],
    ["a missing required property", (r) => { delete r.contract_name; }, /: missing required property 'contract_name'/],
    ["an unknown identity status", (r) => { r.details.identities[0].status = "matched"; }, /\/details\/identities\/0\/status: value not in enum/],
    ["a wrong format version", (r) => { r.run_metadata.format_version = "2.0"; }, /\/run_metadata\/format_version: expected const/],
    ["a numeric raw value", (r) => { r.details.field_comparisons[0].left_raw_value = 1; }, /left_raw_value: expected type string,null/],
    ["a null identity", (r) => { r.details.identities[0].identity = null; }, /\/details\/identities\/0\/identity: expected type string/],
    ["a negative summary count", (r) => { r.identity_summary.MATCHED = -1; }, /\/identity_summary\/MATCHED: below minimum 0/],
    ["a missing summary status", (r) => { delete r.field_comparison_summary.MISMATCH; }, /missing required property 'MISMATCH'/],
  ];
  for (const [label, mutate, expected] of mutations) {
    it(`rejects ${label}`, () => {
      const report = goldenReport("status_matrix");
      mutate(report);
      const errors = validateJsonSchema(schema, report);
      expect(errors.join("\n")).toMatch(expected);
    });
  }

  it("refuses schema keywords the validator does not implement", () => {
    expect(() => validateJsonSchema({ type: "string", pattern: "^a" }, "a")).toThrow(/unsupported schema keyword 'pattern'/);
  });
});
