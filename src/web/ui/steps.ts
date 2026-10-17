// The page is one screen with three steps. A step is locked until the one
// before it is complete; locked steps stay visible (muted title and a note) so the whole
// journey is clear from the start.

export const STEP_IDS = ["load", "settings", "results"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = "locked" | "active" | "done";

export interface Progress {
  filesLoaded: boolean;
  hasResults: boolean;
  // Settings changed after the last comparison.
  stale: boolean;
}

export function stepStates(progress: Progress): Record<StepId, StepState> {
  return {
    load: progress.filesLoaded ? "done" : "active",
    settings: !progress.filesLoaded ? "locked" : progress.hasResults && !progress.stale ? "done" : "active",
    results: progress.hasResults ? "active" : "locked",
  };
}

export const LOCKED_NOTES: Record<StepId, string> = {
  load: "",
  settings: "Load both files to continue.",
  results: "Compare the files to see the results here.",
};
