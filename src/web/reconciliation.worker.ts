import { AppError, serializeError } from "./core/errors";
import { checkFileSize } from "./core/limits";
import { ReconciliationEngine } from "./core/reconciliation";
import { Dataset, DatasetSummary, IdentityNormalizerName, ReconciliationContract } from "./core/types";
import { CsvEncoding, parseCsvContent } from "./analysis/csv";
import { DatasetAnalysis } from "./analysis/dataset_analysis";
import { scoreIdentityPair, suggestIdentity } from "./analysis/suggestions";
import { analyzeObservedPairs } from "./analysis/mapping_analysis";
import { aggregateMismatchesByField, aggregateMismatchesByPair, computeResultsSummary, identityIssuesPage, mismatchDetails, matchingDetailsPage } from "./analysis/results_analysis";
import { buildReportMetadata, csvChunks, exportBlob, jsonChunks, SourceInfo } from "./core/export";
import { sha256Hex } from "./core/sha256";
import { ReconciliationResult } from "./core/types";

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
  fileName: string;
  side: "left" | "right";
  encoding: CsvEncoding;
  content: ArrayBuffer;
}
interface ResultRequest extends BaseRequest {
  type: "pairs" | "details" | "matching-details" | "identity-issues" | "export" | "suggest-identity" | "score-identity" | "mapping-evidence";
  leftColumn?: string;
  rightColumn?: string;
  leftIdentity?: string;
  rightIdentity?: string;
  identityNormalize?: IdentityNormalizerName[];
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
  excelSafe?: boolean;
  resultId?: number;
}

type WorkerRequest = ReconcileRequest | ParseRequest | ResultRequest;
let latestResult: ReconciliationResult | null = null;
let latestContract: ReconciliationContract | null = null;
let latestResultId = 0;
// One cached analysis (dataset + column profiles + value sets) per side per session.
const sessionAnalyses = new Map<number, Partial<Record<"left" | "right", DatasetAnalysis>>>();

function getAnalysis(session: number, side: "left" | "right"): DatasetAnalysis {
  const analysis = sessionAnalyses.get(session)?.[side];
  if (!analysis) throw new AppError("SESSION_STATE", `upload the ${side} dataset first`);
  return analysis;
}

// Source file facts per side per session, for the report metadata.
const sessionSources = new Map<number, Partial<Record<"left" | "right", SourceInfo>>>();

function getSource(session: number, side: "left" | "right"): SourceInfo {
  const source = sessionSources.get(session)?.[side];
  if (!source) throw new AppError("SESSION_STATE", `upload the ${side} dataset first`);
  return source;
}

function getDataset(session: number, side: "left" | "right"): Dataset {
  return getAnalysis(session, side).dataset;
}

function pageRows<T>(rows: T[], page: number, pageSize: number) {
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length, page, pageSize };
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "parse") {
      latestResult = null;
      latestContract = null;
      checkFileSize(request.fileName, request.content.byteLength);
      // Hash the raw bytes before decoding, so the report identifies the exact file.
      const sha256 = await sha256Hex(request.content);
      const dataset = parseCsvContent(request.content, request.name, { encoding: request.encoding });
      const sources = sessionSources.get(request.sessionGeneration) ?? {};
      sources[request.side] = { fileName: request.fileName, encoding: request.encoding, sha256, byteLength: request.content.byteLength };
      sessionSources.set(request.sessionGeneration, sources);
      const analysis = new DatasetAnalysis(dataset);
      const cached = sessionAnalyses.get(request.sessionGeneration) ?? {};
      cached[request.side] = analysis;
      sessionAnalyses.set(request.sessionGeneration, cached);
      const summary: DatasetSummary = {
        name: dataset.name,
        columns: dataset.columns,
        recordCount: dataset.records.length,
        previewRecords: dataset.records.slice(0, 5),
      };
      self.postMessage({
        type: "parse-result", requestId: request.requestId,
        sessionGeneration: request.sessionGeneration,
        payload: { summary, profiles: analysis.profiles() },
      });
      return;
    }
    if (request.type === "suggest-identity") {
      self.postMessage({ type: "suggest-identity-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: suggestIdentity(getAnalysis(request.sessionGeneration, "left"), getAnalysis(request.sessionGeneration, "right")) });
      return;
    }
    if (request.type === "score-identity") {
      self.postMessage({ type: "score-identity-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: scoreIdentityPair(getAnalysis(request.sessionGeneration, "left"), getAnalysis(request.sessionGeneration, "right"), { left_column: request.leftColumn ?? "", right_column: request.rightColumn ?? "" }) });
      return;
    }
    if (request.type === "mapping-evidence") {
      self.postMessage({ type: "mapping-evidence-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: analyzeObservedPairs(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), { left_identity: request.leftIdentity ?? "", right_identity: request.rightIdentity ?? "", identity_normalize: request.identityNormalize, left_field: request.leftField ?? "", right_field: request.rightField ?? "" }) });
      return;
    }
    if (request.type === "pairs") {
      if (!latestResult || !request.fieldName) throw new AppError("SESSION_STATE", "run reconciliation first");
      if (request.resultId !== latestResultId) throw new AppError("SESSION_STATE", "results changed; run reconciliation again");
      const rows = aggregateMismatchesByPair(latestResult, { fieldName: request.fieldName });
      self.postMessage({ type: "pairs-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: pageRows(rows, request.page ?? 0, request.pageSize ?? 100) });
      return;
    }
    if (request.type === "identity-issues") {
      if (!latestResult) throw new AppError("SESSION_STATE", "run reconciliation first");
      if (request.resultId !== latestResultId) throw new AppError("SESSION_STATE", "results changed; run reconciliation again");
      const payload = identityIssuesPage(latestResult, { page: request.page ?? 0, pageSize: request.pageSize ?? 100 });
      self.postMessage({ type: "identity-issues-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload });
      return;
    }
    if (request.type === "details" || request.type === "matching-details") {
      if (!latestResult) throw new AppError("SESSION_STATE", "run reconciliation first");
      if (request.resultId !== latestResultId) throw new AppError("SESSION_STATE", "results changed; run reconciliation again");
      const page = request.page ?? 0;
      const pageSize = request.pageSize ?? 100;
      const payload = request.type === "matching-details"
        ? matchingDetailsPage(latestResult, { page, pageSize })
        : pageRows(mismatchDetails(latestResult, {
          fieldName: request.fieldName ?? "",
          leftValue: request.leftValue, rightValue: request.rightValue,
          filterLeft: request.filterLeft, filterRight: request.filterRight,
        }), page, pageSize);
      self.postMessage({ type: `${request.type}-result`, requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload });
      return;
    }
    if (request.type === "export") {
      if (!latestResult || !latestContract || !request.format) throw new AppError("SESSION_STATE", "run reconciliation first");
      if (request.resultId !== latestResultId) throw new AppError("SESSION_STATE", "results changed; run reconciliation again");
      // Chunks → Blob; posting a Blob shares it by reference instead of copying a string.
      const excelSafe = request.excelSafe ?? true;
      const blob = request.format === "report.json"
        ? exportBlob(jsonChunks(latestContract, latestResult, buildReportMetadata({
          sources: { left: getSource(request.sessionGeneration, "left"), right: getSource(request.sessionGeneration, "right") },
          excelSafe,
        })), "application/json;charset=utf-8")
        : exportBlob(csvChunks(latestResult, { mismatchesOnly: request.format === "mismatches.csv", excelSafe }), "text/csv;charset=utf-8");
      self.postMessage({ type: "export-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: blob });
      return;
    }
    if (request.type !== "reconcile") throw new AppError("WORKER_PROTOCOL", "unknown worker operation");
    const leftDataset = getDataset(request.sessionGeneration, "left");
    const rightDataset = getDataset(request.sessionGeneration, "right");
    leftDataset.name = request.contract.left.name;
    rightDataset.name = request.contract.right.name;
    const result = new ReconciliationEngine().reconcile({ contract: request.contract, leftDataset, rightDataset });
    latestResult = result;
    latestContract = request.contract;
    latestResultId++;
    const summary = computeResultsSummary(result);
    const dashboard = {
      summary,
      fields: aggregateMismatchesByField(result),
      matchingCount: summary.metrics.field_matches,
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
      error: serializeError(error),
    });
  }
});
