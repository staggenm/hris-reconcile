import { AppError } from "./errors";
import { checkComparisons, checkDiscrepancies, Limits } from "./limits";
import { emptyFieldCounts, isDiscrepancy } from "./status";
import { compareFieldWithResolver } from "./comparator";
import { compareCodePoints } from "./compare";
import { MappingResolver, normalizedResolver } from "./mapping";
import { reconcileIdentities } from "./identity";
import {
  Dataset,
  DatasetStatistics,
  FieldComparisonResult,
  FieldStatusCounts,
  ReconciliationContract,
  ReconciliationResult,
} from "./types";

function validateRequiredColumns(dataset: Dataset, required: Set<string>): void {
  const missing = Array.from(required).filter((col) => !dataset.columns.includes(col));
  if (missing.length > 0) {
    throw new AppError(
      "COLUMNS_MISSING",
      `dataset '${dataset.name}' missing required columns: ${missing.sort(compareCodePoints).join(", ")}`,
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
    limits?: Limits;
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
    checkComparisons(leftDataset.records.length, rightDataset.records.length, contract.fields.length, options.limits);

    const mappingResolvers = new Map<object, MappingResolver>();
    for (const field of contract.fields) {
      if (!field.valueMapping) continue;
      const mapping = contract.valueMappings[field.valueMapping];
      if (!mapping) throw new AppError("MAPPING_NOT_FOUND", `value mapping '${field.valueMapping}' not found`);
      mappingResolvers.set(
        field,
        normalizedResolver(field.valueMapping, mapping, field.normalize),
      );
    }

    const identityResults = reconcileIdentities(leftDataset, rightDataset, {
      leftKey: contract.identity.left,
      rightKey: contract.identity.right,
      normalize: contract.identity.normalize,
    });

    function* compareAll(): Generator<FieldComparisonResult> {
      for (const identityResult of identityResults) {
        if (identityResult.status !== "matched") {
          continue;
        }
        if (identityResult.identity === null || !identityResult.leftRecord || !identityResult.rightRecord) {
          throw new AppError("INTERNAL", "matched identity must contain both records");
        }
        for (const field of contract.fields) {
          yield compareFieldWithResolver({
            identity: identityResult.identity,
            leftRecord: identityResult.leftRecord,
            rightRecord: identityResult.rightRecord,
            field,
            valueMappings: contract.valueMappings,
          }, mappingResolvers.get(field));
        }
      }
    }

    const fieldCounts = new Map<string, FieldStatusCounts>();
    for (const field of contract.fields) fieldCounts.set(field.name, emptyFieldCounts());
    const discrepancies: FieldComparisonResult[] = [];
    for (const comparison of compareAll()) {
      fieldCounts.get(comparison.fieldName)![comparison.status]++;
      if (isDiscrepancy(comparison)) {
        discrepancies.push(comparison);
        checkDiscrepancies(discrepancies.length, options.limits);
      }
    }

    return {
      leftDataset: getStatistics(leftDataset),
      rightDataset: getStatistics(rightDataset),
      identityResults,
      discrepancies,
      fieldCounts,
      fieldResults: compareAll,
    };
  }
}
