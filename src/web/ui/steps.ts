// The wizard's step state machine. A single "reached" step decides every
// step's state: earlier steps are done, the reached step is active (or stale,
// when an upstream edit just cleared the steps after it), later steps are hidden.

export const STEP_IDS = ["upload", "identity", "fields", "mappings", "run", "results"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = "hidden" | "active" | "done" | "stale";

export interface Invalidation {
  // The step whose edit caused the reset, and what changed.
  trigger: StepId;
  reason: string;
  // Steps that were reached and are now hidden again.
  cleared: StepId[];
}

export interface Progress {
  reached: StepId;
  stale: Invalidation | null;
}

export const INITIAL_PROGRESS: Progress = { reached: "upload", stale: null };

const index = (step: StepId) => STEP_IDS.indexOf(step);

export function nextStep(step: StepId): StepId | null {
  return STEP_IDS[index(step) + 1] ?? null;
}

export function stepStates(progress: Progress): Record<StepId, StepState> {
  const reached = index(progress.reached);
  const states = Object.create(null) as Record<StepId, StepState>;
  for (const step of STEP_IDS) {
    const at = index(step);
    if (at > reached) states[step] = "hidden";
    else if (at < reached) states[step] = "done";
    else states[step] = progress.stale?.trigger === step ? "stale" : "active";
  }
  return states;
}

export function reach(step: StepId): Progress {
  return { reached: step, stale: null };
}

// Confirming a step reveals the next one.
export function confirmStep(_progress: Progress, step: StepId): Progress {
  return reach(nextStep(step) ?? step);
}

// Every user edit that can invalidate later steps: the step it belongs to and
// the reason shown to the user.
export const EDITS = {
  "left-file": { step: "upload", reason: "the Dataset A file" },
  "right-file": { step: "upload", reason: "the Dataset B file" },
  "left-encoding": { step: "upload", reason: "the Dataset A encoding" },
  "right-encoding": { step: "upload", reason: "the Dataset B encoding" },
  "dataset-name": { step: "run", reason: "a dataset name" },
  "identity-columns": { step: "identity", reason: "the identity fields" },
  "identity-normalizers": { step: "identity", reason: "identity normalization" },
  "field-mappings": { step: "fields", reason: "the field mappings" },
  "value-mappings": { step: "mappings", reason: "the value mappings" },
} as const satisfies Record<string, { step: StepId; reason: string }>;

export type EditKind = keyof typeof EDITS;

// Applies an edit: if later steps had been reached, they are cleared and the
// edited step becomes stale; editing the current step changes nothing.
export function invalidate(progress: Progress, kind: EditKind): { progress: Progress; invalidation: Invalidation | null } {
  const { step, reason } = EDITS[kind];
  const at = index(step);
  const reached = index(progress.reached);
  if (reached <= at) return { progress, invalidation: null };
  const invalidation: Invalidation = { trigger: step, reason, cleared: STEP_IDS.slice(at + 1, reached + 1) };
  return { progress: { reached: step, stale: invalidation }, invalidation };
}

export function invalidationNote(invalidation: Invalidation): string {
  const what = invalidation.cleared.includes("results") ? "Results" : "Later steps";
  return `${what} reset because ${invalidation.reason} changed.`;
}
