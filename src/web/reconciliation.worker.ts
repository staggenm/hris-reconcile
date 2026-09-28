import { ReconciliationEngine } from "./core/reconciliation";
import { Dataset, DatasetSummary, ReconciliationContract } from "./core/types";
import { parseCsvContent } from "./analysis/csv";
import { profileDataset } from "./analysis/profiling";
import { scoreIdentityPair, suggestIdentity } from "./analysis/suggestions";
import { analyzeObservedPairs } from "./analysis/mapping_analysis";
import { aggregateMismatchesByField, aggregateMismatchesByPair, computeResultsSummary, mismatchDetails, isDiscrepancy } from "./analysis/results_analysis";
import { generateReconciliationCsv, generateReconciliationJson } from "./core/export";
import { FieldComparisonResult, ReconciliationResult } from "./core/types";

interface BaseRequest { requestId: number; sessionGeneration: number }
interface ReconcileRequest extends BaseRequest {
  type: "reconcile";
  requestId: number;
  sessionGeneration: number;
  contract: ReconciliationContract;
  leftDataset: Dataset;
  rightDataset: Dataset;
}
interface ParseRequest extends BaseRequest {
  type: "parse";
  name: string;
  side: "left" | "right";
  content: ArrayBuffer;
}
interface ResultRequest extends BaseRequest {
  type: "pairs" | "details" | "matching-details" | "export" | "suggest-identity" | "score-identity" | "mapping-evidence";
  leftColumn?: string;
  rightColumn?: string;
  leftIdentity?: string;
  rightIdentity?: string;
  leftField?: string;
  rightField?: string;
  fieldName?: string;
  leftValue?: string | null;
  rightValue?: string | null;
  filterLeft?: boolean;
  filterRight?: boolean;
  page?: number;
  pageSize?: number;
  format?: "full.csv" | "mismatches.csv" | "report.json";
  resultId?: number;
}

type WorkerRequest = ReconcileRequest | ParseRequest | ResultRequest;
let latestResult: ReconciliationResult | null = null;
let latestContract: ReconciliationContract | null = null;
let latestResultId = 0;
const sessionDatasets = new Map<number, Partial<Record<"left" | "right", Dataset>>>();

function getDataset(session: number, side: "left" | "right"): Dataset {
  const dataset = sessionDatasets.get(session)?.[side];
  if (!dataset) throw new Error(`upload the ${side} dataset first`);
  return dataset;
}

function pageRows<T>(rows: T[], page: number, pageSize: number) {
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length, page, pageSize };
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "parse") {
      latestResult = null;
      latestContract = null;
      const dataset = parseCsvContent(request.content, request.name);
      const cached = sessionDatasets.get(request.sessionGeneration) ?? {};
      cached[request.side] = dataset;
      sessionDatasets.set(request.sessionGeneration, cached);
      const summary: DatasetSummary = {
        name: dataset.name,
        columns: dataset.columns,
        recordCount: dataset.records.length,
        previewRecords: dataset.records.slice(0, 5),
      };
      self.postMessage({
        type: "parse-result", requestId: request.requestId,
        sessionGeneration: request.sessionGeneration,
        payload: { summary, profiles: profileDataset(dataset) },
      });
      return;
    }
    if (request.type === "suggest-identity") {
      self.postMessage({ type: "suggest-identity-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: suggestIdentity(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right")) });
      return;
    }
    if (request.type === "score-identity") {
      self.postMessage({ type: "score-identity-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: scoreIdentityPair(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), { left_column: request.leftColumn ?? "", right_column: request.rightColumn ?? "" }) });
      return;
    }
    if (request.type === "mapping-evidence") {
      self.postMessage({ type: "mapping-evidence-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: analyzeObservedPairs(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), { left_identity: request.leftIdentity ?? "", right_identity: request.rightIdentity ?? "", left_field: request.leftField ?? "", right_field: request.rightField ?? "" }) });
      return;
    }
    if (request.type === "pairs") {
      if (!latestResult || !request.fieldName) throw new Error("run reconciliation first");
      if (request.resultId !== latestResultId) throw new Error("results changed; run reconciliation again");
      const rows = aggregateMismatchesByPair(latestResult, { fieldName: request.fieldName });
      self.postMessage({ type: "pairs-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: pageRows(rows, request.page ?? 0, request.pageSize ?? 100) });
      return;
    }
    if (request.type === "details" || request.type === "matching-details") {
      if (!latestResult) throw new Error("run reconciliation first");
      if (request.resultId !== latestResultId) throw new Error("results changed; run reconciliation again");
      let rows: FieldComparisonResult[];
      if (request.type === "matching-details") {
        rows = latestResult.fieldResults.filter((row) => ["match_exact", "match_normalized", "match_mapped", "both_null"].includes(row.status));
      } else {
        rows = mismatchDetails(latestResult, {
          fieldName: request.fieldName ?? "",
          leftValue: request.leftValue, rightValue: request.rightValue,
          filterLeft: request.filterLeft, filterRight: request.filterRight,
        });
      }
      self.postMessage({ type: `${request.type}-result`, requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: pageRows(rows, request.page ?? 0, request.pageSize ?? 100) });
      return;
    }
    if (request.type === "export") {
      if (!latestResult || !latestContract || !request.format) throw new Error("run reconciliation first");
      if (request.resultId !== latestResultId) throw new Error("results changed; run reconciliation again");
      const content = request.format === "full.csv" ? generateReconciliationCsv(latestResult) : request.format === "mismatches.csv" ? generateReconciliationCsv(latestResult, { mismatchesOnly: true }) : generateReconciliationJson(latestContract, latestResult);
      self.postMessage({ type: "export-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: content });
      return;
    }
    if (request.type !== "reconcile") throw new Error("unknown worker operation");
    const leftDataset = getDataset(request.sessionGeneration, "left");
    const rightDataset = getDataset(request.sessionGeneration, "right");
    leftDataset.name = request.contract.left.name;
    rightDataset.name = request.contract.right.name;
    const result = new ReconciliationEngine().reconcile({ contract: request.contract, leftDataset, rightDataset });
    latestResult = result;
    latestContract = request.contract;
    latestResultId++;
    const dashboard = {
      summary: computeResultsSummary(result),
      fields: aggregateMismatchesByField(result),
      matchingCount: result.fieldResults.filter((row) => !isDiscrepancy(row)).length,
      resultId: latestResultId,
    };
    self.postMessage({
      type: "reconcile-result",
      requestId: request.requestId,
      sessionGeneration: request.sessionGeneration,
      payload: dashboard,
    });
  } catch (error) {
    self.postMessage({
      type: request.type === "parse" ? "parse-error" : "reconcile-error",
      requestId: request.requestId,
      sessionGeneration: request.sessionGeneration,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
