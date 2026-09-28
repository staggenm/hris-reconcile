import { describe, expect, it } from "vitest";
import { parseCsvContent } from "../src/web/analysis/csv";
import { profileDataset } from "../src/web/analysis/profiling";
import {
  scoreFieldPair,
  suggestFieldMappings,
  suggestIdentity,
} from "../src/web/analysis/suggestions";
import { analyzeObservedPairs } from "../src/web/analysis/mapping_analysis";
import {
  aggregateMismatchesByField,
  aggregateMismatchesByPair,
  computeResultsSummary,
} from "../src/web/analysis/results_analysis";
import { buildContract } from "../src/web/core/contract_builder";
import {
  generateReconciliationCsv,
  generateReconciliationJson,
} from "../src/web/core/export";
import { ReconciliationEngine } from "../src/web/core/reconciliation";

describe("CSV Parser", () => {
  it("parses valid comma-separated CSV with headers and values", () => {
    const csv = "person_id,name,note\n001,Alpha,\n002,Beta,Present\n";
    const dataset = parseCsvContent(csv, "Core HR");
    expect(dataset.name).toBe("Core HR");
    expect(dataset.columns).toEqual(["person_id", "name", "note"]);
    expect(dataset.records).toEqual([
      { person_id: "001", name: "Alpha", note: null },
      { person_id: "002", name: "Beta", note: "Present" },
    ]);
  });

  it("detects semicolon delimiter", () => {
    const csv = 'person_id;name;company\n001;"Alpha, Beta";0001\n';
    const dataset = parseCsvContent(csv, "Payroll");
    expect(dataset.columns).toEqual(["person_id", "name", "company"]);
    expect(dataset.records).toEqual([
      { person_id: "001", name: "Alpha, Beta", company: "0001" },
    ]);
  });

  it("fails on empty CSV", () => {
    expect(() => parseCsvContent("", "Empty")).toThrow(/empty/i);
    expect(() => parseCsvContent("person_id,name\n", "Empty")).toThrow(/empty/i);
  });

  it("fails on duplicate column names", () => {
    expect(() =>
      parseCsvContent("id,name,name\n001,Alpha,Beta\n", "People"),
    ).toThrow(/duplicate column/i);
  });

  it("fails on empty column name", () => {
    expect(() =>
      parseCsvContent(",name\n001,Alpha\n", "People"),
    ).toThrow(/empty column/i);
  });

  it("fails on inconsistent row width", () => {
    expect(() =>
      parseCsvContent("id,name\n001,Alpha,Extra\n", "People"),
    ).toThrow(/row 2/i);
  });

  it("supports tab and pipe delimiters without changing string values", () => {
    expect(parseCsvContent("id\tvalue\n001\t 001 \n", "tab").records[0].value).toBe(" 001 ");
    expect(parseCsvContent("id|value\n001|left\n", "pipe").records[0].value).toBe("left");
  });

  it("keeps delimiter-only and quoted empty records while skipping truly blank records", () => {
    const parsed = parseCsvContent("id,value\n1,A\n\n,\n2,B\n", "records");
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records[1]).toEqual({ id: null, value: null });
    expect(() => parseCsvContent("id,value\n1,A\n,\n2,B\n", "ragged")).not.toThrow();
    expect(parseCsvContent('id\n""\n', "single").records).toEqual([{ id: null }]);
  });

  it("preserves header strings, whitespace values and prototype-like names", () => {
    const parsed = parseCsvContent(" id ,__proto__\n 001 ,kept\n", "headers");
    expect(parsed.columns).toEqual([" id ", "__proto__"]);
    expect(parsed.records[0][" id "]).toBe(" 001 ");
    expect(parsed.records[0]["__proto__"]).toBe("kept");
  });

  it("reports ragged row ordinals including skipped blank records", () => {
    expect(() => parseCsvContent("id,value\n1,A\n\n2,B,extra\n", "ordinal")).toThrow(/row 4/);
  });
});

describe("Dataset Profiling", () => {
  it("calculates profile metrics accurately", () => {
    const dataset = {
      name: "test",
      columns: ["id", "val"],
      records: [
        { id: "1", val: "A" },
        { id: "2", val: "A" },
        { id: "3", val: null },
      ],
    };
    const profiles = profileDataset(dataset);
    expect(profiles).toHaveLength(2);

    const valProfile = profiles.find((p) => p.column_name === "val")!;
    expect(valProfile.row_count).toBe(3);
    expect(valProfile.non_null_count).toBe(2);
    expect(valProfile.null_percentage).toBe(33.33);
    expect(valProfile.distinct_count).toBe(1);
    expect(valProfile.uniqueness_percentage).toBe(50.0);
    expect(valProfile.sample_values).toEqual(["A"]);
  });
});

describe("Suggestions & Heuristics", () => {
  it("scores field pairs using domain aliases and token similarities", () => {
    expect(scoreFieldPair("first_name", "given_name")).toBe(0.92);
    expect(scoreFieldPair("company", "company_code")).toBe(0.85);
    expect(scoreFieldPair("person_id", "person_id")).toBe(1.0);
  });

  it("suggests confident identity candidate", () => {
    const left = {
      name: "left",
      columns: ["person_id", "name"],
      records: [
        { person_id: "001", name: "Alice" },
        { person_id: "002", name: "Bob" },
      ],
    };
    const right = {
      name: "right",
      columns: ["employee_number", "given_name"],
      records: [
        { employee_number: "001", given_name: "Alice" },
        { employee_number: "002", given_name: "Bob" },
      ],
    };

    const suggestion = suggestIdentity(left, right);
    expect(suggestion.left_column).toBe("person_id");
    expect(suggestion.right_column).toBe("employee_number");
    expect(suggestion.confident).toBe(true);
  });

  it("suggests field mappings excluding identity", () => {
    const suggestions = suggestFieldMappings(
      ["person_id", "first_name", "last_name"],
      ["employee_number", "given_name", "surname"],
      {
        excludedLeft: new Set(["person_id"]),
        excludedRight: new Set(["employee_number"]),
      },
    );

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].left_column).toBe("first_name");
    expect(suggestions[0].right_column).toBe("given_name");
    expect(suggestions[1].left_column).toBe("last_name");
    expect(suggestions[1].right_column).toBe("surname");
  });
});

describe("Observed Pair Analysis", () => {
  it("calculates frequency and consistency of mapped values", () => {
    const left = {
      name: "left",
      columns: ["id", "code"],
      records: [
        { id: "1", code: "DE01" },
        { id: "2", code: "DE01" },
      ],
    };
    const right = {
      name: "right",
      columns: ["id", "company"],
      records: [
        { id: "1", company: "1000" },
        { id: "2", company: "1000" },
      ],
    };

    const evidence = analyzeObservedPairs(left, right, {
      left_identity: "id",
      right_identity: "id",
      left_field: "code",
      right_field: "company",
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0].left_value).toBe("DE01");
    expect(evidence[0].right_value).toBe("1000");
    expect(evidence[0].count).toBe(2);
    expect(evidence[0].consistency_percentage).toBe(100.0);
    expect(evidence[0].suggested).toBe(true);
  });
});

describe("Contract Builder & Results Analysis & Exports", () => {
  it("accepts prototype-like canonical names", () => {
    const contract = buildContract({
      contract_name: "mapping", left_name: "a", right_name: "b",
      left_identity: "id", right_identity: "id",
      fields: [{ left_column: "status", right_column: "status", mode: "Value mapping", value_mappings: [
        { canonical_value: "constructor", left_values: ["A"], right_values: ["X"] },
      ] }],
    });
    expect(Object.keys(contract.valueMappings.field_1_status!)).toContain("constructor");
  });

  it("orchestrates full pipeline, analysis, and exports", () => {
    const contract = buildContract({
      contract_name: "test_run",
      left_name: "hr",
      right_name: "pay",
      left_identity: "id",
      right_identity: "id",
      fields: [
        {
          left_column: "status",
          right_column: "status",
          mode: "Exact",
        },
      ],
    });

    const left = {
      name: "hr",
      columns: ["id", "status"],
      records: [
        { id: "1", status: "Active" },
        { id: "2", status: "Terminated" },
      ],
    };
    const right = {
      name: "pay",
      columns: ["id", "status"],
      records: [
        { id: "1", status: "Active" },
        { id: "2", status: "Active" },
      ],
    };

    const engine = new ReconciliationEngine();
    const result = engine.reconcile({ contract, leftDataset: left, rightDataset: right });

    const summary = computeResultsSummary(result);
    expect(summary.metrics.matched_employees).toBe(2);
    expect(summary.metrics.field_matches).toBe(1);
    expect(summary.metrics.field_discrepancies).toBe(1);

    const byField = aggregateMismatchesByField(result);
    expect(byField).toHaveLength(1);
    expect(byField[0].mismatch_count).toBe(1);

    const byPair = aggregateMismatchesByPair(result, { fieldName: "status" });
    expect(byPair).toHaveLength(1);
    expect(byPair[0].left_value).toBe("Terminated");
    expect(byPair[0].right_value).toBe("Active");

    const fullCsv = generateReconciliationCsv(result);
    expect(fullCsv).toContain("record_type,identity,field_name");
    expect(fullCsv).toContain("Terminated");

    const mismatchesCsv = generateReconciliationCsv(result, { mismatchesOnly: true });
    expect(mismatchesCsv).toContain("Terminated");

    const json = generateReconciliationJson(contract, result);
    const parsed = JSON.parse(json);
    expect(parsed.contract_name).toBe("test_run");
    expect(parsed.identity_summary.MATCHED).toBe(2);
    expect(parsed.field_comparison_summary.MISMATCH).toBe(1);
  });
});
