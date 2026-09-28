import { AppError, errorCodeOf } from "./core/errors";
import { checkFileSize } from "./core/limits";
// Type-only imports from analysis/ and core/ modules keep their code (the
// normalizers, the casefold table, contract parsing) in the worker bundle.
import type { CsvEncoding } from "./analysis/csv";
import type { ColumnProfile } from "./analysis/profiling";
import type { FieldSuggestion, IdentityCandidate } from "./analysis/suggestions";
import type { ObservedPair } from "./analysis/mapping_analysis";
import type {
  IdentityIssue,
  PairMismatchSummary,
  ResultsSummary,
  FieldMismatchSummary,
} from "./analysis/results_analysis";
import type { FieldSelection, WizardConfiguration } from "./core/contract_builder";
import type { ImportedContract } from "./reconciliation.worker";
import {
  inputFromValue,
  manualRow,
  MappingEditorRow,
  MISSING_LABEL,
  rowsFromEvidence,
  selectionsFromRows,
  valueFromInput,
} from "./ui/mapping_editor";
import { busyLabel } from "./ui/busy";
import { metricTiles } from "./ui/metrics";
import type { ContractSummary } from "./ui/contract_summary";
import { pairOptions, selectedPair } from "./ui/drilldown";
import { debounce } from "./ui/debounce";
import { assertCsvFile } from "./ui/files";
import { confirmStep, EditKind, INITIAL_PROGRESS, invalidate, invalidationNote, Progress, reach, reachSkipping, STEP_IDS, StepId, stepStates } from "./ui/steps";
import { onBusyChange, onWorkerCrash, parseAndProfileInWorker, queryWorker, reconcileInWorker, ReconciliationDashboard, terminateReconciliationWorker, WorkerPage } from "./worker_client";
import type {
  ComparisonMode,
  DatasetSummary,
  FieldComparisonResult,
  IdentityNormalizerName,
  ReconciliationContract,
} from "./core/types";

interface MappingEditorState {
  field: { left_column: string; right_column: string };
  rows: MappingEditorRow[];
}

interface AppState {
  left: DatasetSummary | null;
  right: DatasetSummary | null;
  identity: { left_column: string; right_column: string; normalize: IdentityNormalizerName[] } | null;
  fields: Array<{
    left_column: string;
    right_column: string;
    mode: ComparisonMode;
  }>;
  pairs: MappingEditorState[];
  contract: ReconciliationContract | null;
  result: ReconciliationDashboard | null;
  resultPairs: PairMismatchSummary[];
  pairTotal: number;
}

let sessionGeneration = 0;
let runGeneration = 0;
const uploadGeneration: Record<"left" | "right", number> = { left: 0, right: 0 };
// The last chosen file per side, so changing the encoding can re-parse it.
const chosenFiles: Record<"left" | "right", File | null> = { left: null, right: null };
const downloadUrls = new Set<string>();
const mappingPages = new WeakMap<MappingEditorState, number>();
let progress: Progress = INITIAL_PROGRESS;

const state: AppState = {
  left: null,
  right: null,
  identity: null,
  fields: [],
  pairs: [],
  contract: null,
  result: null,
  resultPairs: [],
  pairTotal: 0,
};

const modes: ComparisonMode[] = [
  "Exact",
  "Normalized text",
  "Value mapping",
  "Ignore",
];

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new AppError("INTERNAL", `Element not found: ${selector}`);
  return el;
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== "") element.textContent = text;
  if (className) element.className = className;
  return element;
}

function show(selector: string, visible = true): void {
  $(selector).classList.toggle("hidden", !visible);
}

// Step visibility, data-state, reset notes, and the "confirmed" badges all
// follow the step state machine.
function setProgress(next: Progress): void {
  progress = next;
  const states = stepStates(progress);
  for (const step of STEP_IDS) {
    const section = $(`#step-${step}`);
    section.classList.toggle("hidden", states[step] === "hidden");
    if (states[step] === "hidden") delete section.dataset.state;
    else section.dataset.state = states[step];
    section.querySelector(".step-note")?.remove();
    if (states[step] === "stale" && progress.stale) {
      const note = node("p", invalidationNote(progress.stale), "step-note");
      note.setAttribute("role", "status");
      section.querySelector("h2")!.after(note);
    }
  }
  show("#identity-confirmed", states.identity === "done");
  show("#fields-confirmed", states.fields === "done");
  show("#mappings-confirmed", states.mappings === "done");
}

function edit(kind: EditKind): void {
  setProgress(invalidate(progress, kind).progress);
}

function showError(error: unknown): void {
  // The banner is sticky, so it is visible wherever the user is; the page does not jump.
  const target = $("#error");
  const code = errorCodeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  target.dataset.code = code;
  const dismiss = node("button", "Dismiss", "error-dismiss secondary");
  dismiss.type = "button";
  dismiss.addEventListener("click", clearError);
  target.replaceChildren(node("span", code, "error-code"), node("span", message, "error-message"), dismiss);
  target.classList.remove("hidden");
}

// After a step is confirmed, keyboard and screen-reader focus moves to the next step's heading.
function focusStep(step: StepId): void {
  $(`#step-${step}-title`).focus();
}

function clearError(): void {
  $("#error").classList.add("hidden");
}

function select(options: string[], value: string): HTMLSelectElement {
  const element = node("select");
  for (const optionValue of options) {
    const option = node("option", optionValue);
    option.value = optionValue;
    option.selected = optionValue === value;
    element.append(option);
  }
  return element;
}

function display(value: unknown): string {
  return value === null || value === undefined ? MISSING_LABEL : String(value);
}

interface TableColumn<T> {
  label: string;
  value: (row: T) => unknown;
}

function renderTable<T>(columns: TableColumn<T>[], rows: T[], caption: string): HTMLDivElement {
  const wrapper = node("div", "", "table-scroll");
  const table = node("table");
  table.append(node("caption", caption, "sr-only"));
  const header = node("tr");
  for (const column of columns) {
    const th = node("th", column.label);
    th.scope = "col";
    header.append(th);
  }
  const head = node("thead");
  head.append(header);
  const body = node("tbody");
  for (const row of rows) {
    const tr = node("tr");
    for (const column of columns) tr.append(node("td", display(column.value(row))));
    body.append(tr);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function invalidateAfterUpload(): void {
  runGeneration++;
  state.identity = null;
  state.fields = [];
  state.pairs = [];
  state.contract = null;
  state.result = null;
  state.resultPairs = [];
  for (const selector of ["#identity-suggestion", "#identity-evidence", "#field-rows", "#mapping-editors", "#run-summary", "#metrics", "#identity-issues", "#field-summary", "#pair-summary", "#detail-summary", "#matching-summary"]) {
    $(selector).replaceChildren();
  }
  show("#pair-panel", false);
}

async function upload(side: "left" | "right", file: File, kind: EditKind = `${side}-file`): Promise<void> {
  clearError();
  // Checked before anything is reset, so a wrong drop never discards the session.
  assertCsvFile(file.name, file.type);
  chosenFiles[side] = file;
  const session = sessionGeneration;
  const request = ++uploadGeneration[side];
  edit(kind);
  invalidateAfterUpload();
  state[side] = null;
  $(`#${side}-dataset`).replaceChildren();
  try {
    checkFileSize(file.name, file.size);
    const buffer = await file.arrayBuffer();
    if (session !== sessionGeneration || request !== uploadGeneration[side]) return;
    const name = file.name.replace(/\.[^/.]+$/, "") || side.toUpperCase();
    const encoding = ($(`#${side}-encoding`) as HTMLSelectElement).value as CsvEncoding;
    const parsed = await parseAndProfileInWorker({ content: buffer, name, fileName: file.name, side, encoding, sessionGeneration: session });
    if (session !== sessionGeneration || request !== uploadGeneration[side]) return;
    const { summary, profiles } = parsed;
    state[side] = summary;
    renderDataset(side, summary, file.name, profiles);
  } catch (error) {
    if (session === sessionGeneration && request === uploadGeneration[side]) {
      state[side] = null;
      $(`#${side}-dataset`).replaceChildren();
      throw error;
    }
    return;
  }
  if (state.left && state.right) {
    await startIdentity();
  }
}

function renderDataset(
  side: "left" | "right",
  data: DatasetSummary,
  filename: string,
  profiles: ColumnProfile[],
): void {
  const target = $(`#${side}-dataset`);
  target.replaceChildren();
  target.append(node("p", `File: ${filename}`, "caption"));

  const label = node("label", "Logical source name");
  const nameInput = node("input");
  nameInput.type = "text";
  nameInput.value = data.name;
  nameInput.addEventListener("change", () => {
    const trimmed = nameInput.value.trim();
    if (!trimmed) {
      showError(new AppError("CONTRACT_INVALID", "dataset name cannot be blank"));
      nameInput.value = data.name;
      return;
    }
    data.name = trimmed;
    invalidateResults();
    edit("dataset-name");
  });
  label.append(nameInput);

  target.append(
    label,
    node("p", `${data.recordCount} rows · ${data.columns.length} columns`, "caption"),
  );

  const previewRows = data.previewRecords;
  target.append(
    renderTable(
      data.columns.map((col) => ({
        label: col,
        value: (row: Record<string, string | null>) => row[col],
      })),
      previewRows,
      `Preview of ${filename}`,
    ),
  );

  const details = node("details");
  details.append(node("summary", "Column profile"));
  details.append(
    renderTable(
      [
        { label: "Column", value: (r) => r.column_name },
        { label: "Rows", value: (r) => r.row_count },
        { label: "Non-null", value: (r) => r.non_null_count },
        { label: "Null %", value: (r) => r.null_percentage },
        { label: "Distinct", value: (r) => r.distinct_count },
        { label: "Unique %", value: (r) => r.uniqueness_percentage },
        { label: "Samples", value: (r) => r.sample_values.join(", ") },
      ],
      profiles,
      `Column profile of ${filename}`,
    ),
  );
  target.append(details);
}

async function startIdentity(): Promise<void> {
  if (!state.left || !state.right) return;
  const suggestion = await queryWorker<IdentityCandidate>("suggest-identity", {}, sessionGeneration);
  const banner = $("#identity-suggestion");
  banner.replaceChildren();

  if (suggestion.confident) {
    banner.append(
      node(
        "strong",
        `Suggested: ${suggestion.left_column} ↔ ${suggestion.right_column}`,
      ),
    );
    banner.append(node("p", suggestion.reasons.join(" · ")));
  } else {
    banner.textContent =
      "No high-confidence pair was found. Review the profiles and choose both fields explicitly.";
  }

  const leftSelect = select(state.left.columns, suggestion.left_column);
  const rightSelect = select(state.right.columns, suggestion.right_column);
  leftSelect.id = "left-identity";
  rightSelect.id = "right-identity";
  $("#left-identity").replaceWith(leftSelect);
  $("#right-identity").replaceWith(rightSelect);

  leftSelect.addEventListener("change", () => { void scoreIdentity("identity-columns").catch(showError); });
  rightSelect.addEventListener("change", () => { void scoreIdentity("identity-columns").catch(showError); });
  await scoreIdentity("identity-columns");
  setProgress(confirmStep(progress, "upload"));
}

async function scoreIdentity(kind: EditKind): Promise<void> {
  if (!state.left || !state.right) return;
  edit(kind);
  state.identity = null;
  state.fields = [];
  state.pairs = [];
  invalidateResults();
  for (const selector of ["#field-rows", "#mapping-editors", "#run-summary"]) $(selector).replaceChildren();
  const leftCol = ($("#left-identity") as HTMLSelectElement).value;
  const rightCol = ($("#right-identity") as HTMLSelectElement).value;

  const requestSession = sessionGeneration;
  const evidence = await queryWorker<{ overlap_percentage: number }>("score-identity", { leftColumn: leftCol, rightColumn: rightCol }, requestSession);
  if (requestSession !== sessionGeneration || !state.left || !state.right || leftCol !== (document.querySelector("#left-identity") as HTMLSelectElement | null)?.value || rightCol !== (document.querySelector("#right-identity") as HTMLSelectElement | null)?.value) return;

  $("#identity-evidence").textContent = `Conservative trimmed/case-insensitive value overlap for selection: ${evidence.overlap_percentage.toFixed(
    1,
  )}%. Reconciliation matches identities exactly unless identity normalization is selected.`;
}

function identityNormalizerInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("#identity-normalizers input[type=checkbox]"));
}

function selectedIdentityNormalizers(): IdentityNormalizerName[] {
  return identityNormalizerInputs().filter((input) => input.checked).map((input) => input.value as IdentityNormalizerName);
}

async function confirmIdentity(): Promise<void> {
  if (!state.left || !state.right) return;
  const leftCol = ($("#left-identity") as HTMLSelectElement).value;
  const rightCol = ($("#right-identity") as HTMLSelectElement).value;
  const generation = runGeneration;
  const suggestions = await queryWorker<FieldSuggestion[]>("suggest-fields", { leftIdentity: leftCol, rightIdentity: rightCol }, sessionGeneration);
  if (generation !== runGeneration || !state.left || !state.right) return;

  state.identity = { left_column: leftCol, right_column: rightCol, normalize: selectedIdentityNormalizers() };

  state.fields = suggestions.map((item) => ({
    left_column: item.left_column,
    right_column: item.right_column,
    mode: "Exact" as ComparisonMode,
  }));

  renderFieldRows();
  setProgress(confirmStep(progress, "identity"));
  focusStep("fields");
}

function renderFieldRows(): void {
  if (!state.left || !state.right || !state.identity) return;
  const target = $("#field-rows");
  target.replaceChildren();

  const leftColumns = state.left.columns.filter(
    (item) => item !== state.identity!.left_column,
  );
  const rightColumns = state.right.columns.filter(
    (item) => item !== state.identity!.right_column,
  );

  state.fields.forEach((field, index) => {
    const row = node("tr");
    const leftSel = select(leftColumns, field.left_column);
    const rightSel = select(rightColumns, field.right_column);
    const modeSel = select(modes, field.mode);

    leftSel.addEventListener("change", () => {
      field.left_column = leftSel.value;
      fieldsChanged();
    });
    rightSel.addEventListener("change", () => {
      field.right_column = rightSel.value;
      fieldsChanged();
    });
    modeSel.addEventListener("change", () => {
      field.mode = modeSel.value as ComparisonMode;
      fieldsChanged();
    });

    const removeBtn = node("button", "Remove", "secondary danger");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => {
      state.fields.splice(index, 1);
      renderFieldRows();
      fieldsChanged();
    });

    for (const child of [leftSel, rightSel, modeSel, removeBtn]) {
      const cell = node("td");
      cell.append(child);
      row.append(cell);
    }
    target.append(row);
  });
}

function fieldsChanged(): void {
  invalidateResults();
  edit("field-mappings");
}

function invalidateResults(): void {
  runGeneration++;
  state.contract = null;
  state.result = null;
  state.resultPairs = [];
  for (const selector of ["#metrics", "#identity-issues", "#field-summary", "#pair-summary", "#detail-summary", "#matching-summary"]) {
    $(selector).replaceChildren();
  }
  show("#pair-panel", false);
}

function addField(): void {
  if (!state.left || !state.right || !state.identity) return;
  const usedLeft = new Set(state.fields.map((item) => item.left_column));
  const usedRight = new Set(state.fields.map((item) => item.right_column));
  const left = state.left.columns.find(
    (item) => item !== state.identity!.left_column && !usedLeft.has(item),
  );
  const right = state.right.columns.find(
    (item) => item !== state.identity!.right_column && !usedRight.has(item),
  );
  if (!left || !right) return;
  state.fields.push({ left_column: left, right_column: right, mode: "Exact" });
  renderFieldRows();
  fieldsChanged();
}

function confirmFields(): void {
  if (!state.left || !state.right || !state.identity) return;
  const active = state.fields.filter((item) => item.mode !== "Ignore");
  if (active.length === 0) {
    showError(new AppError("CONTRACT_INVALID", "select at least one comparison field"));
    return;
  }
  const leftCols = new Set(active.map((f) => f.left_column));
  const rightCols = new Set(active.map((f) => f.right_column));
  if (leftCols.size !== active.length || rightCols.size !== active.length) {
    showError(new AppError("CONTRACT_INVALID", "a field cannot be mapped more than once on either side"));
    return;
  }

  setProgress(confirmStep(progress, "fields"));
  focusStep("mappings");
  void renderMappingEditors().catch(showError);
}

async function renderMappingEditors(): Promise<void> {
  if (!state.left || !state.right || !state.identity) return;
  const requestSession = sessionGeneration;
  const requestGeneration = runGeneration;
  const target = $("#mapping-editors");
  target.replaceChildren();
  state.pairs = [];

  const mappingFields = state.fields.filter(
    (item) => item.mode === "Value mapping",
  );

  if (mappingFields.length === 0) {
    target.append(
      node(
        "p",
        "No fields use semantic value mapping. Confirm this step to continue.",
        "message",
      ),
    );
    return;
  }

  for (const field of mappingFields) {
    const evidence = await queryWorker<ObservedPair[]>("mapping-evidence", {
      leftIdentity: state.identity.left_column,
      rightIdentity: state.identity.right_column,
      identityNormalize: state.identity.normalize,
      leftField: field.left_column,
      rightField: field.right_column,
    }, sessionGeneration);
    if (requestSession !== sessionGeneration || requestGeneration !== runGeneration || !state.identity) return;
    state.pairs.push({ field, rows: rowsFromEvidence(evidence) });
  }
  renderMappingEditorsFromState();
}

function renderMappingEditorsFromState(): void {
  const target = $("#mapping-editors");
  target.replaceChildren();
  for (const editor of state.pairs) {
    const heading = node(
      "h3",
      `${editor.field.left_column} ↔ ${editor.field.right_column}`,
    );
    const addBtn = node("button", "Add mapping row", "secondary");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      editor.rows.push(manualRow());
      mappingPages.set(editor, Math.floor((editor.rows.length - 1) / 100));
      mappingChanged();
      renderMappingEditorsFromState();
    });
    const block = node("div");
    block.append(heading, mappingTable(editor), addBtn);
    target.append(block);
  }
}

function mappingTable(editor: MappingEditorState): HTMLDivElement {
  const wrapper = node("div", "", "table-scroll");
  const table = node("table");
  const headings = [
    "Accept semantic mapping",
    "Canonical value",
    "Dataset A value",
    "Dataset B value",
    "Employees",
    "Consistency %",
    "Assessment",
    "",
  ];
  table.append(node("caption", `Value mappings for ${editor.field.left_column} ↔ ${editor.field.right_column}`, "sr-only"));
  const headRow = node("tr");
  headings.forEach((value) => {
    const th = node("th", value);
    th.scope = "col";
    headRow.append(th);
  });
  const head = node("thead");
  head.append(headRow);
  const body = node("tbody");

  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(editor.rows.length / pageSize));
  const page = Math.min(mappingPages.get(editor) ?? 0, pages - 1);
  mappingPages.set(editor, page);
  editor.rows.slice(page * pageSize, (page + 1) * pageSize).forEach((pair) => {
    const row = node("tr");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.checked = pair.accepted ?? false;
    checkbox.addEventListener("change", () => {
      pair.accepted = checkbox.checked;
      mappingChanged();
    });

    const canonicalInput = node("input");
    canonicalInput.type = "text";
    canonicalInput.value = pair.canonical;
    canonicalInput.addEventListener("input", () => {
      pair.canonical = canonicalInput.value;
      mappingEdited.schedule();
    });
    canonicalInput.addEventListener("change", () => mappingEdited.flush());

    const valueInput = (side: "left" | "right"): HTMLInputElement => {
      const input = node("input");
      input.type = "text";
      input.placeholder = MISSING_LABEL;
      input.value = inputFromValue(pair[side]);
      input.addEventListener("input", () => {
        pair[side] = valueFromInput(input.value);
        mappingEdited.schedule();
      });
      input.addEventListener("change", () => mappingEdited.flush());
      return input;
    };
    const leftInput = valueInput("left");
    const rightInput = valueInput("right");

    const removeBtn = node("button", "Remove", "secondary danger");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => {
      editor.rows.splice(editor.rows.indexOf(pair), 1);
      mappingPages.set(editor, Math.min(page, Math.max(0, Math.ceil(editor.rows.length / pageSize) - 1)));
      renderMappingEditorsFromState();
      mappingChanged();
    });

    const cells = [
      checkbox,
      canonicalInput,
      leftInput,
      rightInput,
      node("span", String(pair.count)),
      node("span", String(pair.consistency_percentage)),
      node("span", pair.assessment),
      removeBtn,
    ];
    for (const value of cells) {
      const cell = node("td");
      cell.append(value);
      row.append(cell);
    }
    body.append(row);
  });

  table.append(head, body);
  wrapper.append(table);
  wrapper.prepend(node("p", `Mapping evidence: ${editor.rows.length.toLocaleString()} · page ${page + 1} of ${pages}`, "caption"));
  const controls = node("div", "", "actions");
  const prev = node("button", "Previous page", "secondary");
  prev.type = "button"; prev.disabled = page === 0;
  prev.addEventListener("click", () => { mappingPages.set(editor, page - 1); renderMappingEditorsFromState(); });
  const next = node("button", "Next page", "secondary");
  next.type = "button"; next.disabled = page + 1 >= pages;
  next.addEventListener("click", () => { mappingPages.set(editor, page + 1); renderMappingEditorsFromState(); });
  controls.append(prev, next);
  wrapper.append(controls);
  return wrapper;
}

function mappingChanged(): void {
  mappingEdited.cancel();
  invalidateResults();
  edit("value-mappings");
}

// Typing updates the rows at once, but resets later steps only when the user
// pauses or leaves the field, not on every keystroke.
const mappingEdited = debounce(mappingChanged, 300);

async function confirmMappings(): Promise<void> {
  mappingEdited.flush();
  const leftName = state.left?.name || "left";
  const rightName = state.right?.name || "right";
  const suggestedName =
    `${leftName}_vs_${rightName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "ui_reconciliation";

  ($("#contract-name") as HTMLInputElement).value = suggestedName;
  const count = state.fields.filter((item) => item.mode !== "Ignore").length;
  const identityRule = state.identity?.normalize.length ? ` (normalized: ${state.identity.normalize.join(", ")})` : " (exact)";
  $("#run-summary").textContent = `Identity: ${state.identity?.left_column} ↔ ${state.identity?.right_column}${identityRule} · Comparison fields: ${count}`;
  const generation = runGeneration;
  try {
    await buildCurrentContract();
  } catch (error) {
    showError(error);
    return;
  }
  if (generation !== runGeneration) return;
  setProgress(confirmStep(progress, "mappings"));
  focusStep("run");
}

// The wizard state becomes a configuration here; the worker validates it and
// builds the contract.
async function buildCurrentContract(): Promise<ReconciliationContract> {
  if (!state.left || !state.right || !state.identity) throw new AppError("SESSION_STATE", "upload both datasets and confirm identity first");
  const fieldSelections: FieldSelection[] = state.fields.map((f) => {
    const editor = state.pairs.find((ed) => ed.field.left_column === f.left_column);
    if (f.mode !== "Value mapping" || !editor) return f;
    return { ...f, value_mappings: selectionsFromRows(editor.field.left_column, editor.rows) };
  });
  const configuration: WizardConfiguration = {
    contract_name: ($("#contract-name") as HTMLInputElement).value.trim() || "ui_reconciliation",
    left_name: state.left.name, right_name: state.right.name,
    left_identity: state.identity.left_column, right_identity: state.identity.right_column,
    identity_normalize: state.identity.normalize,
    fields: fieldSelections,
  };
  return queryWorker<ReconciliationContract>("build-contract", { configuration }, sessionGeneration);
}

async function runReconciliation(): Promise<void> {
  if (!state.left || !state.right || !state.identity) return;
  const contract = await buildCurrentContract();
  setProgress(reach("run"));
  await runContract(contract, () => setProgress(confirmStep(progress, "run")));
}

// Runs a contract (from the wizard or an imported one) and shows its results.
async function runContract(contract: ReconciliationContract, showResults: () => void): Promise<void> {
  invalidateResults();
  const configGeneration = runGeneration;
  const currentSession = sessionGeneration;
  let dashboard: ReconciliationDashboard;
  try {
    dashboard = await reconcileInWorker({ contract, sessionGeneration: currentSession });
  } catch (error) {
    if (currentSession === sessionGeneration && configGeneration === runGeneration) showError(error);
    return;
  }
  if (currentSession !== sessionGeneration || configGeneration !== runGeneration) return;

  state.contract = contract;
  state.result = dashboard;
  renderMetrics(dashboard.summary);
  loadIdentityIssues(0).catch(showError);
  renderFieldSummary(dashboard.fields);
  $("#matching-summary").replaceChildren(node("p", `${dashboard.matchingCount.toLocaleString()} matching comparisons. Expand to load details.`, "caption"));

  showResults();
  focusStep("results");
}

async function loadIdentityIssues(pageNumber: number): Promise<void> {
  if (!state.result) return;
  const page = await queryWorker<WorkerPage<IdentityIssue>>("identity-issues", { page: pageNumber, pageSize: 100, resultId: state.result.resultId }, sessionGeneration);
  if (!state.result) return;
  if (page.total === 0) {
    $("#identity-issues").replaceChildren(node("p", "Every identity matched exactly once on both sides.", "message"));
    return;
  }
  $("#identity-issues").replaceChildren(loadRemoteTable(
    [
      { label: "Employee identity", value: (row) => display(row.identity) },
      { label: "Status", value: (row) => row.status },
      { label: "Dataset A rows", value: (row) => row.left_rows.join(", ") },
      { label: "Dataset B rows", value: (row) => row.right_rows.join(", ") },
    ],
    page,
    "Identity issues",
    (nextPage) => loadIdentityIssues(nextPage).catch(showError),
  ));
}

async function saveContract(): Promise<void> {
  const contract = await buildCurrentContract();
  const text = await queryWorker<string>("serialize-contract", { contract }, sessionGeneration);
  saveBlob(new Blob([text], { type: "application/json;charset=utf-8" }), `${contract.name}.contract.json`);
}

// Imports a saved contract into the current session: validates it against the
// uploaded columns, then pre-fills every wizard step up to "Run comparison".
async function loadContract(file: File): Promise<void> {
  if (!state.left || !state.right) throw new AppError("SESSION_STATE", "upload both datasets before loading a contract");
  const imported = await queryWorker<ImportedContract>("import-contract", { text: await file.text(), fileName: file.name }, sessionGeneration);
  const { contract, wizard, summary } = imported;
  if (!wizard) {
    showContractSummary(contract, summary!, file.name);
    return;
  }
  hideContractSummary();

  invalidateResults();
  for (const side of ["left", "right"] as const) {
    const summary = state[side]!;
    summary.name = contract[side].name;
    const nameInput = document.querySelector<HTMLInputElement>(`#${side}-dataset input[type=text]`);
    if (nameInput) nameInput.value = summary.name;
  }
  ($("#left-identity") as HTMLSelectElement).value = wizard.identity.left_column;
  ($("#right-identity") as HTMLSelectElement).value = wizard.identity.right_column;
  for (const input of identityNormalizerInputs()) input.checked = wizard.identity.normalize.includes(input.value as IdentityNormalizerName);
  $("#identity-evidence").textContent = `Loaded contract '${contract.name}' from ${file.name}.`;
  state.identity = wizard.identity;
  state.fields = wizard.fields;
  renderFieldRows();

  state.pairs = wizard.fields
    .filter((field) => field.mode === "Value mapping")
    .map((field) => ({ field: { left_column: field.left_column, right_column: field.right_column }, rows: wizard.mappingRows.get(field.left_column) ?? [] }));
  renderMappingEditorsFromState();
  setProgress(reach("mappings"));

  await confirmMappings();
  ($("#contract-name") as HTMLInputElement).value = contract.name;
}

// A contract the wizard cannot represent (Custom normalizers) is shown
// read-only and can be run as-is, skipping the wizard steps.
function showContractSummary(contract: ReconciliationContract, summary: ContractSummary, fileName: string): void {
  const panel = $("#contract-summary");
  const title = node("h3", `Imported contract: ${summary.name}`);
  const explanation = node("p", `${fileName} uses settings the wizard cannot edit (Custom normalizers). Review it, then run it as-is or discard it.`, "caption");
  const identity = node("p", `Identity: ${summary.identity}`);
  const table = renderTable(
    [
      { label: "Field", value: (row: ContractSummary["fields"][number]) => row.name },
      { label: "Columns", value: (row) => row.columns },
      { label: "Mode", value: (row) => row.mode },
      { label: "Normalizers", value: (row) => row.normalizers },
      { label: "Value mapping", value: (row) => row.mapping },
    ],
    summary.fields,
    `Fields of contract ${summary.name}`,
  );
  const run = node("button", "Run this contract");
  run.type = "button";
  run.addEventListener("click", () => {
    clearError();
    runImportedContract(contract).catch(showError);
  });
  const discard = node("button", "Discard", "secondary");
  discard.type = "button";
  discard.addEventListener("click", () => {
    hideContractSummary();
    focusStep("identity");
  });
  const actions = node("div", "", "actions");
  actions.append(run, discard);
  panel.replaceChildren(title, explanation, identity, table, actions);
  show("#contract-summary");
}

function hideContractSummary(): void {
  $("#contract-summary").replaceChildren();
  show("#contract-summary", false);
}

async function runImportedContract(contract: ReconciliationContract): Promise<void> {
  if (!state.left || !state.right) throw new AppError("SESSION_STATE", "upload both datasets before running a contract");
  state.left.name = contract.left.name;
  state.right.name = contract.right.name;
  setProgress(reach("identity"));
  await runContract(contract, () => setProgress(reachSkipping("results", ["fields", "mappings", "run"])));
}

async function loadMatchingDetails(pageNumber: number): Promise<void> {
  if (!state.result) return;
  const resultId = state.result.resultId;
  const page = await queryWorker<WorkerPage<FieldComparisonResult>>("matching-details", { page: pageNumber, pageSize: 100, resultId }, sessionGeneration);
  if (!state.result) return;
  $("#matching-summary").replaceChildren(resultDetailTable(page, "Matching comparisons", (nextPage) => loadMatchingDetails(nextPage).catch(showError)));
}

function renderMetrics(summary: ResultsSummary): void {
  const target = $("#metrics");
  target.replaceChildren();
  for (const metric of metricTiles(summary)) {
    const tile = node("div", "", "metric");
    tile.dataset.tone = metric.tone;
    tile.append(node("strong", String(metric.value)), node("span", metric.label));
    target.append(tile);
  }
}

function renderFieldSummary(rows: FieldMismatchSummary[]): void {
  const target = $("#field-summary");
  target.replaceChildren();
  if (rows.length === 0) {
    target.append(
      node("p", "No field discrepancies were found.", "message"),
    );
    show("#pair-panel", false);
    return;
  }
  target.append(
      renderTable(
      [
        { label: "Field", value: (row) => row.field_name },
        { label: "Mismatches", value: (row) => row.mismatch_count },
        { label: "Comparisons", value: (row) => row.comparison_count },
        { label: "Rate %", value: (row) => row.mismatch_rate_percentage },
      ],
      rows,
      "Mismatches by field",
    ),
  );

  const fieldSelect = select(
    rows.map((row) => row.field_name),
    rows[0].field_name,
  );
  fieldSelect.id = "result-field";
  $("#result-field").replaceWith(fieldSelect);
  fieldSelect.addEventListener("change", () => loadPairs(0).catch(showError));
  show("#pair-panel");
  loadPairs(0).catch(showError);
}

function loadRemoteTable<T>(columns: TableColumn<T>[], page: WorkerPage<T>, label: string, onPage: (page: number) => void): HTMLDivElement {
  const container = node("div", "", "paged-table");
  container.append(node("p", `${label}: ${page.total.toLocaleString()} · page ${page.page + 1} of ${Math.max(1, Math.ceil(page.total / page.pageSize))}`, "caption"));
  container.append(renderTable(columns, page.rows, label));
  const controls = node("div", "", "actions");
  const previous = node("button", "Previous page", "secondary");
  previous.type = "button"; previous.disabled = page.page === 0;
  previous.addEventListener("click", () => onPage(page.page - 1));
  const next = node("button", "Next page", "secondary");
  next.type = "button"; next.disabled = page.page + 1 >= Math.ceil(page.total / page.pageSize);
  next.addEventListener("click", () => onPage(page.page + 1));
  controls.append(previous, next);
  container.append(controls);
  return container;
}

async function loadPairs(pageNumber = 0): Promise<void> {
  if (!state.result) return;
  const field = ($("#result-field") as HTMLSelectElement).value;
  const resultId = state.result.resultId;
  const page = await queryWorker<WorkerPage<PairMismatchSummary>>("pairs", { fieldName: field, page: pageNumber, pageSize: 100, resultId }, sessionGeneration);
  if (!state.result) return;
  state.resultPairs = page.rows;
  state.pairTotal = page.total;

  $("#pair-summary").replaceChildren(
    loadRemoteTable(
      [
        { label: "Dataset A value", value: (row) => display(row.left_value) },
        { label: "Dataset B value", value: (row) => display(row.right_value) },
        { label: "Status", value: (row) => row.status },
        { label: "Employees", value: (row) => row.employee_count },
        { label: "Share %", value: (row) => row.percentage },
      ],
      page,
      "Mismatch pairs",
      (nextPage) => loadPairs(nextPage).catch(showError),
    ),
  );

  const pairSelect = node("select");
  for (const { value, label } of pairOptions(page.rows)) {
    const option = node("option", label);
    option.value = value;
    pairSelect.append(option);
  }
  pairSelect.id = "result-pair";
  $("#result-pair").replaceWith(pairSelect);
  pairSelect.addEventListener("change", () => loadDetails(0).catch(showError));
  await loadDetails(0);
}

async function loadDetails(pageNumber = 0): Promise<void> {
  if (!state.result) return;
  const field = ($("#result-field") as HTMLSelectElement).value;
  const selection = ($("#result-pair") as HTMLSelectElement).value;

  let filterLeft = false;
  let filterRight = false;
  let leftVal: string | null = null;
  let rightVal: string | null = null;

  const pair = selectedPair(selection, state.resultPairs);
  if (pair) {
    filterLeft = true;
    filterRight = true;
    leftVal = pair.left_value;
    rightVal = pair.right_value;
  }

  const page = await queryWorker<WorkerPage<FieldComparisonResult>>("details", {
    fieldName: field, page: pageNumber, pageSize: 100,
    resultId: state.result.resultId,
    leftValue: leftVal,
    rightValue: rightVal,
    filterLeft,
    filterRight,
  }, sessionGeneration);

  $("#detail-summary").replaceChildren(resultDetailTable(page, "Employee details", (nextPage) => loadDetails(nextPage).catch(showError)));
}

function resultDetailTable(page: WorkerPage<FieldComparisonResult>, label: string, onPage: (page: number) => void): HTMLDivElement {
  return loadRemoteTable(
    [
      { label: "Employee identity", value: (row) => row.identity },
      { label: "Field", value: (row) => row.fieldName },
      { label: "Dataset A row", value: (row) => row.leftLine },
      { label: "Dataset B row", value: (row) => row.rightLine },
      { label: "Dataset A value", value: (row) => display(row.leftRawValue) },
      { label: "Dataset B value", value: (row) => display(row.rightRawValue) },
      { label: "Comparison status", value: (row) => row.status },
    ],
    page,
    label,
    onPage,
  );
}

async function download(file: string): Promise<void> {
  if (!state.result || !state.contract) {
    showError(new AppError("SESSION_STATE", "run the reconciliation first"));
    return;
  }
  const root = state.contract.name;
  const filenames: Record<string, string> = { "full.csv": `${root}_full.csv`, "mismatches.csv": `${root}_mismatches.csv`, "report.json": `${root}.json` };
  const filename = filenames[file];
  if (!filename) return;

  // The worker streams the export into a Blob; no report-sized string reaches this thread.
  const excelSafe = ($("#excel-safe") as HTMLInputElement).checked;
  const blob = await queryWorker<Blob>("export", { format: file, resultId: state.result.resultId, excelSafe }, sessionGeneration);
  saveBlob(blob, filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  const objectUrl = anchor.href;
  downloadUrls.add(objectUrl);
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    downloadUrls.delete(objectUrl);
  }, 30000);
}

function clearSession(): void {
  sessionGeneration++;
  runGeneration++;
  terminateReconciliationWorker();
  uploadGeneration.left++;
  uploadGeneration.right++;
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
  state.left = null;
  state.right = null;
  state.identity = null;
  state.fields = [];
  state.pairs = [];
  state.contract = null;
  state.result = null;
  state.resultPairs = [];

  $("#left-dataset").replaceChildren();
  $("#right-dataset").replaceChildren();
  for (const selector of ["#identity-suggestion", "#identity-evidence", "#field-rows", "#mapping-editors", "#run-summary", "#metrics", "#identity-issues", "#field-summary", "#pair-summary", "#detail-summary", "#matching-summary"]) {
    $(selector).replaceChildren();
  }
  ($( "#contract-name") as HTMLInputElement).value = "";
  ($( "#left-identity") as HTMLSelectElement).replaceChildren();
  ($( "#right-identity") as HTMLSelectElement).replaceChildren();
  ($( "#result-field") as HTMLSelectElement).replaceChildren();
  ($( "#result-pair") as HTMLSelectElement).replaceChildren();
  for (const input of identityNormalizerInputs()) input.checked = false;
  ($("#excel-safe") as HTMLInputElement).checked = true;
  chosenFiles.left = null;
  chosenFiles.right = null;
  ($("#left-encoding") as HTMLSelectElement).value = "utf-8";
  ($("#right-encoding") as HTMLSelectElement).value = "utf-8";
  ($("#contract-file") as HTMLInputElement).value = "";
  ($("#left-file") as HTMLInputElement).value = "";
  ($("#right-file") as HTMLInputElement).value = "";

  invalidateAfterUpload();
  hideContractSummary();
  setProgress(INITIAL_PROGRESS);
  clearError();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function quitApplication(): void {
  clearSession();
  document.body.replaceChildren();
  const message = node("main");
  message.append(
    node("h1", "HRIS Reconciliation has closed"),
    node(
      "p",
      "Application references and displayed data have been cleared. You can safely close this tab.",
    ),
  );
  document.body.append(message);
}

function setupDragAndDrop(side: "left" | "right"): void {
  const card = $(`#${side}-card`);
  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    card.classList.add("drag-over");
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over");
  });
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) {
      upload(side, file).catch(showError);
    }
  });
}

function bind(
  selector: string,
  event: string,
  callback: (...args: unknown[]) => unknown,
): void {
  $(selector).addEventListener(event, (...args: unknown[]) => {
    clearError();
    try {
      const res = callback(...args);
      if (res instanceof Promise) {
        res.catch(showError);
      }
    } catch (err) {
      showError(err);
    }
  });
}

// Bind events
const leftFileInput = $("#left-file") as HTMLInputElement;
const rightFileInput = $("#right-file") as HTMLInputElement;

leftFileInput.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files[0]) upload("left", files[0]).catch(showError);
});

rightFileInput.addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files[0]) upload("right", files[0]).catch(showError);
});

for (const input of identityNormalizerInputs()) {
  input.addEventListener("change", () => { void scoreIdentity("identity-normalizers").catch(showError); });
}

$("#contract-file").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  clearError();
  if (file) loadContract(file).catch(showError);
});

// While worker requests are pending: show progress, mark the workbench busy,
// and disable its action buttons (header controls such as Clear session stay
// usable, so a slow run can always be abandoned).
onBusyChange((pendingTypes) => {
  const label = busyLabel(pendingTypes);
  const main = $("main");
  show("#busy", label !== null);
  $("#busy-label").textContent = label ?? "";
  if (label) {
    main.setAttribute("aria-busy", "true");
    for (const button of main.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")) {
      button.disabled = true;
      button.dataset.busyDisabled = "true";
    }
  } else {
    main.removeAttribute("aria-busy");
    for (const button of main.querySelectorAll<HTMLButtonElement>("button[data-busy-disabled]")) {
      button.disabled = false;
      delete button.dataset.busyDisabled;
    }
  }
});

// The worker held every dataset and result, so the whole session is gone:
// reset the UI to step 1 instead of leaving steps that would fail with
// "upload first".
onWorkerCrash((error) => {
  clearSession();
  showError(error);
});

for (const side of ["left", "right"] as const) {
  $(`#${side}-encoding`).addEventListener("change", () => {
    const file = chosenFiles[side];
    if (file) upload(side, file, `${side}-encoding`).catch(showError);
  });
}

setupDragAndDrop("left");
setupDragAndDrop("right");
setProgress(INITIAL_PROGRESS);

bind("#confirm-identity", "click", confirmIdentity);
bind("#add-field", "click", addField);
bind("#confirm-fields", "click", confirmFields);
bind("#confirm-mappings", "click", confirmMappings);
bind("#run-reconciliation", "click", runReconciliation);
bind("#save-contract", "click", saveContract);
bind("#clear-session", "click", clearSession);
bind("#quit-application", "click", quitApplication);

document.querySelectorAll<HTMLButtonElement>(".download").forEach((btn) => {
  const file = btn.dataset.file;
  if (file) {
    btn.addEventListener("click", () => download(file).catch(showError));
  }
});

$("#matching-details").addEventListener("toggle", (event) => {
  if ((event.currentTarget as HTMLDetailsElement).open) loadMatchingDetails(0).catch(showError);
});
