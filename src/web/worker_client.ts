import ReconciliationWorker from "./reconciliation.worker?worker&inline";
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

let worker: Worker | null = null;
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
      error?: string;
    };
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (request.sessionGeneration !== message.sessionGeneration) return;
    if (message.type !== request.responseType) {
      request.reject(new Error(message.error || "reconciliation worker failed"));
    } else if (request.responseType === "parse-result" && message.payload) {
      request.resolve(message.payload);
    } else {
      request.resolve(message.payload);
    }
  });
  instance.addEventListener("error", (event) => {
    failPending(new Error(event.message || "processing worker stopped unexpectedly"));
    instance.terminate();
    if (worker === instance) worker = null;
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
      reject(error instanceof Error ? error : new Error(String(error)));
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
  sessionGeneration: number;
}): Promise<{ summary: DatasetSummary; profiles: ColumnProfile[] }> {
  const { sessionGeneration, ...payload } = options;
  return requestWorker("parse", payload, sessionGeneration, [options.content]);
}

export function terminateReconciliationWorker(): void {
  worker?.terminate();
  worker = null;
  failPending(new Error("session cleared while processing was running"));
}
