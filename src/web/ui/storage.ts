// Remembers the last key columns and per-column choices for the rest of the
// session (for example after "Start over"). Deliberately in memory only:
// nothing is written to browser storage, so no trace of a run (not even
// column names) outlives the tab. Saved settings files are the way to reuse
// settings across sessions.

import type { ComparisonMode, IdentityNormalizerName, ValueFormat } from "../core/types";

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

let remembered: RememberedSettings = { columns: Object.create(null) as Record<string, RememberedColumn> };

export function loadRemembered(): RememberedSettings {
  return remembered;
}

export function saveRemembered(settings: RememberedSettings): void {
  remembered = settings;
}
