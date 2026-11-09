import { AppError } from "../core/errors.ts";

export const EXPORT_PICKER_ID = "hris-reconcile-export";

export interface SavePickerOptions {
  suggestedName: string;
  id: string;
}

export interface SaveFileWriter {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface SaveFileHandle {
  createWritable(): Promise<SaveFileWriter>;
}

export interface SaveFileEnvironment {
  showSaveFilePicker?: (options: SavePickerOptions) => Promise<SaveFileHandle>;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  download(url: string, filename: string): void;
  defer(callback: () => void): void;
}

export type SaveResult = "saved" | "cancelled";

const pendingDownloads = new Set<string>();

function browserEnvironment(): SaveFileEnvironment {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: SavePickerOptions) => Promise<SaveFileHandle>;
  }).showSaveFilePicker;

  return {
    ...(typeof picker === "function" ? { showSaveFilePicker: (options) => picker.call(window, options) } : {}),
    createObjectURL(blob) {
      const url = URL.createObjectURL(blob);
      pendingDownloads.add(url);
      return url;
    },
    revokeObjectURL(url) {
      URL.revokeObjectURL(url);
      pendingDownloads.delete(url);
    },
    download(url, filename) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
    defer(callback) {
      window.setTimeout(callback, 30_000);
    },
  };
}

function exportWriteError(error: unknown): AppError {
  const reason = error instanceof Error ? error.message : String(error);
  return Object.assign(
    new AppError("EXPORT_WRITE_FAILED", `the export could not be saved: ${reason}`),
    { cause: error },
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export async function saveBlob(
  blob: Blob,
  filename: string,
  env: SaveFileEnvironment = browserEnvironment(),
): Promise<SaveResult> {
  if (env.showSaveFilePicker) {
    let handle: SaveFileHandle;
    try {
      handle = await env.showSaveFilePicker({ suggestedName: filename, id: EXPORT_PICKER_ID });
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
      throw exportWriteError(error);
    }

    let writer: SaveFileWriter | undefined;
    try {
      writer = await handle.createWritable();
      await writer.write(blob);
      await writer.close();
      return "saved";
    } catch (error) {
      try {
        await writer?.abort?.();
      } catch {
        // Keep the original write error for the user-facing error display.
      }
      throw exportWriteError(error);
    }
  }

  let url: string | undefined;
  try {
    url = env.createObjectURL(blob);
    env.download(url, filename);
    env.defer(() => env.revokeObjectURL(url!));
    return "saved";
  } catch (error) {
    if (url) env.revokeObjectURL(url);
    throw exportWriteError(error);
  }
}

export function revokePendingDownloads(): void {
  for (const url of pendingDownloads) URL.revokeObjectURL(url);
  pendingDownloads.clear();
}
