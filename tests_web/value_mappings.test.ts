import { describe, expect, it } from "vitest";
import { buildContract, ValueMappingSelection } from "../src/web/core/contract_builder";
import { MappingResolver } from "../src/web/core/mapping";
import { ReconciliationEngine } from "../src/web/core/reconciliation";
import { Dataset } from "../src/web/core/types";

function contractFor(rows: ValueMappingSelection[]) {
  return buildContract({
    contract_name: "mapping", left_name: "a", right_name: "b",
    left_identity: "id", right_identity: "id",
    fields: [{ left_column: "status", right_column: "status", mode: "Value mapping", value_mappings: rows }],
  });
}
const mappingOf = (rows: ValueMappingSelection[]) => contractFor(rows).valueMappings.field_1_status;
const row = (canonical_value: string, left: string, right: string): ValueMappingSelection =>
  ({ canonical_value, left_values: [left], right_values: [right] });

describe("grouped value mappings", () => {
  it("groups N:1 rows that share a canonical value into one entry", () => {
    expect(mappingOf([row("FULL", "FT", "Full"), row("FULL", "F", "Full")])).toEqual({
      FULL: { left: ["FT", "F"], right: ["Full"] },
    });
  });

  it("groups 1:N rows that share a canonical value into one entry", () => {
    expect(mappingOf([row("FULL", "FT", "Full"), row("FULL", "FT", "Full time")])).toEqual({
      FULL: { left: ["FT"], right: ["Full", "Full time"] },
    });
  });

  it("keeps separate canonical entries in first-seen order", () => {
    const mapping = mappingOf([row("PART", "PT", "Part"), row("FULL", "FT", "Full"), row("PART", "P", "Part")]);
    expect(Object.keys(mapping)).toEqual(["PART", "FULL"]);
    expect(mapping.PART).toEqual({ left: ["PT", "P"], right: ["Part"] });
  });

  it("rejects an alias that resolves to different canonical values", () => {
    expect(() => mappingOf([row("ONE", "A", "X"), row("TWO", "A", "Y")]))
      .toThrow(/ambiguous left alias 'A' between canonical entries 'ONE' and 'TWO'/);
    expect(() => mappingOf([row("ONE", "A", "X"), row("TWO", "B", "X")]))
      .toThrow(/ambiguous right alias 'X' between canonical entries 'ONE' and 'TWO'/);
  });

  it("deduplicates identical rows and repeated aliases within one row", () => {
    expect(mappingOf([row("ONE", "A", "X"), row("ONE", "A", "X")])).toEqual({ ONE: { left: ["A"], right: ["X"] } });
    expect(mappingOf([{ canonical_value: "ONE", left_values: ["A", "A"], right_values: ["X"] }]))
      .toEqual({ ONE: { left: ["A"], right: ["X"] } });
  });

  it("accepts a repeated alias inside one entry in a hand-written mapping", () => {
    const resolver = new MappingResolver({ ONE: { left: ["A", "A"], right: ["X"] } });
    expect(resolver.resolve("A", "left").canonicalValue).toBe("ONE");
  });

  it("reconciles N:1 mappings as mapped matches", () => {
    const contract = contractFor([row("FULL", "FT", "Full"), row("FULL", "F", "Full")]);
    const left: Dataset = { name: "a", columns: ["id", "status"], records: [{ id: "1", status: "FT" }, { id: "2", status: "F" }] };
    const right: Dataset = { name: "b", columns: ["id", "status"], records: [{ id: "1", status: "Full" }, { id: "2", status: "Full" }] };
    const result = new ReconciliationEngine().reconcile({ contract, leftDataset: left, rightDataset: right });
    expect(result.fieldResults.map((item) => [item.status, item.leftCanonicalValue])).toEqual([
      ["match_mapped", "FULL"], ["match_mapped", "FULL"],
    ]);
  });
});
