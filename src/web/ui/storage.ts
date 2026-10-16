// Remembers the last key columns and per-column choices between sessions.
// Only column names and settings are stored, never data values. Storage can
// be unavailable (private windows, blocked site data), so every access is
// guarded and the app works the same without it.

import type { ComparisonMode, IdentityNormalizerName, ValueFormat } from "../core/types";

const STORAGE_KEY = "hris-reconcile.settings.v1";

export interface RememberedColumn {
  include: boolean;
  mode: ComparisonMode;
  format?: ValueFormat;
  tolerance?: number;
}

export interface RememberedSettings {
  key?: { left: string; right: string; normalize: IdentityNormalizerName[] };
  columns: Record<string, RememberedColumn>;
}

export const pairKey = (left: string, right: string) => JSON.stringify([left, right]);

export function loadRemembered(): RememberedSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as RememberedSettings | null;
    if (parsed && typeof parsed === "object" && parsed.columns && typeof parsed.columns === "object") return parsed;
  } catch {
    // Unavailable or corrupt storage: start fresh.
  }
  return { columns: Object.create(null) as Record<string, RememberedColumn> };
}

export function saveRemembered(settings: RememberedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is a convenience; failing to save changes nothing else.
  }
}
