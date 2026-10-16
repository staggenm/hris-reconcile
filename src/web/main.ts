import { AppError, errorCodeOf } from "./core/errors";
import { checkFileSize } from "./core/limits";
import { APP_VERSION } from "./core/version";
// Type-only imports from analysis/ and core/ modules keep their code (the
// normalizers, the casefold table, contract parsing) in the worker bundle.
import type { CsvEncoding } from "./analysis/csv";
import type { ColumnProfile } from "./analysis/profiling";
import type { IdentityCandidate } from "./analysis/suggestions";
import type { FieldPairSuggestion, IdentityOptionsSuggestion, ModeSuggestion } from "./analysis/smart_defaults";
import type { ObservedPair } from "./analysis/mapping_analysis";
import type { PairMismatchSummary } from "./analysis/results_analysis";
import type { FixHint, ResultRow, ResultRowsPage, RowFilter, RowQuery } from "./analysis/result_rows";
import type { FieldSelection, WizardConfiguration } from "./core/contract_builder";
import type { ExportFormat, ImportedContract } from "./reconciliation.worker";
import type { ComparisonMode, DatasetSummary, IdentityNormalizerName, ReconciliationContract, ValueFormat } from "./core/types";
import type { ContractSummary } from "./ui/contract_summary";
import { manualRow, MappingEditorRow, rowsFromEvidence, selectionsFromRows } from "./ui/mapping_editor";
import { busyLabel } from "./ui/busy";
import { kpiTiles } from "./ui/metrics";
import { debounce } from "./ui/debounce";
import { assertCsvFile } from "./ui/files";
import { LOCKED_NOTES, STEP_IDS, StepId, stepStates } from "./ui/steps";
import { loadRemembered, pairKey, RememberedSettings, saveRemembered } from "./ui/storage";
import { $, button, node, selectOf } from "./ui/dom";
import { count, FRIENDLY_ERRORS, IDENTITY_OPTION_LABELS, MODE_CHOICES, modeAction, modeChoice, percent, plural, ROW_STATUS } from "./ui/labels";
import { onBusyChange, onWorkerCrash, parseAndProfileInWorker, queryWorker, reconcileInWorker, ReconciliationDashboard, terminateReconciliationWorker, WorkerPage } from "./worker_client";

type Side = "left" | "right";
type Area = "load" | "settings" | "results";

interface LoadedFile {
  file: File;
  summary: DatasetSummary;
  profiles: ColumnProfile[];
  encoding: CsvEncoding;
  // The encoding was detected rather than chosen.
  detected: boolean;
}

interface MappingState {
  rows: MappingEditorRow[];
  loaded: boolean;
  page: number;
}

interface ColumnRow {
  id: number;
  include: boolean;
  left_column: string;
  right_column: string;
  mode: ComparisonMode;
  format?: ValueFormat;
  tolerance?: number;
  suggestion: ModeSuggestion | null;
  // Why the columns were paired, when it is not obvious from their names.
  pairReason: string | null;
  remembered: boolean;
  mapping: MappingState | null;
}

interface ViewState {
  filter: RowFilter;
  field: string | null;
  pair: { left: string | null; right: string | null } | null;
  search: string;
  page: number;
}

interface RunState {
  contract: ReconciliationContract;
  dashboard: ReconciliationDashboard;
}

const PAGE_SIZE = 100;
const MAPPING_PAGE_SIZE = 50;
const DEFAULT_VIEW: ViewState = { filter: "issues", field: null, pair: null, search: "", page: 0 };

const state = {
  files: { left: null, right: null } as Record<Side, LoadedFile | null>,
  key: { left: "", right: "", normalize: [] as IdentityNormalizerName[] },
  keyStats: null as IdentityOptionsSuggestion | null,
  // Options switched on automatically, and how many keys they won.
  keyAuto: null as { options: IdentityNormalizerName[]; gained: number } | null,
  columns: [] as ColumnRow[],
  imported: null as { contract: ReconciliationContract; summary: ContractSummary; fileName: string } | null,
  run: null as RunState | null,
  stale: false,
  view: { ...DEFAULT_VIEW } as ViewState,
  patterns: new Map<string, PairMismatchSummary[]>(),
  remembered: loadRemembered() as RememberedSettings,
};

// Generations guard every async step: a response for an older session,
// upload or settings revision is dropped.
let session = 0;
let setupGeneration = 0;
let runGeneration = 0;
let rowsGeneration = 0;
let nextColumnId = 1;
const uploadGeneration: Record<Side, number> = { left: 0, right: 0 };
const downloadUrls = new Set<string>();

const sideName = (side: Side) => (side === "left" ? "A" : "B");
const fileName = (side: Side) => state.files[side]?.summary.name ?? `File ${sideName(side)}`;
const names = () => ({ a: fileName("left"), b: fileName("right") });

// ---------- Steps ----------

function updateSteps(): void {
  const states = stepStates({ filesLoaded: Boolean(state.files.left && state.files.right), hasResults: state.run !== null, stale: state.stale });
  for (const step of STEP_IDS) {
    const section = $(`#step-${step}`);
    section.dataset.state = states[step];
    section.toggleAttribute("inert", states[step] === "locked");
    const note = section.querySelector(".locked-note");
    if (note) note.textContent = LOCKED_NOTES[step];
  }
  const exportToggle = $<HTMLButtonElement>("#export-toggle");
  exportToggle.disabled = state.run === null;
  exportToggle.title = state.run ? "" : "Compare the files first";
}

function focusStep(step: StepId): void {
  const heading = $(`#step-${step}-title`);
  heading.focus({ preventScroll: true });
  heading.closest("section")!.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

// ---------- Messages ----------

interface MessageOptions {
  tone: "info" | "ok" | "warn" | "error" | "accent";
  title: string;
  detail?: string;
  actions?: HTMLElement[];
  dismissible?: boolean;
  id?: string;
}

const MESSAGE_ICONS = { info: "i", ok: "✓", warn: "!", error: "✕", accent: "→" } as const;

function messageElement(options: MessageOptions): HTMLDivElement {
  const element = node("div", "", "message");
  element.dataset.tone = options.tone;
  if (options.id) element.dataset.id = options.id;
  element.setAttribute("role", options.tone === "error" ? "alert" : "status");
  const body = node("div", "", "message-body");
  body.append(node("p", options.title));
  if (options.detail) body.append(node("p", options.detail, "message-detail"));
  if (options.actions?.length) {
    const actions = node("div", "", "message-actions");
    actions.append(...options.actions);
    body.append(actions);
  }
  element.append(node("span", MESSAGE_ICONS[options.tone], "message-icon"), body);
  if (options.dismissible) element.append(button("Dismiss", "ghost dismiss", () => element.remove()));
  return element;
}

function showMessage(area: Area, options: MessageOptions): void {
  const container = $(`#${area}-messages`);
  if (options.id) container.querySelector(`[data-id="${options.id}"]`)?.remove();
  container.append(messageElement(options));
}

function clearMessages(area: Area, id?: string): void {
  const container = $(`#${area}-messages`);
  if (id) container.querySelector(`[data-id="${id}"]`)?.remove();
  else container.replaceChildren();
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function currentArea(): Area {
  if (state.run) return "results";
  return state.files.left && state.files.right ? "settings" : "load";
}

// Errors appear inside the card they belong to, in plain words.
function showError(error: unknown, area: Area = currentArea()): void {
  const code = errorCodeOf(error);
  const technical = error instanceof Error ? error.message : String(error);
  const friendly = FRIENDLY_ERRORS[code];
  const unexpected = code === "UNKNOWN" || code === "INTERNAL" || code === "WORKER_PROTOCOL";
  showMessage(area, {
    tone: "error",
    title: friendly ?? (unexpected ? "Something went wrong. Start over and try again." : capitalize(technical)),
    detail: friendly && !unexpected ? capitalize(technical) : undefined,
    dismissible: true,
    id: "error",
  });
  if (unexpected) console.error(error);
  $(`#${area}-messages`).scrollIntoView({ block: "nearest" });
}

function toast(text: string): void {
  const element = $("#toast");
  element.textContent = text;
  element.hidden = false;
  window.clearTimeout(Number(element.dataset.timer));
  element.dataset.timer = String(window.setTimeout(() => { element.hidden = true; }, 4000));
}

// ---------- Step 1: load files ----------

async function upload(side: Side, file: File, encoding?: CsvEncoding): Promise<void> {
  clearMessages("load");
  assertCsvFile(file.name, file.type);
  checkFileSize(file.name, file.size);
  const request = ++uploadGeneration[side];
  const currentSession = session;
  const isCurrent = () => currentSession === session && request === uploadGeneration[side];
  resetSettings();
  state.files[side] = null;
  renderFile(side);
  updateSteps();

  const parse = async (chosen: CsvEncoding) => parseAndProfileInWorker({
    content: await file.arrayBuffer(),
    name: file.name.replace(/\.[^/.]+$/, "") || `File ${sideName(side)}`,
    fileName: file.name,
    side,
    encoding: chosen,
    sessionGeneration: currentSession,
  });
  let chosen: CsvEncoding = encoding ?? "utf-8";
  let parsed: Awaited<ReturnType<typeof parse>>;
  try {
    try {
      parsed = await parse(chosen);
    } catch (error) {
      // Excel exports are often Windows-1252: retry once before bothering anyone.
      if (encoding || errorCodeOf(error) !== "CSV_ENCODING" || !isCurrent()) throw error;
      chosen = "windows-1252";
      parsed = await parse(chosen);
    }
  } catch (error) {
    if (!isCurrent()) return;
    $(`#drop-${side}`).classList.add("error");
    showError(error, "load");
    return;
  }
  if (!isCurrent()) return;
  state.files[side] = { file, summary: parsed.summary, profiles: parsed.profiles, encoding: chosen, detected: !encoding };
  renderFile(side);
  updateSteps();
  if (state.files.left && state.files.right) await setupSettings();
}

function renderFile(side: Side): void {
  const zone = $(`#drop-${side}`);
  const empty = zone.querySelector<HTMLElement>(".dz-empty")!;
  const loaded = zone.querySelector<HTMLElement>(".dz-loaded")!;
  const data = state.files[side];
  zone.classList.toggle("loaded", data !== null);
  zone.classList.remove("error");
  empty.hidden = data !== null;
  loaded.hidden = data === null;
  loaded.replaceChildren();
  if (!data) return;

  const { summary, file } = data;
  const summaryRow = node("div", "", "file-summary");
  const text = node("div", "", "file-text");
  const title = node("p", file.name, "file-name");
  title.title = file.name;
  const encoding = data.encoding === "utf-8" ? "UTF-8" : "Windows-1252";
  text.append(title, node("p", `${plural(summary.recordCount, "row")} · ${plural(summary.columns.length, "column")} · ${encoding}${data.detected && data.encoding !== "utf-8" ? " (detected)" : ""}`, "file-meta"));
  summaryRow.append(node("span", "", "file-icon"), text);

  const actions = node("div", "", "file-actions");
  actions.append(button("Replace", "link", () => $<HTMLInputElement>(`#${side}-file`).click()));

  const details = node("details", "", "disclosure");
  details.append(node("summary", "Preview and file options"));
  const body = node("div", "", "disclosure-body");

  const nameField = node("label", "", "field");
  nameField.append(node("span", "Name used in results and reports", "field-label"));
  const nameInput = node("input");
  nameInput.type = "text";
  nameInput.value = summary.name;
  nameInput.addEventListener("change", () => {
    const trimmed = nameInput.value.trim();
    if (!trimmed) {
      nameInput.value = summary.name;
      return;
    }
    summary.name = trimmed;
    settingsChanged();
  });
  nameField.append(nameInput);

  const encodingField = node("label", "", "field");
  encodingField.append(node("span", "Text encoding (change it if accents look wrong)", "field-label"));
  const encodingSelect = selectOf([{ value: "utf-8", label: "UTF-8" }, { value: "windows-1252", label: "Windows-1252 (older Excel exports)" }], data.encoding);
  encodingSelect.addEventListener("change", () => { void upload(side, file, encodingSelect.value as CsvEncoding).catch((error) => showError(error, "load")); });
  encodingField.append(encodingSelect);

  body.append(nameField, encodingField, previewTable(summary));
  details.append(body);
  loaded.append(summaryRow, actions, details);
}

function previewTable(summary: DatasetSummary): HTMLElement {
  const wrapper = node("div", "", "table-card");
  const table = node("table");
  table.append(node("caption", `First ${summary.previewRecords.length} rows`, "sr-only"));
  const head = node("tr");
  for (const column of summary.columns) head.append(node("th", column));
  const thead = node("thead");
  thead.append(head);
  const tbody = node("tbody");
  for (const record of summary.previewRecords) {
    const row = node("tr");
    for (const column of summary.columns) row.append(valueCell(record[column] ?? null));
    tbody.append(row);
  }
  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function valueCell(value: string | null, className = ""): HTMLTableCellElement {
  const cell = node("td", value ?? "—", className);
  if (value === null) cell.classList.add("empty-value");
  return cell;
}

function setupDropzone(side: Side): void {
  const zone = $(`#drop-${side}`);
  const input = $<HTMLInputElement>(`#${side}-file`);
  const empty = zone.querySelector<HTMLElement>(".dz-empty")!;
  const open = () => input.click();
  empty.addEventListener("click", open);
  empty.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) upload(side, file).catch((error) => showError(error, "load"));
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag-over");
    const file = event.dataTransfer?.files[0];
    if (file) upload(side, file).catch((error) => showError(error, "load"));
  });
}

// ---------- Step 2: match settings ----------

function resetSettings(): void {
  setupGeneration++;
  invalidateRun();
  state.keyStats = null;
  state.keyAuto = null;
  state.columns = [];
  state.imported = null;
  for (const id of ["#key-left", "#key-right", "#key-evidence", "#column-list", "#unpaired", "#imported-summary", "#compare-summary"]) $(id).replaceChildren();
  $("#imported-summary").hidden = true;
  $("#wizard").hidden = false;
  clearMessages("settings");
}

async function setupSettings(): Promise<void> {
  const generation = ++setupGeneration;
  const left = state.files.left!.summary;
  const right = state.files.right!.summary;
  const suggestion = await queryWorker<IdentityCandidate>("suggest-identity", {}, session);
  if (generation !== setupGeneration) return;
  const remembered = state.remembered.key;
  const useRemembered = Boolean(remembered && left.columns.includes(remembered.left) && right.columns.includes(remembered.right));
  state.key.left = useRemembered ? remembered!.left : suggestion.left_column;
  state.key.right = useRemembered ? remembered!.right : suggestion.right_column;
  renderKeySelects();
  await applyKey({ automatic: true, rememberedOptions: useRemembered ? remembered!.normalize : null, generation });
  if (generation === setupGeneration) focusStep("settings");
}

function renderKeySelects(): void {
  for (const side of ["left", "right"] as const) {
    const columns = state.files[side]!.summary.columns.map((column) => ({ value: column, label: column }));
    const select = selectOf(columns, state.key[side]);
    select.id = `key-${side}`;
    select.addEventListener("change", () => {
      state.key[side] = select.value;
      void applyKey({ automatic: true, rememberedOptions: null, generation: ++setupGeneration }).catch((error) => showError(error, "settings"));
    });
    $(`#key-${side}`).replaceWith(select);
  }
}

function keyOptionInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("#key-options input[type=checkbox]"));
}

// Measures how the chosen key columns line up, switches on the options that
// match the most keys, then pairs the columns and picks how to compare them.
async function applyKey(options: { automatic: boolean; rememberedOptions: IdentityNormalizerName[] | null; generation: number }): Promise<void> {
  invalidateRun();
  const stats = await queryWorker<IdentityOptionsSuggestion>("identity-options", { leftColumn: state.key.left, rightColumn: state.key.right }, session);
  if (options.generation !== setupGeneration) return;
  state.keyStats = stats;
  state.keyAuto = null;
  if (options.rememberedOptions) {
    state.key.normalize = options.rememberedOptions;
  } else if (options.automatic) {
    state.key.normalize = stats.normalize;
    const gained = stats.matched_keys - stats.exact_matched_keys;
    if (gained > 0) state.keyAuto = { options: stats.normalize.filter((name) => name !== "trim" || stats.normalize.length === 1), gained };
  }
  for (const input of keyOptionInputs()) input.checked = state.key.normalize.includes(input.value as IdentityNormalizerName);
  renderKeyEvidence();
  await pairColumns(options.generation);
}

function keyCounts(normalize: IdentityNormalizerName[]) {
  const wanted = [...normalize].sort().join(",");
  return state.keyStats?.by_options.find((entry) => [...entry.normalize].sort().join(",") === wanted) ?? null;
}

function renderKeyEvidence(): void {
  const target = $("#key-evidence");
  target.replaceChildren();
  const stats = state.keyStats;
  const current = keyCounts(state.key.normalize);
  if (!stats || !current) return;
  const ratio = current.left_keys > 0 ? current.matched_keys / current.left_keys : 0;
  const tone = ratio >= 0.9 ? "ok" : ratio >= 0.5 ? "warn" : "error";
  const found = `${count(current.matched_keys)} of ${count(current.left_keys)} keys in File A were also found in File B (${percent(current.matched_keys, current.left_keys)}).`;
  const advice = tone === "ok" ? "" : tone === "warn"
    ? "Some missing keys can be normal (joiners and leavers); if many are, check the key columns."
    : "This is probably not the right column. Choose the columns that identify the same person in both files.";
  const parts: MessageOptions = { tone, title: found, detail: advice || undefined };

  if (state.keyAuto && state.keyAuto.options.length) {
    const labels = state.keyAuto.options.map((name) => `“${IDENTITY_OPTION_LABELS[name].replace(/ \(.*\)$/, "").toLowerCase()}”`).join(" and ");
    parts.detail = [advice, `Switched on ${labels}: that matches ${plural(state.keyAuto.gained, "more key")}.`].filter(Boolean).join(" ");
    ($("#key-options") as HTMLDetailsElement).open = true;
  }
  const best = keyCounts(stats.normalize);
  if (best && best.matched_keys > current.matched_keys) {
    const missing = stats.normalize.filter((name) => !state.key.normalize.includes(name));
    parts.actions = [button(`Turn on ${missing.map((name) => `“${IDENTITY_OPTION_LABELS[name].replace(/ \(.*\)$/, "").toLowerCase()}”`).join(" and ")} (+${count(best.matched_keys - current.matched_keys)} keys)`, "link", () => {
      state.key.normalize = stats.normalize;
      for (const input of keyOptionInputs()) input.checked = state.key.normalize.includes(input.value as IdentityNormalizerName);
      renderKeyEvidence();
      settingsChanged();
    })];
  }
  target.append(messageElement(parts));
}

async function pairColumns(generation: number): Promise<void> {
  const identity = { leftIdentity: state.key.left, rightIdentity: state.key.right, identityNormalize: state.key.normalize };
  const pairs = await queryWorker<FieldPairSuggestion[]>("suggest-fields", identity, session);
  if (generation !== setupGeneration) return;
  const modes = await queryWorker<ModeSuggestion[]>("suggest-modes", { ...identity, fields: pairs }, session);
  if (generation !== setupGeneration) return;
  state.columns = pairs.map((pair, index) => {
    const suggestion = modes[index];
    const remembered = state.remembered.columns[pairKey(pair.left_column, pair.right_column)];
    return {
      id: nextColumnId++,
      include: remembered?.include ?? true,
      left_column: pair.left_column,
      right_column: pair.right_column,
      mode: remembered?.mode ?? suggestion.mode,
      format: remembered ? remembered.format : suggestion.format,
      tolerance: remembered?.tolerance,
      suggestion,
      pairReason: pair.by === "content" ? pair.reason : null,
      remembered: Boolean(remembered),
      mapping: null,
    };
  });
  renderColumns();
  for (const row of state.columns) if (row.include && row.mode === "Value mapping") void loadMapping(row).catch((error) => showError(error, "settings"));
}

function keyColumns() {
  return { left: state.files.left!.summary.columns.filter((column) => column !== state.key.left), right: state.files.right!.summary.columns.filter((column) => column !== state.key.right) };
}

function renderColumns(): void {
  const list = $("#column-list");
  list.replaceChildren(...state.columns.map(columnRowElement));
  if (state.columns.length === 0) list.append(node("p", "No columns are paired yet. Add a column pair to compare.", "empty-state"));
  renderUnpaired();
  renderCompareSummary();
}

function columnRowElement(row: ColumnRow): HTMLElement {
  const element = node("div", "", "column-row");
  element.setAttribute("role", "listitem");
  element.dataset.id = String(row.id);
  element.classList.toggle("excluded", !row.include);
  const { left, right } = keyColumns();

  const main = node("div", "", "column-main");
  const include = node("label", "", "include");
  const checkbox = node("input");
  checkbox.type = "checkbox";
  checkbox.checked = row.include;
  checkbox.setAttribute("aria-label", `Compare ${row.left_column}`);
  checkbox.addEventListener("change", () => {
    row.include = checkbox.checked;
    element.classList.toggle("excluded", !row.include);
    if (row.include && row.mode === "Value mapping" && !row.mapping) void loadMapping(row).catch((error) => showError(error, "settings"));
    settingsChanged();
    renderCompareSummary();
  });
  include.append(checkbox);

  const columnSelect = (side: Side) => {
    const select = selectOf((side === "left" ? left : right).map((column) => ({ value: column, label: column })), side === "left" ? row.left_column : row.right_column);
    select.className = side === "left" ? "a" : "b";
    select.setAttribute("aria-label", `Column in File ${sideName(side)}`);
    select.addEventListener("change", () => {
      if (side === "left") row.left_column = select.value;
      else row.right_column = select.value;
      row.pairReason = null;
      row.mapping = null;
      settingsChanged();
      void resuggestMode(row).catch((error) => showError(error, "settings"));
    });
    return select;
  };

  const how = selectOf(MODE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })), modeChoice(row.mode, row.format).value);
  how.className = "how";
  how.setAttribute("aria-label", `How to compare ${row.left_column}`);
  how.addEventListener("change", () => {
    const choice = MODE_CHOICES.find((item) => item.value === how.value)!;
    setMode(row, choice.mode, choice.format);
  });

  main.append(include, columnSelect("left"), node("span", "↔", "pair-arrow"), columnSelect("right"), how);
  if (row.mode === "Number") main.append(toleranceField(row));
  element.append(main, columnHint(row));
  if (row.mode === "Value mapping" && row.include) element.append(translationsPanel(row));
  return element;
}

function toleranceField(row: ColumnRow): HTMLElement {
  const label = node("label", "", "tolerance");
  label.append("Ignore differences up to");
  const input = node("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.placeholder = "0";
  input.value = row.tolerance ? String(row.tolerance) : "";
  input.setAttribute("aria-label", `Ignore differences in ${row.left_column} up to`);
  input.addEventListener("change", () => {
    const value = Number(input.value);
    row.tolerance = input.value.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined;
    input.value = row.tolerance ? String(row.tolerance) : "";
    settingsChanged();
  });
  label.append(input);
  return label;
}

function columnHint(row: ColumnRow): HTMLElement {
  const hint = node("div", "", "column-hint");
  const suggestion = row.suggestion;
  if (row.pairReason) hint.append(node("span", row.pairReason + "."));
  if (!suggestion || suggestion.left_column !== row.left_column || suggestion.right_column !== row.right_column) return hint;
  const chosen = modeChoice(row.mode, row.format);
  const suggested = modeChoice(suggestion.mode, suggestion.format);
  if (chosen.value === suggested.value) {
    hint.prepend(node("span", "Suggested", "tag"), node("span", suggestion.reason));
  } else {
    hint.classList.add("differs");
    hint.prepend(
      node("span", row.remembered ? "Your earlier choice" : "Suggestion", "tag"),
      node("span", `${suggested.label}: ${suggestion.reason}`),
      button("Use suggestion", "link", () => setMode(row, suggestion.mode, suggestion.format)),
    );
  }
  return hint;
}

function setMode(row: ColumnRow, mode: ComparisonMode, format?: ValueFormat): void {
  row.mode = mode;
  row.format = format;
  if (mode !== "Number") row.tolerance = undefined;
  settingsChanged();
  rerenderColumn(row);
  if (mode === "Value mapping" && row.include && !row.mapping) void loadMapping(row).catch((error) => showError(error, "settings"));
}

function rerenderColumn(row: ColumnRow): void {
  const current = document.querySelector(`#column-list [data-id="${row.id}"]`);
  if (current) current.replaceWith(columnRowElement(row));
  else renderColumns();
}

// After the user re-pairs a column, measure the new pair and adopt its suggested mode.
async function resuggestMode(row: ColumnRow): Promise<void> {
  const generation = setupGeneration;
  row.suggestion = null;
  rerenderColumn(row);
  renderUnpaired();
  const [suggestion] = await queryWorker<ModeSuggestion[]>("suggest-modes", {
    leftIdentity: state.key.left, rightIdentity: state.key.right, identityNormalize: state.key.normalize,
    fields: [{ left_column: row.left_column, right_column: row.right_column }],
  }, session);
  if (generation !== setupGeneration || suggestion.left_column !== row.left_column || suggestion.right_column !== row.right_column) return;
  row.suggestion = suggestion;
  row.remembered = false;
  setMode(row, suggestion.mode, suggestion.format);
}

function renderUnpaired(): void {
  const target = $("#unpaired");
  target.replaceChildren();
  if (!state.files.left || !state.files.right) return;
  const { left, right } = keyColumns();
  const usedLeft = new Set(state.columns.map((row) => row.left_column));
  const usedRight = new Set(state.columns.map((row) => row.right_column));
  const freeLeft = left.filter((column) => !usedLeft.has(column));
  const freeRight = right.filter((column) => !usedRight.has(column));
  if (freeLeft.length + freeRight.length === 0) return;
  target.append("Not compared: ");
  if (freeLeft.length) {
    target.append("File A ");
    target.append(node("b", freeLeft.join(", ")));
  }
  if (freeLeft.length && freeRight.length) target.append(" · ");
  if (freeRight.length) {
    target.append("File B ");
    target.append(node("b", freeRight.join(", ")));
  }
  $<HTMLButtonElement>("#add-pair").disabled = freeLeft.length === 0 || freeRight.length === 0;
}

function addPair(): void {
  const { left, right } = keyColumns();
  const usedLeft = new Set(state.columns.map((row) => row.left_column));
  const usedRight = new Set(state.columns.map((row) => row.right_column));
  const leftColumn = left.find((column) => !usedLeft.has(column));
  const rightColumn = right.find((column) => !usedRight.has(column));
  if (!leftColumn || !rightColumn) return;
  const row: ColumnRow = { id: nextColumnId++, include: true, left_column: leftColumn, right_column: rightColumn, mode: "Exact", suggestion: null, pairReason: null, remembered: false, mapping: null };
  state.columns.push(row);
  renderColumns();
  settingsChanged();
  document.querySelector<HTMLSelectElement>(`#column-list [data-id="${row.id}"] select.a`)?.focus();
  void resuggestMode(row).catch((error) => showError(error, "settings"));
}

function renderCompareSummary(): void {
  const included = state.columns.filter((row) => row.include).length;
  $("#compare-summary").textContent = state.imported ? "" : included === 0 ? "Tick at least one column to compare." : `Compares ${plural(included, "column")} for every key found in both files.`;
}

// ---------- Translations (value mappings) ----------

async function loadMapping(row: ColumnRow): Promise<void> {
  const generation = setupGeneration;
  const pair = `${row.left_column}\u0000${row.right_column}`;
  const evidence = await queryWorker<ObservedPair[]>("mapping-evidence", {
    leftIdentity: state.key.left, rightIdentity: state.key.right, identityNormalize: state.key.normalize,
    leftField: row.left_column, rightField: row.right_column,
  }, session);
  if (generation !== setupGeneration || pair !== `${row.left_column}\u0000${row.right_column}` || row.mapping?.loaded) return;
  // Identical values already match; only differing pairs need a translation.
  row.mapping = { rows: rowsFromEvidence(evidence).filter((item) => item.left !== item.right), loaded: true, page: 0 };
  rerenderColumn(row);
}

function translationsPanel(row: ColumnRow): HTMLElement {
  const panel = node("div", "", "translations");
  const mapping = row.mapping;
  if (!mapping) {
    panel.append(node("p", "Collecting the values to translate…", "helper"));
    return panel;
  }
  const ticked = mapping.rows.filter((item) => item.accepted).length;
  panel.append(node("p", `Tick the pairs that mean the same thing; unticked pairs count as differences. ${count(ticked)} of ${count(mapping.rows.length)} ticked.`, "helper"));
  if (mapping.rows.length === 0) {
    panel.append(node("p", "The values in these columns are already identical where they exist on both sides, so there is nothing to translate. Add a translation, or compare exactly.", "helper"));
  } else {
    const pages = Math.max(1, Math.ceil(mapping.rows.length / MAPPING_PAGE_SIZE));
    mapping.page = Math.min(mapping.page, pages - 1);
    const wrapper = node("div", "", "table-card");
    const table = node("table");
    table.append(node("caption", `Translations for ${row.left_column}`, "sr-only"));
    const head = node("tr");
    for (const [label, className] of [["Same?", ""], [`Value in ${fileName("left")}`, "sub-a"], [`Value in ${fileName("right")}`, "sub-b"], ["Rows", "num"], ["", ""]]) head.append(node("th", label, className));
    const thead = node("thead");
    thead.append(head);
    const tbody = node("tbody");
    for (const item of mapping.rows.slice(mapping.page * MAPPING_PAGE_SIZE, (mapping.page + 1) * MAPPING_PAGE_SIZE)) tbody.append(translationRow(row, item));
    table.className = "results";
    table.append(thead, tbody);
    wrapper.append(table);
    panel.append(wrapper);
    if (pages > 1) {
      const pager = node("div", "", "pager");
      pager.append(
        node("span", `Page ${mapping.page + 1} of ${pages}`),
        pageButton("Previous", mapping.page === 0, () => { mapping.page--; rerenderColumn(row); }),
        pageButton("Next", mapping.page + 1 >= pages, () => { mapping.page++; rerenderColumn(row); }),
      );
      panel.append(pager);
    }
  }
  const actions = node("div", "", "actions");
  actions.append(button("Add a translation", "secondary small", () => {
    const added = manualRow();
    mapping.rows.push(added);
    mapping.page = Math.floor((mapping.rows.length - 1) / MAPPING_PAGE_SIZE);
    settingsChanged();
    rerenderColumn(row);
  }));
  if (mapping.rows.length > 1) {
    actions.append(
      button("Tick all", "link", () => { for (const item of mapping.rows) if (item.left !== null && item.right !== null) item.accepted = true; settingsChanged(); rerenderColumn(row); }),
      button("Untick all", "link", () => { for (const item of mapping.rows) item.accepted = false; settingsChanged(); rerenderColumn(row); }),
    );
  }
  panel.append(actions);
  return panel;
}

function translationRow(row: ColumnRow, item: MappingEditorRow): HTMLTableRowElement {
  const tr = node("tr");
  const checkCell = node("td");
  const checkbox = node("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.accepted;
  const complete = item.left !== null && item.right !== null;
  checkbox.disabled = !complete && item.assessment !== "Manual";
  checkbox.setAttribute("aria-label", `Treat ${item.left ?? "empty"} and ${item.right ?? "empty"} as the same`);
  checkbox.addEventListener("change", () => {
    item.accepted = checkbox.checked;
    settingsChanged();
    rerenderColumn(row);
  });
  checkCell.append(checkbox);
  tr.append(checkCell);

  for (const side of ["left", "right"] as const) {
    if (item.assessment === "Manual") {
      const cell = node("td");
      const input = node("input");
      input.type = "text";
      input.value = item[side] ?? "";
      input.placeholder = `Value in File ${sideName(side)}`;
      input.addEventListener("change", () => {
        item[side] = input.value === "" ? null : input.value;
        item.canonical = "";
        settingsChanged();
      });
      cell.append(input);
      tr.append(cell);
    } else {
      tr.append(valueCell(item[side], "mono"));
    }
  }
  const evidence = item.assessment === "Manual" ? "Added by you" : item.assessment === "Imported" ? "From saved settings" : count(item.count);
  tr.append(node("td", evidence, item.assessment === "Manual" || item.assessment === "Imported" ? "note" : "num"));
  const removeCell = node("td");
  if (item.assessment === "Manual") {
    removeCell.append(button("Remove", "link", () => {
      row.mapping!.rows.splice(row.mapping!.rows.indexOf(item), 1);
      settingsChanged();
      rerenderColumn(row);
    }));
  } else if (!complete) {
    removeCell.append(node("span", "One side is empty", "helper"));
  } else if (item.consistency_percentage < 95 && item.assessment !== "Imported") {
    removeCell.append(node("span", "Not always paired", "helper"));
  }
  tr.append(removeCell);
  return tr;
}

// ---------- Settings → contract ----------

function slug(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "reconciliation";
}

function configuration(): WizardConfiguration {
  const included = state.columns.filter((row) => row.include);
  if (included.length === 0) throw new AppError("CONTRACT_INVALID", "tick at least one column to compare");
  for (const side of ["left_column", "right_column"] as const) {
    const seen = new Set<string>();
    for (const row of included) {
      if (seen.has(row[side])) throw new AppError("CONTRACT_INVALID", `the column “${row[side]}” is used in two pairs; each column can be compared once`);
      seen.add(row[side]);
    }
  }
  const fields: FieldSelection[] = included.map((row) => ({
    left_column: row.left_column,
    right_column: row.right_column,
    mode: row.mode,
    ...(row.format ? { format: row.format } : {}),
    ...(row.mode === "Number" && row.tolerance ? { tolerance: row.tolerance } : {}),
    ...(row.mode === "Value mapping" ? { value_mappings: selectionsFromRows(row.left_column, row.mapping?.rows ?? []) } : {}),
  }));
  const { a, b } = names();
  return {
    contract_name: slug(`${a}_vs_${b}`),
    left_name: a,
    right_name: b,
    left_identity: state.key.left,
    right_identity: state.key.right,
    identity_normalize: state.key.normalize,
    fields,
  };
}

async function buildContract(): Promise<ReconciliationContract> {
  // Translations are collected on demand; make sure every one is ready.
  for (const row of state.columns) if (row.include && row.mode === "Value mapping" && !row.mapping) await loadMapping(row);
  return queryWorker<ReconciliationContract>("build-contract", { configuration: configuration() }, session);
}

// Every settings edit marks earlier results as out of date and is remembered.
function settingsChanged(): void {
  rememberSettings();
  if (!state.run) return;
  if (!state.stale) {
    state.stale = true;
    showMessage("results", {
      tone: "warn",
      id: "stale",
      title: "The settings changed since these results were made.",
      detail: "Compare again to update them.",
      actions: [button("Compare again", "secondary small", () => { void compare().catch((error) => showError(error, "settings")); })],
    });
  }
  updateSteps();
}

function rememberSettings(): void {
  if (state.imported || !state.key.left) return;
  const remembered = state.remembered;
  remembered.key = { left: state.key.left, right: state.key.right, normalize: [...state.key.normalize] };
  for (const row of state.columns) {
    const suggested = row.suggestion && modeChoice(row.suggestion.mode, row.suggestion.format).value === modeChoice(row.mode, row.format).value;
    const key = pairKey(row.left_column, row.right_column);
    // Only deliberate choices are remembered; suggestions are recomputed from the data.
    if (row.include && suggested && !row.tolerance) delete remembered.columns[key];
    else remembered.columns[key] = { include: row.include, mode: row.mode, format: row.format, tolerance: row.tolerance };
  }
  saveRemembered(remembered);
}

// ---------- Run ----------

function invalidateRun(): void {
  runGeneration++;
  rowsGeneration++;
  state.run = null;
  state.stale = false;
  state.patterns.clear();
  for (const id of ["#verdict", "#kpis", "#hints", "#column-summary", "#active-filters", "#row-count", "#results-table", "#pager"]) $(id).replaceChildren();
  clearMessages("results");
  updateSteps();
}

async function compare(): Promise<void> {
  clearMessages("settings", "error");
  const contract = state.imported ? state.imported.contract : await buildContract();
  await runContract(contract);
}

async function runContract(contract: ReconciliationContract): Promise<void> {
  const generation = ++runGeneration;
  const currentSession = session;
  const dashboard = await reconcileInWorker({ contract, sessionGeneration: currentSession });
  if (generation !== runGeneration || currentSession !== session) return;
  rowsGeneration++;
  state.run = { contract, dashboard };
  state.stale = false;
  state.patterns.clear();
  const issues = dashboard.rows.differs + dashboard.rows.only_a + dashboard.rows.only_b + dashboard.rows.duplicate + dashboard.rows.blank_key;
  state.view = { ...DEFAULT_VIEW, filter: issues === 0 ? "all" : "issues" };
  ($("#search") as HTMLInputElement).value = "";
  clearMessages("results");
  updateSteps();
  renderResults();
  await loadRows();
  focusStep("results");
}

// ---------- Step 3: results ----------

function renderResults(): void {
  const run = state.run;
  if (!run) return;
  const { rows } = run.dashboard;
  const { a, b } = names();
  const inBoth = rows.match + rows.differs;
  const issues = rows.differs + rows.only_a + rows.only_b + rows.duplicate + rows.blank_key;
  const verdict = $("#verdict");
  verdict.classList.toggle("ok", issues === 0);
  if (issues === 0) {
    verdict.textContent = `✓ No differences: both files match on all ${plural(inBoth, "row")}.`;
  } else {
    const parts = [`${count(rows.differs)} of ${plural(inBoth, "matched row")} ${rows.differs === 1 ? "has" : "have"} differences`];
    if (rows.only_a) parts.push(`${count(rows.only_a)} only in ${a}`);
    if (rows.only_b) parts.push(`${count(rows.only_b)} only in ${b}`);
    if (rows.duplicate + rows.blank_key) parts.push(`${plural(rows.duplicate + rows.blank_key, "key")} to check`);
    verdict.textContent = `${parts.join(" · ")}.`;
  }
  renderKpis();
  renderHints(run.dashboard.hints);
  renderColumnSummary();
}

function renderKpis(): void {
  const run = state.run!;
  $("#kpis").replaceChildren(...kpiTiles(run.dashboard.rows, names()).map((tile) => {
    const element = button("", "kpi", () => setView({ filter: state.view.filter === tile.filter ? "issues" : tile.filter, field: null, pair: null }));
    element.dataset.tone = tile.tone;
    element.dataset.zero = String(tile.value === 0);
    element.setAttribute("aria-pressed", String(state.view.filter === tile.filter));
    const label = node("span", "", "kpi-label");
    label.append(node("span", tile.icon, "kpi-icon"), tile.label);
    element.append(node("span", count(tile.value), "kpi-value"), label);
    return element;
  }));
}

function renderHints(hints: FixHint[]): void {
  const target = $("#hints");
  target.replaceChildren();
  if (state.imported) return;
  for (const hint of hints) {
    const row = state.columns.find((item) => item.include && item.left_column === hint.field);
    if (!row) continue;
    const label = row.left_column === row.right_column ? row.left_column : `${row.left_column} / ${row.right_column}`;
    target.append(messageElement({
      tone: "accent",
      title: `${count(hint.fixes)} of ${plural(hint.differences, "difference")} in “${label}” look like formatting only.`,
      detail: `For example “${hint.example.a}” in ${fileName("left")} and “${hint.example.b}” in ${fileName("right")}.`,
      actions: [button(`${modeAction(hint.mode)} and update`, "secondary small", () => {
        setMode(row, hint.mode, hint.format);
        void compare().catch((error) => showError(error, "results"));
      })],
    }));
  }
}

function fieldLabel(fieldName: string): string {
  const field = state.run?.contract.fields.find((item) => item.name === fieldName);
  return field && field.left !== field.right ? `${field.left} / ${field.right}` : fieldName;
}

function renderColumnSummary(): void {
  const run = state.run!;
  const target = $("#column-summary");
  target.replaceChildren();
  const fields = run.dashboard.fields;
  if (fields.length === 0) {
    target.append(node("p", "Every compared column matches for all keys found in both files.", "helper"));
    return;
  }
  const max = Math.max(...fields.map((field) => field.mismatch_count));
  const bars = node("div", "", "bars");
  for (const field of fields) {
    const active = state.view.field === field.field_name;
    const row = button("", "bar-row", () => {
      setView(active ? { field: null, pair: null } : { field: field.field_name, pair: null, filter: "differs" });
      if (!active) void loadPatterns(field.field_name).catch((error) => showError(error, "results"));
    });
    row.setAttribute("aria-pressed", String(active));
    const track = node("span", "", "bar-track");
    const fill = node("span", "", "bar-fill");
    fill.style.width = `${Math.max(2, (field.mismatch_count / max) * 100)}%`;
    track.append(fill);
    row.append(node("span", fieldLabel(field.field_name), "bar-name"), track, node("span", `${plural(field.mismatch_count, "row")} · ${percent(field.mismatch_count, field.comparison_count)}`, "bar-count"));
    bars.append(row);
    if (active) bars.append(patternsElement(field.field_name));
  }
  target.append(bars);
}

function patternsElement(fieldName: string): HTMLElement {
  const box = node("div", "", "patterns");
  const patterns = state.patterns.get(fieldName);
  if (!patterns) {
    box.append(node("p", "Loading the most common differences…", "helper"));
    return box;
  }
  box.append(node("p", "Most common differences: choose one to see its rows", "helper"));
  for (const pattern of patterns) {
    const active = state.view.pair !== null && state.view.pair.left === pattern.left_value && state.view.pair.right === pattern.right_value;
    const item = button("", "ghost pattern", () => setView({ pair: active ? null : { left: pattern.left_value, right: pattern.right_value } }));
    item.setAttribute("aria-pressed", String(active));
    item.append(
      node("span", pattern.left_value === null ? "(empty)" : `“${pattern.left_value}”`, "mono"),
      node("span", "→", "arrow"),
      node("span", pattern.right_value === null ? "(empty)" : `“${pattern.right_value}”`, "mono"),
      node("span", `${plural(pattern.employee_count, "row")}`, "times"),
    );
    box.append(item);
  }
  return box;
}

async function loadPatterns(fieldName: string): Promise<void> {
  if (!state.run || state.patterns.has(fieldName)) return;
  const resultId = state.run.dashboard.resultId;
  const page = await queryWorker<WorkerPage<PairMismatchSummary>>("pairs", { fieldName, page: 0, pageSize: 5, resultId }, session);
  if (state.run?.dashboard.resultId !== resultId) return;
  state.patterns.set(fieldName, page.rows);
  renderColumnSummary();
}

function setView(change: Partial<ViewState>): void {
  state.view = { ...state.view, page: 0, ...change };
  renderKpis();
  renderColumnSummary();
  void loadRows().catch((error) => showError(error, "results"));
}

function renderChips(): void {
  const target = $("#active-filters");
  target.replaceChildren();
  const view = state.view;
  if (view.field) {
    target.append(button(`Column: ${fieldLabel(view.field)}`, "chip", () => setView({ field: null, pair: null })));
  }
  if (view.pair) {
    const shown = (value: string | null) => (value === null ? "(empty)" : `“${value}”`);
    target.append(button(`${shown(view.pair.left)} → ${shown(view.pair.right)}`, "chip", () => setView({ pair: null })));
  }
  for (const chip of target.querySelectorAll("button")) chip.setAttribute("aria-label", `Remove filter ${chip.textContent}`);
}

const FILTER_WORDS: Record<RowFilter, string> = {
  issues: "rows that need a look",
  all: "rows",
  match: "matching rows",
  differs: "rows with differences",
  only_a: "rows only in A",
  only_b: "rows only in B",
  warnings: "rows with duplicate or blank keys",
};

async function loadRows(): Promise<void> {
  const run = state.run;
  if (!run) return;
  const generation = ++rowsGeneration;
  const view = state.view;
  const query: RowQuery = { filter: view.filter, field: view.field, pair: view.pair, search: view.search, page: view.page, pageSize: PAGE_SIZE };
  const page = await queryWorker<ResultRowsPage>("result-rows", { query, resultId: run.dashboard.resultId }, session);
  if (generation !== rowsGeneration) return;
  renderChips();
  const first = page.total === 0 ? 0 : page.page * page.pageSize + 1;
  const last = Math.min(page.total, (page.page + 1) * page.pageSize);
  $("#row-count").textContent = page.total === 0 ? "" : `Showing ${count(first)}–${count(last)} of ${count(page.total)} ${FILTER_WORDS[view.filter]}`;
  renderTable(page);
  renderPager(page);
}

function renderTable(page: ResultRowsPage): void {
  const target = $("#results-table");
  target.replaceChildren();
  if (page.total === 0) {
    const run = state.run!;
    const clean = state.view.filter === "issues" && !state.view.search && !state.view.field;
    const empty = node("div", "", clean ? "empty-state ok" : "empty-state");
    if (clean) {
      const inBoth = run.dashboard.rows.match + run.dashboard.rows.differs;
      empty.append(node("span", "✓", "empty-icon"), node("p", `No differences: both files match on ${plural(inBoth, "row")}.`));
    } else {
      empty.append(node("p", "No rows match these filters."), button("Clear filters", "secondary small", () => {
        ($("#search") as HTMLInputElement).value = "";
        setView({ ...DEFAULT_VIEW });
      }));
    }
    target.append(empty);
    return;
  }
  const { a, b } = names();
  const keyLabel = state.run!.contract.identity.left;
  const table = node("table", "", "results");
  table.append(node("caption", "Comparison results", "sr-only"));
  const groupRow = node("tr");
  const subRow = node("tr");
  const statusHead = node("th", "Status", "sticky-1");
  const keyHead = node("th", keyLabel, "sticky-2");
  statusHead.rowSpan = 2;
  keyHead.rowSpan = 2;
  statusHead.scope = keyHead.scope = "col";
  groupRow.append(statusHead, keyHead);
  for (const column of page.columns) {
    const group = node("th", column.left === column.right ? column.name : `${column.left} / ${column.right}`, "group");
    group.colSpan = column.numeric ? 3 : 2;
    group.scope = "colgroup";
    groupRow.append(group);
    const subA = node("th", "A", `sub-a group-start${column.numeric ? " num" : ""}`);
    subA.title = `${column.left} in ${a}`;
    const subB = node("th", "B", `sub-b${column.numeric ? " num" : ""}`);
    subB.title = `${column.right} in ${b}`;
    subRow.append(subA, subB);
    if (column.numeric) {
      const delta = node("th", "Δ B − A", "num");
      delta.title = "Difference: value in B minus value in A";
      subRow.append(delta);
    }
  }
  const thead = node("thead");
  thead.append(groupRow, subRow);
  const tbody = node("tbody");
  for (const row of page.rows) tbody.append(resultRowElement(row, page, a, b));
  table.append(thead, tbody);
  target.append(table);
}

function resultRowElement(row: ResultRow, page: ResultRowsPage, a: string, b: string): HTMLTableRowElement {
  const tr = node("tr");
  const statusCell = node("td", "", "sticky-1");
  const badge = node("span", "", "badge");
  badge.dataset.status = row.status;
  const status = ROW_STATUS[row.status];
  const label = row.side && (row.status === "duplicate" || row.status === "blank_key") ? `${status.label} in ${row.side.toUpperCase()}` : status.label;
  badge.append(node("span", status.icon, "badge-icon"), label);
  statusCell.append(badge);

  const keyCell = node("td", "", "sticky-2 mono");
  const identity = row.identity === null || row.identity.trim() === "" ? "(blank)" : row.identity;
  keyCell.append(identity);
  if (row.status === "duplicate" || row.status === "blank_key") {
    const lines = row.side === "b" ? row.rightLines : row.leftLines;
    keyCell.append(node("span", `${lines.length > 1 ? "rows" : "row"} ${lines.join(", ")} in ${row.side === "b" ? b : a}`, "key-lines"));
  }
  keyCell.title = [row.leftLines.length ? `Row ${row.leftLines.join(", ")} in ${a}` : "", row.rightLines.length ? `Row ${row.rightLines.join(", ")} in ${b}` : ""].filter(Boolean).join(" · ");
  tr.append(statusCell, keyCell);

  row.cells.forEach((cell, index) => {
    const column = page.columns[index];
    const changed = cell.state === "differs" || cell.state === "a_empty" || cell.state === "b_empty";
    const absentA = row.status === "only_b" || ((row.status === "duplicate" || row.status === "blank_key") && row.side === "b");
    const absentB = row.status === "only_a" || ((row.status === "duplicate" || row.status === "blank_key") && row.side === "a");
    const valueClass = `${column.numeric ? "num" : "mono"}${changed ? " cell-diff" : ""}`;
    const cellA = absentA ? valueCell(null, "group-start") : valueCell(cell.a, `group-start ${valueClass}`);
    const cellB = absentB ? valueCell(null) : valueCell(cell.b, valueClass);
    tr.append(cellA, cellB);
    if (column.numeric) {
      const delta = cell.delta !== null ? `${cell.delta.startsWith("-") ? "−" : "+"}${groupDigits(cell.delta.replace(/^-/, ""))}` : changed ? "≠" : "";
      tr.append(node("td", delta, `num${changed ? " delta" : ""}`));
    }
  });
  return tr;
}

function groupDigits(value: string): string {
  const [integer, fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

function pageButton(text: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const element = button(text, "secondary small", onClick);
  element.disabled = disabled;
  return element;
}

function renderPager(page: ResultRowsPage): void {
  const target = $("#pager");
  target.replaceChildren();
  const pages = Math.ceil(page.total / page.pageSize);
  if (pages <= 1) return;
  target.append(
    node("span", `Page ${count(page.page + 1)} of ${count(pages)}`),
    pageButton("Previous", page.page === 0, () => { state.view.page--; void loadRows().catch((error) => showError(error, "results")); }),
    pageButton("Next", page.page + 1 >= pages, () => { state.view.page++; void loadRows().catch((error) => showError(error, "results")); }),
  );
}

const searchEdited = debounce(() => setView({ search: ($("#search") as HTMLInputElement).value }), 250);

// ---------- Export ----------

const EXPORT_FILES: Record<ExportFormat, string> = {
  "differences.csv": "differences.csv",
  "comparison.csv": "comparison.csv",
  "report.html": "report.html",
  "summary.txt": "summary.txt",
  "report.json": "audit.json",
  "full.csv": "raw_results.csv",
  "mismatches.csv": "raw_differences.csv",
};

async function exportBlob(format: ExportFormat): Promise<Blob> {
  if (!state.run) throw new AppError("SESSION_STATE", "compare the files first");
  const excelSafe = ($("#excel-safe") as HTMLInputElement).checked;
  return queryWorker<Blob>("export", { format, resultId: state.run.dashboard.resultId, excelSafe }, session);
}

async function download(format: ExportFormat): Promise<void> {
  const blob = await exportBlob(format);
  const name = `${state.run!.contract.name}_${EXPORT_FILES[format]}`;
  saveBlob(blob, name);
  toast(`Downloaded ${name}${state.stale ? " (from the results before your latest settings change)" : ""}`);
}

async function copySummary(): Promise<void> {
  const text = await (await exportBlob("summary.txt")).text();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (some file:// contexts): fall back to a selection copy.
    const area = node("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new AppError("UNKNOWN", "the browser blocked copying; use the printable report instead");
  }
  toast("Summary copied to the clipboard");
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

function setupExportMenu(): void {
  const toggle = $<HTMLButtonElement>("#export-toggle");
  const panel = $("#export-panel");
  const items = () => Array.from(panel.querySelectorAll<HTMLButtonElement>(".menu-item"));
  const setOpen = (open: boolean, focusToggle = false) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) items()[0]?.focus();
    else if (focusToggle) toggle.focus();
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !$("#export-menu").contains(event.target as Node)) setOpen(false);
  });
  panel.addEventListener("keydown", (event) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") setOpen(false, true);
    else if (event.key === "ArrowDown") { event.preventDefault(); list[(at + 1) % list.length].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
  });
  for (const item of items()) {
    item.addEventListener("click", () => {
      setOpen(false);
      const task = item.dataset.action === "copy-summary" ? copySummary() : download(item.dataset.export as ExportFormat);
      task.catch((error) => showError(error, "results"));
    });
  }
}

// ---------- Saved settings ----------

async function saveSettings(): Promise<void> {
  const contract = state.imported ? state.imported.contract : await buildContract();
  const text = await queryWorker<string>("serialize-contract", { contract }, session);
  const name = `${contract.name}.settings.json`;
  saveBlob(new Blob([text], { type: "application/json;charset=utf-8" }), name);
  toast(`Saved ${name}. Load it next time to reuse these settings.`);
}

async function loadSettings(file: File): Promise<void> {
  if (!state.files.left || !state.files.right) throw new AppError("SESSION_STATE", "load both files before loading saved settings");
  clearMessages("settings");
  const imported = await queryWorker<ImportedContract>("import-contract", { text: await file.text(), fileName: file.name }, session);
  setupGeneration++;
  invalidateRun();
  const { contract, wizard, summary } = imported;
  state.files.left.summary.name = contract.left.name;
  state.files.right.summary.name = contract.right.name;
  renderFile("left");
  renderFile("right");
  if (!wizard) {
    state.imported = { contract, summary: summary!, fileName: file.name };
    renderImported();
    return;
  }
  state.imported = null;
  $("#imported-summary").hidden = true;
  $("#wizard").hidden = false;
  state.key = { left: wizard.identity.left_column, right: wizard.identity.right_column, normalize: [...wizard.identity.normalize] };
  renderKeySelects();
  state.keyStats = await queryWorker<IdentityOptionsSuggestion>("identity-options", { leftColumn: state.key.left, rightColumn: state.key.right }, session);
  state.keyAuto = null;
  for (const input of keyOptionInputs()) input.checked = state.key.normalize.includes(input.value as IdentityNormalizerName);
  renderKeyEvidence();
  state.columns = wizard.fields.map((field) => ({
    id: nextColumnId++,
    include: true,
    left_column: field.left_column,
    right_column: field.right_column,
    mode: field.mode,
    format: field.format,
    tolerance: field.tolerance,
    suggestion: null,
    pairReason: null,
    remembered: false,
    mapping: field.mode === "Value mapping" ? { rows: wizard.mappingRows.get(field.left_column) ?? [], loaded: true, page: 0 } : null,
  }));
  renderColumns();
  showMessage("settings", { tone: "ok", title: `Loaded the settings from ${file.name}.`, detail: "Check them below, then compare.", dismissible: true });
}

// Saved settings with custom rules the screen cannot edit are shown read-only
// and can be run as they are.
function renderImported(): void {
  const imported = state.imported!;
  const panel = $("#imported-summary");
  const table = node("table");
  const head = node("tr");
  for (const label of ["Column", "Columns", "Compared", "Rules", "Translations"]) head.append(node("th", label));
  const thead = node("thead");
  thead.append(head);
  const tbody = node("tbody");
  for (const field of imported.summary.fields) {
    const row = node("tr");
    for (const value of [field.name, field.columns, field.mode, field.normalizers, field.mapping]) row.append(node("td", value));
    tbody.append(row);
  }
  table.append(thead, tbody);
  const wrapper = node("div", "", "table-card");
  wrapper.append(table);
  panel.replaceChildren(
    node("h3", `Saved settings: ${imported.summary.name}`),
    node("p", `${imported.fileName} uses custom rules that can't be edited here. Rows are matched on ${imported.summary.identity}. Compare with these settings as they are, or discard them.`, "helper"),
    wrapper,
    button("Discard these settings", "secondary small", () => {
      state.imported = null;
      void setupSettings().catch((error) => showError(error, "settings"));
    }),
  );
  panel.hidden = false;
  $("#wizard").hidden = true;
  renderCompareSummary();
}

// ---------- Start over ----------

function startOver(): void {
  session++;
  setupGeneration++;
  terminateReconciliationWorker();
  uploadGeneration.left++;
  uploadGeneration.right++;
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
  state.files = { left: null, right: null };
  resetSettings();
  state.key = { left: "", right: "", normalize: [] };
  for (const input of keyOptionInputs()) input.checked = false;
  ($("#key-options") as HTMLDetailsElement).open = false;
  ($("#excel-safe") as HTMLInputElement).checked = true;
  ($("#search") as HTMLInputElement).value = "";
  renderFile("left");
  renderFile("right");
  clearMessages("load");
  updateSteps();
  window.scrollTo({ top: 0 });
  $("#step-load-title").focus({ preventScroll: true });
}

// ---------- Wiring ----------

function guarded(area: Area, action: () => unknown): () => void {
  return () => {
    try {
      const result = action();
      if (result instanceof Promise) result.catch((error) => showError(error, area));
    } catch (error) {
      showError(error, area);
    }
  };
}

setupDropzone("left");
setupDropzone("right");
// A file dropped outside the drop zones must not be handled by the browser:
// it would open the file in this tab (ending the session) or save a copy to
// the Downloads folder.
for (const type of ["dragover", "drop"] as const) document.addEventListener(type, (event) => event.preventDefault());
setupExportMenu();

for (const input of keyOptionInputs()) {
  input.addEventListener("change", () => {
    state.key.normalize = keyOptionInputs().filter((item) => item.checked).map((item) => item.value as IdentityNormalizerName);
    state.keyAuto = null;
    renderKeyEvidence();
    settingsChanged();
  });
}

$("#select-all").addEventListener("click", () => {
  for (const row of state.columns) row.include = true;
  renderColumns();
  settingsChanged();
  for (const row of state.columns) if (row.mode === "Value mapping" && !row.mapping) void loadMapping(row).catch((error) => showError(error, "settings"));
});
$("#select-none").addEventListener("click", () => {
  for (const row of state.columns) row.include = false;
  renderColumns();
  settingsChanged();
});
$("#add-pair").addEventListener("click", guarded("settings", addPair));
$("#compare").addEventListener("click", guarded("settings", compare));
$("#save-settings").addEventListener("click", guarded("settings", saveSettings));
$("#settings-file").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) loadSettings(file).catch((error) => showError(error, "settings"));
});
$("#start-over").addEventListener("click", startOver);
$("#search").addEventListener("input", () => searchEdited.schedule());
$("#search").addEventListener("change", () => searchEdited.flush());

// "/" focuses the search box, as in most data tools.
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (event.key !== "/" || !state.run || target.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  $("#search").focus();
});

// Progress shows only for work that takes a moment, so quick filter
// changes don't flash it. Compare stays disabled while settings are computed.
let progressTimer = 0;
onBusyChange((pendingTypes) => {
  const label = busyLabel(pendingTypes);
  window.clearTimeout(progressTimer);
  const apply = () => {
    $("#progress").hidden = label === null;
    $("#progress-text").textContent = label ?? "";
  };
  if (label === null) apply();
  else progressTimer = window.setTimeout(apply, 200);
  $("main").setAttribute("aria-busy", String(label !== null));
  const settingUp = pendingTypes.some((type) => ["suggest-identity", "identity-options", "suggest-fields", "suggest-modes", "build-contract", "reconcile", "parse"].includes(type));
  $<HTMLButtonElement>("#compare").disabled = settingUp;
});

// The worker held every dataset and result, so the whole session is gone.
onWorkerCrash((error) => {
  startOver();
  showError(error, "load");
});

$("#app-version").textContent = `· v${APP_VERSION}`;
renderFile("left");
renderFile("right");
updateSteps();
