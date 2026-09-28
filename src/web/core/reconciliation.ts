import { compareFieldWithResolver } from "./comparator";
import { MappingResolver, normalizedResolver } from "./mapping";
import { reconcileIdentities } from "./identity";
import {
  Dataset,
  DatasetStatistics,
  FieldComparisonResult,
  ReconciliationContract,
  ReconciliationResult,
} from "./types";

function validateRequiredColumns(dataset: Dataset, required: Set<string>): void {
  const missing = Array.from(required).filter((col) => !dataset.columns.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `dataset '${dataset.name}' missing required columns: ${missing.sort().join(", ")}`,
    );
  }
}

function getStatistics(dataset: Dataset): DatasetStatistics {
  return {
    name: dataset.name,
    recordCount: dataset.records.length,
    columnCount: dataset.columns.length,
  };
}

export class ReconciliationEngine {
  reconcile(options: {
    contract: ReconciliationContract;
    leftDataset: Dataset;
    rightDataset: Dataset;
  }): ReconciliationResult {
    const { contract, leftDataset, rightDataset } = options;

    const leftRequired = new Set<string>([
      contract.identity.left,
      ...contract.fields.map((f) => f.left),
    ]);
    const rightRequired = new Set<string>([
      contract.identity.right,
      ...contract.fields.map((f) => f.right),
    ]);

    validateRequiredColumns(leftDataset, leftRequired);
    validateRequiredColumns(rightDataset, rightRequired);

    const mappingResolvers = new Map<object, MappingResolver>();
    for (const field of contract.fields) {
      if (!field.valueMapping) continue;
      const mapping = contract.valueMappings[field.valueMapping];
      if (!mapping) throw new Error(`value mapping '${field.valueMapping}' not found`);
      mappingResolvers.set(
        field,
        normalizedResolver(field.valueMapping, mapping, field.normalize),
      );
    }

    const identityResults = reconcileIdentities(leftDataset, rightDataset, {
      leftKey: contract.identity.left,
      rightKey: contract.identity.right,
    });

    const fieldResults: FieldComparisonResult[] = [];

    for (const identityResult of identityResults) {
      if (identityResult.status !== "matched") {
        continue;
      }
      if (!identityResult.leftRecord || !identityResult.rightRecord) {
        throw new Error("matched identity must contain both records");
      }

      for (const field of contract.fields) {
        fieldResults.push(
          compareFieldWithResolver({
            identity: identityResult.identity,
            leftRecord: identityResult.leftRecord,
            rightRecord: identityResult.rightRecord,
            field,
            valueMappings: contract.valueMappings,
          }, mappingResolvers.get(field)),
        );
      }
    }

    return {
      leftDataset: getStatistics(leftDataset),
      rightDataset: getStatistics(rightDataset),
      identityResults,
      fieldResults,
    };
  }
}
