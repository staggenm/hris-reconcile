import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  lowercase,
  normalize,
  NORMALIZERS,
  trim,
  uppercase,
} from "../src/web/core/normalization";
import { reconcileIdentities } from "../src/web/core/identity";
import { MappingResolver } from "../src/web/core/mapping";
import { compareField } from "../src/web/core/comparator";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset, FieldConfig, MappingValues, NormalizerName } from "../src/web/core/types";

describe("Normalization", () => {
  it("trims whitespace", () => {
    expect(trim("  Alpha  ")).toBe("Alpha");
  });

  it("converts to uppercase with Unicode support", () => {
    expect(uppercase("Alpha ß")).toBe("ALPHA SS");
  });

  it("converts to lowercase", () => {
    expect(lowercase("Alpha")).toBe("alpha");
  });

  it("casefolds Straße to strasse with full Unicode case folding", () => {
    expect(NORMALIZERS.resolve("casefold")("Straße")).toBe("strasse");
    expect(NORMALIZERS.resolve("casefold")("ẞ ı İ ΟΣ ς ﬃ")).toBe("ss ı i\u0307 οσ σ ffi");
    expect(NORMALIZERS.resolve("casefold")("Ꭰ ꭰ 𐐀")).toBe("Ꭰ Ꭰ 𐐨");
  });

  it("collapses whitespace", () => {
    expect(collapseWhitespace("Alpha\t  Beta\nGamma")).toBe("Alpha Beta Gamma");
    expect(collapseWhitespace("A\u0085B\u001cC\ufeffD")).toBe("A B C\ufeffD");
    expect(trim("\u0085 Alpha \u001c")).toBe("Alpha");
  });

  it("chains normalizations", () => {
    const names = ["trim", "collapse_whitespace", "casefold"];
    expect(normalize("  Alpha   BETA ", names)).toBe("alpha beta");
  });

  it("throws on unknown normalizer", () => {
    expect(() => NORMALIZERS.resolve("unknown")).toThrow(/unknown/);
  });
});

describe("Identity Resolution", () => {
  function makeDataset(name: string, key: string, identities: (string | null)[]): Dataset {
    return {
      name,
      columns: [key],
      records: identities.map((id) => ({ [key]: id })),
    };
  }

  function getStatuses(leftIds: string[], rightIds: string[]): Record<string, string> {
    const results = reconcileIdentities(
      makeDataset("left", "person_id", leftIds),
      makeDataset("right", "employee_number", rightIds),
      { leftKey: "person_id", rightKey: "employee_number" },
    );
    const map: Record<string, string> = {};
    for (const r of results) {
      map[String(r.identity)] = r.status;
    }
    return map;
  }

  it("matches identical records", () => {
    expect(getStatuses(["001"], ["001"])["001"]).toBe("matched");
  });

  it("identifies missing left", () => {
    expect(getStatuses([], ["001"])["001"]).toBe("missing_left");
  });

  it("identifies missing right", () => {
    expect(getStatuses(["001"], [])["001"]).toBe("missing_right");
  });

  it("flags duplicate identity and does not pair", () => {
    const results = reconcileIdentities(
      makeDataset("left", "person_id", ["001", "001"]),
      makeDataset("right", "employee_number", ["001"]),
      { leftKey: "person_id", rightKey: "employee_number" },
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("duplicate_left");
    expect(results[0].leftRecord).toBeUndefined();
    expect(results[0].rightRecord).toBeUndefined();
  });

  it("reports duplicates on both sides", () => {
    const results = reconcileIdentities(
      makeDataset("left", "person_id", ["001", "001"]),
      makeDataset("right", "employee_number", ["001", "001"]),
      { leftKey: "person_id", rightKey: "employee_number" },
    );
    expect(results.map((r) => r.status)).toEqual(["duplicate_left", "duplicate_right"]);
  });
});

describe("Mapping Resolver", () => {
  const companyMapping: Record<string, MappingValues> = {
    DE_GERMANY: { left: ["DE01"], right: ["1000"] },
    CH_SWITZERLAND: { left: ["CH01"], right: ["2000"] },
  };

  it("resolves left value", () => {
    const resolver = new MappingResolver(companyMapping);
    const res = resolver.resolve("DE01", "left");
    expect(res.status).toBe("mapped");
    expect(res.canonicalValue).toBe("DE_GERMANY");
  });

  it("resolves right value", () => {
    const resolver = new MappingResolver(companyMapping);
    const res = resolver.resolve("1000", "right");
    expect(res.status).toBe("mapped");
    expect(res.canonicalValue).toBe("DE_GERMANY");
  });

  it("marks unknown value as unmapped", () => {
    const resolver = new MappingResolver(companyMapping);
    const res = resolver.resolve("UNKNOWN", "left");
    expect(res.status).toBe("unmapped");
    expect(res.canonicalValue).toBeNull();
  });

  it("keeps null as null", () => {
    const resolver = new MappingResolver(companyMapping);
    const res = resolver.resolve(null, "right");
    expect(res.status).toBe("null");
    expect(res.canonicalValue).toBeNull();
  });
});

describe("Field Comparator", () => {
  const COMPANY_MAPPING: Record<string, MappingValues> = {
    DE_GERMANY: { left: ["DE01"], right: ["1000"] },
    CH_SWITZERLAND: { left: ["CH01"], right: ["2000"] },
  };

  function compare(
    left: string | null,
    right: string | null,
    options: { normalize?: ("trim" | "uppercase" | "lowercase" | "casefold" | "collapse_whitespace")[]; mapped?: boolean } = {},
  ) {
    const field: FieldConfig = {
      name: options.mapped ? "company" : "name",
      left: "left_value",
      right: "right_value",
      normalize: options.normalize || [],
      valueMapping: options.mapped ? "company" : null,
    };
    const mappings: Record<string, Record<string, MappingValues>> = options.mapped
      ? { company: COMPANY_MAPPING }
      : {};
    return compareField({
      identity: "001",
      leftRecord: { left_value: left },
      rightRecord: { right_value: right },
      field,
      valueMappings: mappings,
    });
  }

  it("evaluates exact match", () => {
    const res = compare("Alpha", "Alpha");
    expect(res.status).toBe("match_exact");
    expect(res.leftRawValue).toBe("Alpha");
    expect(res.leftNormalizedValue).toBe("Alpha");
  });

  it("evaluates normalized match", () => {
    const res = compare(" Alpha ", "alpha", { normalize: ["trim", "casefold"] });
    expect(res.status).toBe("match_normalized");
    expect(res.leftNormalizedValue).toBe("alpha");
  });

  it("evaluates mapped match", () => {
    const res = compare("DE01", "1000", { mapped: true });
    expect(res.status).toBe("match_mapped");
    expect(res.leftCanonicalValue).toBe("DE_GERMANY");
    expect(res.rightCanonicalValue).toBe("DE_GERMANY");
    expect(res.mappingName).toBe("company");
  });

  it("keeps identical raw values as exact even when mapping mode is enabled", () => {
    const res = compare("SAME", "SAME", { mapped: true });
    expect(res.status).toBe("match_exact");
    expect(res.leftCanonicalValue).toBeNull();
    expect(res.rightCanonicalValue).toBeNull();
  });

  it("evaluates mismatch", () => {
    expect(compare("Alpha", "Beta").status).toBe("mismatch");
  });

  it("evaluates unmapped left", () => {
    expect(compare("UNKNOWN", "1000", { mapped: true }).status).toBe("unmapped_left");
  });

  it("evaluates unmapped right", () => {
    expect(compare("DE01", "9999", { mapped: true }).status).toBe("unmapped_right");
  });

  it("evaluates both null", () => {
    const res = compare(null, null);
    expect(res.status).toBe("both_null");
    expect(res.leftNormalizedValue).toBeNull();
    expect(res.rightCanonicalValue).toBeNull();
  });

  it("evaluates single null statuses", () => {
    expect(compare(null, "Alpha").status).toBe("left_null");
    expect(compare("Alpha", null).status).toBe("right_null");
  });

  it("applies normalization to mapping aliases", () => {
    const res = compare(" de01 ", "1000", {
      normalize: ["trim", "uppercase"],
      mapped: true,
    });
    expect(res.status).toBe("match_mapped");
  });

  it("rejects repeated aliases independent of canonical insertion order", () => {
    const duplicate = {
      ONE: { left: ["A"], right: ["X"] },
      TWO: { left: ["A"], right: ["Y"] },
    };
    expect(() => new MappingResolver(duplicate, "department")).toThrow(/department.*left.*A.*ONE.*TWO/i);
    expect(() => new MappingResolver({ TWO: duplicate.TWO, ONE: duplicate.ONE }, "department")).toThrow(/department.*left.*A/i);
  });

  it("rejects aliases that collide after normalization", () => {
    expect(() => compareField({
      identity: "1", leftRecord: { left_value: "same" }, rightRecord: { right_value: "other" },
      field: { name: "f", left: "left_value", right: "right_value", normalize: ["trim", "casefold"], valueMapping: "m" },
      valueMappings: { m: {
        ONE: { left: [" A"], right: ["X"] },
        TWO: { left: ["a "], right: ["Y"] },
      } },
    })).toThrow(/ambiguous left alias/i);
  });

  it("accepts the same raw spelling once on each opposite side", () => {
    const resolver = new MappingResolver({ ONE: { left: ["A"], right: ["A"] } });
    expect(resolver.resolve("A", "left").canonicalValue).toBe("ONE");
    expect(resolver.resolve("A", "right").canonicalValue).toBe("ONE");
  });
});

describe("Reconciliation Engine", () => {
  it("reconciles end-to-end dataset matching", () => {
    const engine = new ReconciliationEngine();
    const contract = {
      name: "test_reconciliation",
      left: { name: "core_hr" },
      right: { name: "payroll" },
      identity: { left: "person_id", right: "emp_no" },
      fields: [
        {
          name: "first_name",
          left: "first_name",
          right: "given_name",
          normalize: ["trim", "casefold"] as NormalizerName[],
        },
      ],
      valueMappings: {},
    };

    const leftDataset: Dataset = {
      name: "core_hr",
      columns: ["person_id", "first_name"],
      records: [
        { person_id: "001", first_name: " Alice " },
        { person_id: "002", first_name: "Bob" },
      ],
    };

    const rightDataset: Dataset = {
      name: "payroll",
      columns: ["emp_no", "given_name"],
      records: [
        { emp_no: "001", given_name: "alice" },
        { emp_no: "003", given_name: "Charlie" },
      ],
    };

    const result = engine.reconcile({ contract, leftDataset, rightDataset });

    expect(result.identityResults).toHaveLength(3);
    expect(result.identityResults.find((r) => r.identity === "001")?.status).toBe("matched");
    expect(result.identityResults.find((r) => r.identity === "002")?.status).toBe("missing_right");
    expect(result.identityResults.find((r) => r.identity === "003")?.status).toBe("missing_left");

    const comparisons = [...result.fieldResults()];
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].identity).toBe("001");
    expect(comparisons[0].status).toBe("match_normalized");
  });
});
