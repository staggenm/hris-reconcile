import { AppError, serializeError } from "./core/errors";
import { checkContractFileSize, checkFileSize } from "./core/limits";
import { ReconciliationEngine } from "./core/reconciliation";
import { Dataset, DatasetSummary, IdentityNormalizerName, ReconciliationContract } from "./core/types";
import { CsvEncoding, parseCsvContent } from "./analysis/csv";
import { DatasetAnalysis } from "./analysis/dataset_analysis";
import { suggestIdentity } from "./analysis/suggestions";
import { suggestComparisonModes, suggestFieldPairs, suggestIdentityOptions } from "./analysis/smart_defaults";
import { fixHints, queryRows, ResultIndex, RowQuery } from "./analysis/result_rows";
import { buildContract, WizardConfiguration } from "./core/contract_builder";
import { parseContractDocument, serializeContract, validateContractColumns, WizardState, wizardStateFromContract } from "./core/contract_document";
import { canPrefillWizard, contractSummary, ContractSummary } from "./ui/contract_summary";
import { analyzeObservedPairs } from "./analysis/mapping_analysis";
import { aggregateMismatchesByField, aggregateMismatchesByPair, computeResultsSummary } from "./analysis/results_analysis";
import { buildReportMetadata, csvChunks, exportBlob, jsonChunks, SourceInfo } from "./core/export";
import { comparisonCsvChunks, differencesCsvChunks, htmlReportChunks, summaryText } from "./core/readable_export";
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
export type ExportFormat =
  | "differences.csv" | "comparison.csv" | "report.html" | "summary.txt"
  | "full.csv" | "mismatches.csv" | "report.json";

interface ResultRequest extends BaseRequest {
  type: "pairs" | "result-rows" | "export" | "suggest-identity" | "identity-options" | "suggest-modes" | "mapping-evidence";
  leftColumn?: string;
  rightColumn?: string;
  leftIdentity?: string;
  rightIdentity?: string;
  identityNormalize?: IdentityNormalizerName[];
  leftField?: string;
  rightField?: string;
  fields?: Array<{ left_column: string; right_column: string }>;
  fieldName?: string;
  query?: RowQuery;
  page?: number;
  pageSize?: number;
  format?: ExportFormat;
  resultId?: number;
}

// Contract logic runs here, so the normalizers and the casefold table never
// load on the main thread.
interface ContractRequest extends BaseRequest {
  type: "suggest-fields" | "build-contract" | "import-contract" | "serialize-contract";
  leftIdentity?: string;
  rightIdentity?: string;
  identityNormalize?: IdentityNormalizerName[];
  configuration?: WizardConfiguration;
  text?: string;
  fileName?: string;
  contract?: ReconciliationContract;
}

export interface ImportedContract {
  contract: ReconciliationContract;
  // Present when the wizard can represent the contract.
  wizard: WizardState | null;
  // Present when it cannot (Custom normalizers).
  summary: ContractSummary | null;
}

type WorkerRequest = ReconcileRequest | ParseRequest | ResultRequest | ContractRequest;
let latestResult: ReconciliationResult | null = null;
let latestIndex: ResultIndex | null = null;
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
      latestIndex = null;
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
    if (request.type === "suggest-fields" || request.type === "build-contract" || request.type === "import-contract" || request.type === "serialize-contract") {
      let payload: unknown;
      if (request.type === "suggest-fields") {
        payload = suggestFieldPairs(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), {
          leftIdentity: request.leftIdentity ?? "", rightIdentity: request.rightIdentity ?? "", identityNormalize: request.identityNormalize,
        });
      } else if (request.type === "build-contract") {
        payload = buildContract(request.configuration!);
      } else if (request.type === "serialize-contract") {
        payload = `${JSON.stringify(serializeContract(request.contract!), null, 2)}\n`;
      } else {
        // The main thread checks the file size before reading; this guards the worker itself.
        checkContractFileSize(request.fileName ?? "settings", (request.text ?? "").length);
        let input: unknown;
        try {
          input = JSON.parse(request.text ?? "");
        } catch {
          throw new AppError("CONTRACT_INVALID", `'${request.fileName}' is not valid JSON`);
        }
        const contract = parseContractDocument(input);
        validateContractColumns(contract, getDataset(request.sessionGeneration, "left").columns, getDataset(request.sessionGeneration, "right").columns);
        const imported: ImportedContract = canPrefillWizard(contract)
          ? { contract, wizard: wizardStateFromContract(contract), summary: null }
          : { contract, wizard: null, summary: contractSummary(contract) };
        payload = imported;
      }
      self.postMessage({ type: `${request.type}-result`, requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload });
      return;
    }
    if (request.type === "suggest-identity") {
      self.postMessage({ type: "suggest-identity-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: { ...suggestIdentity(getAnalysis(request.sessionGeneration, "left"), getAnalysis(request.sessionGeneration, "right")), candidates: undefined } });
      return;
    }
    if (request.type === "identity-options") {
      const payload = suggestIdentityOptions(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), request.leftColumn ?? "", request.rightColumn ?? "");
      self.postMessage({ type: "identity-options-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload });
      return;
    }
    if (request.type === "suggest-modes") {
      const payload = suggestComparisonModes(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), {
        leftIdentity: request.leftIdentity ?? "", rightIdentity: request.rightIdentity ?? "",
        identityNormalize: request.identityNormalize, fields: request.fields ?? [],
      });
      self.postMessage({ type: "suggest-modes-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload });
      return;
    }
    if (request.type === "mapping-evidence") {
      self.postMessage({ type: "mapping-evidence-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: analyzeObservedPairs(getDataset(request.sessionGeneration, "left"), getDataset(request.sessionGeneration, "right"), { left_identity: request.leftIdentity ?? "", right_identity: request.rightIdentity ?? "", identity_normalize: request.identityNormalize, left_field: request.leftField ?? "", right_field: request.rightField ?? "" }) });
      return;
    }
    if (request.type === "reconcile") {
      const leftDataset = getDataset(request.sessionGeneration, "left");
      const rightDataset = getDataset(request.sessionGeneration, "right");
      leftDataset.name = request.contract.left.name;
      rightDataset.name = request.contract.right.name;
      const result = new ReconciliationEngine().reconcile({ contract: request.contract, leftDataset, rightDataset });
      latestResult = result;
      latestContract = request.contract;
      latestIndex = new ResultIndex(request.contract, result);
      latestResultId++;
      const summary = computeResultsSummary(result);
      const dashboard = {
        summary,
        rows: latestIndex.counts,
        fields: aggregateMismatchesByField(result),
        hints: fixHints(request.contract, result),
        matchingCount: summary.metrics.field_matches,
        resultId: latestResultId,
      };
      self.postMessage({ type: "reconcile-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: dashboard });
      return;
    }
    if (!latestResult || !latestIndex || !latestContract) throw new AppError("SESSION_STATE", "run reconciliation first");
    if ((request as ResultRequest).resultId !== latestResultId) throw new AppError("SESSION_STATE", "results changed; run reconciliation again");
    if (request.type === "pairs") {
      const rows = aggregateMismatchesByPair(latestResult, { fieldName: request.fieldName ?? "" });
      self.postMessage({ type: "pairs-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: pageRows(rows, request.page ?? 0, request.pageSize ?? 100) });
      return;
    }
    if (request.type === "result-rows") {
      self.postMessage({ type: "result-rows-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: queryRows(latestIndex, request.query!) });
      return;
    }
    if (request.type === "export") {
      // Chunks → Blob; posting a Blob shares it by reference instead of copying a string.
      const metadata = () => buildReportMetadata({
        sources: { left: getSource(request.sessionGeneration, "left"), right: getSource(request.sessionGeneration, "right") },
      });
      const csv = "text/csv;charset=utf-8";
      let blob: Blob;
      switch (request.format) {
        case "differences.csv": blob = exportBlob(differencesCsvChunks(latestIndex), csv); break;
        case "comparison.csv": blob = exportBlob(comparisonCsvChunks(latestIndex), csv); break;
        case "report.html": blob = exportBlob(htmlReportChunks(latestIndex, metadata()), "text/html;charset=utf-8"); break;
        case "summary.txt": blob = new Blob([summaryText(latestIndex, metadata())], { type: "text/plain;charset=utf-8" }); break;
        case "report.json": blob = exportBlob(jsonChunks(latestContract, latestResult, metadata()), "application/json;charset=utf-8"); break;
        case "full.csv":
        case "mismatches.csv": blob = exportBlob(csvChunks(latestResult, { mismatchesOnly: request.format === "mismatches.csv" }), csv); break;
        default: throw new AppError("WORKER_PROTOCOL", "unknown export format");
      }
      self.postMessage({ type: "export-result", requestId: request.requestId, sessionGeneration: request.sessionGeneration, payload: blob });
      return;
    }
    throw new AppError("WORKER_PROTOCOL", "unknown worker operation");
  } catch (error) {
    self.postMessage({
      type: request.type === "parse" ? "parse-error" : "reconcile-error",
      requestId: request.requestId,
      sessionGeneration: request.sessionGeneration,
      error: serializeError(error),
    });
  }
});
