const token = new URLSearchParams(window.location.search).get("token") || "";
history.replaceState({}, document.title, window.location.pathname);

const state = {
  left: null,
  right: null,
  identity: null,
  fields: [],
  pairs: [],
};
const modes = ["Exact", "Normalized text", "Value mapping", "Ignore"];
const $ = (selector) => document.querySelector(selector);
let heartbeatTimer = null;
let shuttingDown = false;

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  if (text !== "") element.textContent = text;
  if (className) element.className = className;
  return element;
}

function show(selector, visible = true) {
  $(selector).classList.toggle("hidden", !visible);
}

function showError(error) {
  const target = $("#error");
  target.textContent = error instanceof Error ? error.message : String(error);
  target.classList.remove("hidden");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearError() {
  $("#error").classList.add("hidden");
}

async function request(path, options = {}) {
  clearError();
  const headers = new Headers(options.headers || {});
  headers.set("X-Auth-Token", token);
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload.error) message = payload.error;
    } catch (_) {
      // Security rejections intentionally have empty bodies.
    }
    throw new Error(message);
  }
  return response;
}

async function jsonRequest(path, options = {}) {
  return (await request(path, options)).json();
}

function select(options, value) {
  const element = node("select");
  for (const optionValue of options) {
    const option = node("option", optionValue);
    option.value = optionValue;
    option.selected = optionValue === value;
    element.append(option);
  }
  return element;
}

function display(value) {
  return value === null || value === undefined ? "<missing>" : String(value);
}

function renderTable(columns, rows) {
  const wrapper = node("div", "", "table-scroll");
  const table = node("table");
  const header = node("tr");
  for (const column of columns) header.append(node("th", column.label));
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

function invalidateAfterUpload() {
  state.identity = null;
  state.fields = [];
  state.pairs = [];
  for (const selector of ["#step-identity", "#step-fields", "#step-mappings", "#step-run", "#step-results"]) show(selector, false);
}

async function upload(side, file) {
  invalidateAfterUpload();
  const data = await jsonRequest(`/api/dataset/${side}`, {
    method: "POST",
    headers: { "X-Filename": file.name },
    body: await file.arrayBuffer(),
  });
  state[side] = data;
  renderDataset(side, data, file.name);
  if (state.left && state.right) await startIdentity();
}

function renderDataset(side, data, filename) {
  const target = $(`#${side}-dataset`);
  target.replaceChildren();
  target.append(node("p", `File: ${filename}`, "caption"));
  const label = node("label", "Logical source name");
  const nameInput = node("input");
  nameInput.type = "text";
  nameInput.value = data.name;
  nameInput.addEventListener("change", async () => {
    await jsonRequest(`/api/dataset/${side}/name`, { method: "PUT", json: { name: nameInput.value } });
    data.name = nameInput.value;
    show("#step-results", false);
  });
  label.append(nameInput);
  target.append(label, node("p", `${data.row_count} rows · ${data.column_count} columns`, "caption"));
  target.append(renderTable(data.columns.map((name) => ({ label: name, value: (row) => row[name] })), data.preview));
  const details = node("details");
  details.append(node("summary", "Column profile"));
  details.append(renderTable([
    { label: "Column", value: (row) => row.column_name },
    { label: "Rows", value: (row) => row.row_count },
    { label: "Non-null", value: (row) => row.non_null_count },
    { label: "Null %", value: (row) => row.null_percentage },
    { label: "Distinct", value: (row) => row.distinct_count },
    { label: "Unique %", value: (row) => row.uniqueness_percentage },
    { label: "Samples", value: (row) => row.sample_values.join(", ") },
  ], data.profile));
  target.append(details);
}

async function startIdentity() {
  const suggestion = await jsonRequest("/api/identity/suggestion");
  const banner = $("#identity-suggestion");
  banner.replaceChildren();
  if (suggestion.confident) {
    banner.append(node("strong", `Suggested: ${suggestion.left_column} ↔ ${suggestion.right_column}`));
    banner.append(node("p", suggestion.reasons.join(" · ")));
  } else {
    banner.textContent = "No high-confidence pair was found. Review the profiles and choose both fields explicitly.";
  }
  const leftSelect = select(state.left.columns, suggestion.left_column);
  const rightSelect = select(state.right.columns, suggestion.right_column);
  leftSelect.id = "left-identity";
  rightSelect.id = "right-identity";
  $("#left-identity").replaceWith(leftSelect);
  $("#right-identity").replaceWith(rightSelect);
  leftSelect.addEventListener("change", scoreIdentity);
  rightSelect.addEventListener("change", scoreIdentity);
  await scoreIdentity();
  show("#step-identity");
}

async function scoreIdentity() {
  const evidence = await jsonRequest("/api/identity/score", {
    method: "POST",
    json: { left_column: $("#left-identity").value, right_column: $("#right-identity").value },
  });
  $("#identity-evidence").textContent = `Conservative trimmed/case-insensitive value overlap for selection: ${evidence.overlap_percentage.toFixed(1)}%. Reconciliation itself keeps exact identity matching.`;
  show("#identity-confirmed", false);
  show("#step-fields", false);
  show("#step-mappings", false);
  show("#step-run", false);
  show("#step-results", false);
}

async function confirmIdentity() {
  const payload = { left_column: $("#left-identity").value, right_column: $("#right-identity").value };
  await jsonRequest("/api/identity/confirm", { method: "POST", json: payload });
  state.identity = payload;
  show("#identity-confirmed");
  const suggestions = await jsonRequest("/api/fields/suggestions");
  state.fields = suggestions.map((item) => ({ left_column: item.left_column, right_column: item.right_column, mode: "Exact" }));
  renderFieldRows();
  show("#step-fields");
}

function renderFieldRows() {
  const target = $("#field-rows");
  target.replaceChildren();
  const leftColumns = state.left.columns.filter((item) => item !== state.identity.left_column);
  const rightColumns = state.right.columns.filter((item) => item !== state.identity.right_column);
  state.fields.forEach((field, index) => {
    const row = node("tr");
    const left = select(leftColumns, field.left_column);
    const right = select(rightColumns, field.right_column);
    const mode = select(modes, field.mode);
    left.addEventListener("change", () => { field.left_column = left.value; fieldsChanged(); });
    right.addEventListener("change", () => { field.right_column = right.value; fieldsChanged(); });
    mode.addEventListener("change", () => { field.mode = mode.value; fieldsChanged(); });
    const remove = node("button", "Remove", "secondary danger");
    remove.type = "button";
    remove.addEventListener("click", () => { state.fields.splice(index, 1); renderFieldRows(); fieldsChanged(); });
    for (const child of [left, right, mode, remove]) {
      const cell = node("td");
      cell.append(child);
      row.append(cell);
    }
    target.append(row);
  });
}

function fieldsChanged() {
  show("#fields-confirmed", false);
  show("#step-mappings", false);
  show("#step-run", false);
  show("#step-results", false);
}

function addField() {
  const usedLeft = new Set(state.fields.map((item) => item.left_column));
  const usedRight = new Set(state.fields.map((item) => item.right_column));
  const left = state.left.columns.find((item) => item !== state.identity.left_column && !usedLeft.has(item));
  const right = state.right.columns.find((item) => item !== state.identity.right_column && !usedRight.has(item));
  if (!left || !right) return;
  state.fields.push({ left_column: left, right_column: right, mode: "Exact" });
  renderFieldRows();
  fieldsChanged();
}

async function confirmFields() {
  await jsonRequest("/api/fields/confirm", { method: "POST", json: { fields: state.fields } });
  show("#fields-confirmed");
  await renderMappingEditors();
  show("#step-mappings");
}

async function renderMappingEditors() {
  const target = $("#mapping-editors");
  target.replaceChildren();
  state.pairs = [];
  const mappingFields = state.fields.filter((item) => item.mode === "Value mapping");
  if (!mappingFields.length) target.append(node("p", "No fields use semantic value mapping. Confirm this step to continue.", "message"));
  for (const field of mappingFields) {
    const heading = node("h3", `${field.left_column} ↔ ${field.right_column}`);
    const evidence = await jsonRequest("/api/mappings/observed", {
      method: "POST",
      json: { left_field: field.left_column, right_field: field.right_column },
    });
    const editor = { field, evidence };
    state.pairs.push(editor);
    const add = node("button", "Add mapping row", "secondary");
    add.type = "button";
    add.addEventListener("click", () => {
      editor.evidence.push({
        accepted: false,
        canonical_value: "",
        left_display: "",
        right_display: "",
        count: 0,
        consistency_percentage: 0,
        assessment: "Manual",
      });
      renderMappingEditorsFromState();
    });
    const block = node("div");
    block.append(heading, mappingTable(editor), add);
    target.append(block);
  }
}

function renderMappingEditorsFromState() {
  const target = $("#mapping-editors");
  target.replaceChildren();
  for (const editor of state.pairs) {
    const heading = node("h3", `${editor.field.left_column} ↔ ${editor.field.right_column}`);
    const add = node("button", "Add mapping row", "secondary");
    add.type = "button";
    add.addEventListener("click", () => {
      editor.evidence.push({ accepted: false, canonical_value: "", left_display: "", right_display: "", count: 0, consistency_percentage: 0, assessment: "Manual" });
      renderMappingEditorsFromState();
    });
    const block = node("div");
    block.append(heading, mappingTable(editor), add);
    target.append(block);
  }
}

function mappingTable(editor) {
  const wrapper = node("div", "", "table-scroll");
  const table = node("table");
  const headings = ["Accept semantic mapping", "Canonical value", "Dataset A value", "Dataset B value", "Employees", "Consistency %", "Assessment", ""];
  const headRow = node("tr");
  headings.forEach((value) => headRow.append(node("th", value)));
  const head = node("thead");
  head.append(headRow);
  const body = node("tbody");
  editor.evidence.forEach((pair) => {
    pair.accepted = pair.suggested;
    const row = node("tr");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.checked = pair.accepted;
    checkbox.addEventListener("change", () => { pair.accepted = checkbox.checked; show("#mappings-confirmed", false); });
    const canonical = node("input");
    canonical.type = "text";
    canonical.value = pair.canonical_value;
    canonical.addEventListener("input", () => { pair.canonical_value = canonical.value; show("#mappings-confirmed", false); });
    const left = node("input");
    left.type = "text";
    left.value = pair.left_display;
    left.addEventListener("input", () => { pair.left_display = left.value; show("#mappings-confirmed", false); });
    const right = node("input");
    right.type = "text";
    right.value = pair.right_display;
    right.addEventListener("input", () => { pair.right_display = right.value; show("#mappings-confirmed", false); });
    const remove = node("button", "Remove", "secondary danger");
    remove.type = "button";
    remove.addEventListener("click", () => {
      editor.evidence.splice(editor.evidence.indexOf(pair), 1);
      renderMappingEditorsFromState();
      show("#mappings-confirmed", false);
    });
    const cells = [checkbox, canonical, left, right, node("span", String(pair.count)), node("span", String(pair.consistency_percentage)), node("span", pair.assessment), remove];
    for (const value of cells) {
      const cell = node("td");
      cell.append(value);
      row.append(cell);
    }
    body.append(row);
  });
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

async function confirmMappings() {
  const fields = state.pairs.map((editor) => ({
    left_column: editor.field.left_column,
    mappings: editor.evidence.filter((pair) => pair.accepted).map((pair) => ({
      canonical_value: pair.canonical_value,
      left_values: [pair.left_display],
      right_values: [pair.right_display],
    })),
  }));
  await jsonRequest("/api/mappings/confirm", { method: "POST", json: { fields } });
  show("#mappings-confirmed");
  const leftName = state.left.name;
  const rightName = state.right.name;
  $("#contract-name").value = `${leftName}_vs_${rightName}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "ui_reconciliation";
  const count = state.fields.filter((item) => item.mode !== "Ignore").length;
  $("#run-summary").textContent = `Identity: ${state.identity.left_column} ↔ ${state.identity.right_column} · Comparison fields: ${count}`;
  show("#step-run");
}

async function runReconciliation() {
  const summary = await jsonRequest("/api/run", { method: "POST", json: { name: $("#contract-name").value } });
  renderMetrics(summary);
  const byField = await jsonRequest("/api/results/by-field");
  renderFieldSummary(byField);
  const matching = await jsonRequest("/api/results/matching");
  $("#matching-summary").replaceChildren(resultDetailTable(matching));
  show("#step-results");
}

function renderMetrics(summary) {
  const target = $("#metrics");
  target.replaceChildren();
  const values = [
    [summary.datasets.left.record_count, `${summary.datasets.left.name} records`],
    [summary.datasets.right.record_count, `${summary.datasets.right.name} records`],
    [summary.metrics.matched_employees, "Matched employees"],
    [summary.metrics.missing_left, "Missing in Dataset A"],
    [summary.metrics.missing_right, "Missing in Dataset B"],
    [summary.metrics.duplicate_identities, "Duplicate identities"],
    [summary.metrics.field_matches, "Field matches"],
    [summary.metrics.field_discrepancies, "Field discrepancies"],
    [summary.metrics.unmapped_values, "Unmapped values"],
  ];
  for (const [value, label] of values) {
    const tile = node("div", "", "metric");
    tile.append(node("strong", String(value)), node("span", label));
    target.append(tile);
  }
}

function renderFieldSummary(rows) {
  const target = $("#field-summary");
  target.replaceChildren();
  if (!rows.length) {
    target.append(node("p", "No field discrepancies were found.", "message"));
    show("#pair-panel", false);
    return;
  }
  target.append(renderTable([
    { label: "Field", value: (row) => row.field_name },
    { label: "Mismatches", value: (row) => row.mismatch_count },
    { label: "Comparisons", value: (row) => row.comparison_count },
    { label: "Rate %", value: (row) => row.mismatch_rate_percentage },
  ], rows));
  const fieldSelect = select(rows.map((row) => row.field_name), rows[0].field_name);
  fieldSelect.id = "result-field";
  $("#result-field").replaceWith(fieldSelect);
  fieldSelect.addEventListener("change", loadPairs);
  show("#pair-panel");
  loadPairs();
}

async function loadPairs() {
  const field = $("#result-field").value;
  const pairs = await jsonRequest(`/api/results/by-pair?field=${encodeURIComponent(field)}`);
  $("#pair-summary").replaceChildren(renderTable([
    { label: "Dataset A value", value: (row) => display(row.left_value) },
    { label: "Dataset B value", value: (row) => display(row.right_value) },
    { label: "Status", value: (row) => row.status },
    { label: "Employees", value: (row) => row.employee_count },
    { label: "Share %", value: (row) => row.percentage },
  ], pairs));
  state.resultPairs = pairs;
  const pairSelect = select(["All mismatch pairs", ...pairs.map((row, index) => `${index}: ${display(row.left_value)} ↔ ${display(row.right_value)} (${row.employee_count})`)], "All mismatch pairs");
  pairSelect.id = "result-pair";
  $("#result-pair").replaceWith(pairSelect);
  pairSelect.addEventListener("change", loadDetails);
  await loadDetails();
}

async function loadDetails() {
  const field = $("#result-field").value;
  const selection = $("#result-pair").value;
  let path = `/api/results/details?field=${encodeURIComponent(field)}`;
  if (selection !== "All mismatch pairs") {
    const pair = state.resultPairs[Number(selection.split(":", 1)[0])];
    path += `&left=${encodeURIComponent(display(pair.left_value))}&right=${encodeURIComponent(display(pair.right_value))}`;
  }
  const details = await jsonRequest(path);
  $("#detail-summary").replaceChildren(resultDetailTable(details));
}

function resultDetailTable(rows) {
  return renderTable([
    { label: "Employee identity", value: (row) => row.identity },
    { label: "Field", value: (row) => row.field_name },
    { label: "Dataset A value", value: (row) => display(row.left_raw_value) },
    { label: "Dataset B value", value: (row) => display(row.right_raw_value) },
    { label: "Comparison status", value: (row) => row.status },
  ], rows);
}

async function download(file) {
  const response = await request(`/api/download/${file}`);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = match ? match[1] : file;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function clearSession() {
  await jsonRequest("/api/session/clear", { method: "POST" });
  shuttingDown = true;
  window.location.assign(`/?token=${encodeURIComponent(token)}`);
}

async function heartbeat() {
  if (shuttingDown) return;
  try {
    await request("/api/session/heartbeat", { method: "POST" });
  } catch (_) {
    // A stopped local server is the expected outcome after the app exits.
  }
}

async function quitApplication() {
  shuttingDown = true;
  if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
  await jsonRequest("/api/session/shutdown", { method: "POST" });
  document.body.replaceChildren();
  const message = node("main");
  message.append(
    node("h1", "HRIS Reconciliation has closed"),
    node("p", "The in-memory session has been cleared. You can close this tab."),
  );
  document.body.append(message);
}

function bind(selector, event, callback) {
  $(selector).addEventListener(event, (...args) => Promise.resolve(callback(...args)).catch(showError));
}

bind("#left-file", "change", (event) => event.target.files[0] && upload("left", event.target.files[0]));
bind("#right-file", "change", (event) => event.target.files[0] && upload("right", event.target.files[0]));
bind("#confirm-identity", "click", confirmIdentity);
bind("#add-field", "click", addField);
bind("#confirm-fields", "click", confirmFields);
bind("#confirm-mappings", "click", confirmMappings);
bind("#run-reconciliation", "click", runReconciliation);
bind("#clear-session", "click", clearSession);
bind("#quit-application", "click", quitApplication);
document.querySelectorAll(".download").forEach((button) => bind(`[data-file="${button.dataset.file}"]`, "click", () => download(button.dataset.file)));
window.addEventListener("pagehide", () => {
  if (shuttingDown) return;
  fetch("/api/session/shutdown", {
    method: "POST",
    headers: { "X-Auth-Token": token },
    keepalive: true,
  }).catch(() => {});
});
heartbeat();
heartbeatTimer = window.setInterval(heartbeat, 5000);
