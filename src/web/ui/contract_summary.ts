import { fieldMode } from "../core/contract_document";
import { ReconciliationContract } from "../core/types";

// A contract can pre-fill the wizard only if every field is a wizard mode.
export function canPrefillWizard(contract: ReconciliationContract): boolean {
  return contract.fields.every((field) => fieldMode(field) !== "Custom");
}

export interface ContractSummary {
  name: string;
  identity: string;
  fields: Array<{ name: string; columns: string; mode: string; normalizers: string; mapping: string }>;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Read-only description of a contract, for contracts the wizard cannot edit.
export function contractSummary(contract: ReconciliationContract): ContractSummary {
  const identityNormalizers = contract.identity.normalize ?? [];
  return {
    name: contract.name,
    identity: `${contract.identity.left} ↔ ${contract.identity.right} (${identityNormalizers.length ? `normalized: ${identityNormalizers.join(", ")}` : "exact"})`,
    fields: contract.fields.map((field) => {
      let mapping = "—";
      if (field.valueMapping) {
        const entries = Object.values(contract.valueMappings[field.valueMapping] ?? {});
        const left = new Set(entries.flatMap((entry) => entry.left)).size;
        const right = new Set(entries.flatMap((entry) => entry.right)).size;
        mapping = `${field.valueMapping}: ${count(entries.length, "canonical value")}, ${count(left, "Dataset A value")}, ${count(right, "Dataset B value")}`;
      }
      return {
        name: field.name,
        columns: `${field.left} ↔ ${field.right}`,
        mode: fieldMode(field),
        normalizers: field.normalize.length ? field.normalize.join(", ") : "—",
        mapping,
      };
    }),
  };
}
