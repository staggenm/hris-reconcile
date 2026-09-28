import { AppError, deserializeError, SerializedError } from "./core/errors";
import ReconciliationWorker from "./reconciliation.worker?worker&inline";
import { CsvEncoding } from "./analysis/csv";
import { ColumnProfile } from "./analysis/profiling";
import { FieldMismatchSummary, ResultsSummary } from "./analysis/results_analysis";
import { DatasetSummary, ReconciliationContract } from "./core/types";

interface PendingRequest {
  sessionGeneration: number;
  responseType: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export interface ReconciliationDashboard {
  summary: ResultsSummary;
  fields: FieldMismatchSummary[];
  matchingCount: number;
  resultId: number;
}

export interface WorkerPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const WORKER_CRASHED_MESSAGE = "Processing stopped (likely memory). Session reset.";

let worker: Worker | null = null;
let crashListener: ((error: AppError) => void) | null = null;

// Called once per crash, after pending requests have been rejected.
export function onWorkerCrash(listener: (error: AppError) => void): void {
  crashListener = listener;
}
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function failPending(error: Error): void {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new ReconciliationWorker();
  instance.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      type: string;
      requestId: number;
      sessionGeneration: number;
      payload?: unknown;
      summary?: DatasetSummary;
      error?: SerializedError;
    };
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (request.sessionGeneration !== message.sessionGeneration) return;
    if (message.type !== request.responseType) {
      request.reject(deserializeError(message.error ?? { message: "reconciliation worker failed", code: "UNKNOWN" }));
    } else if (request.responseType === "parse-result" && message.payload) {
      request.resolve(message.payload);
    } else {
      request.resolve(message.payload);
    }
  });
  // An uncaught worker error (typically out of memory) loses all worker state:
  // datasets, profiles, and results. Drop the worker and let the UI reset.
  instance.addEventListener("error", () => {
    instance.terminate();
    if (worker !== instance) return;
    worker = null;
    const error = new AppError("WORKER_CRASHED", WORKER_CRASHED_MESSAGE);
    failPending(error);
    crashListener?.(error);
  });
  worker = instance;
  return instance;
}

function requestWorker<T>(type: string, options: Record<string, unknown>, sessionGeneration: number, transfer: Transferable[] = []): Promise<T> {
  const instance = getWorker();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      sessionGeneration,
      responseType: `${type}-result`,
      resolve: (value) => resolve(value as T),
      reject,
    });
    try {
      instance.postMessage({ type, requestId, sessionGeneration, ...options }, transfer);
    } catch (error) {
      pending.delete(requestId);
      reject(error instanceof Error ? error : new AppError("UNKNOWN", String(error)));
    }
  });
}

export function reconcileInWorker(options: {
  contract: ReconciliationContract;
  sessionGeneration: number;
}): Promise<ReconciliationDashboard> {
  const { sessionGeneration, ...payload } = options;
  return requestWorker("reconcile", payload, sessionGeneration);
}

export function queryWorker<T>(type: "pairs" | "details" | "matching-details" | "export" | "suggest-identity" | "score-identity" | "mapping-evidence", options: Record<string, unknown>, sessionGeneration: number): Promise<T> {
  return requestWorker(type, options, sessionGeneration);
}

export function parseAndProfileInWorker(options: {
  content: ArrayBuffer;
  name: string;
  side: "left" | "right";
  encoding: CsvEncoding;
  sessionGeneration: number;
}): Promise<{ summary: DatasetSummary; profiles: ColumnProfile[] }> {
  const { sessionGeneration, ...payload } = options;
  return requestWorker("parse", payload, sessionGeneration, [options.content]);
}

export function terminateReconciliationWorker(): void {
  worker?.terminate();
  worker = null;
  failPending(new AppError("SESSION_STATE", "session cleared while processing was running"));
}
