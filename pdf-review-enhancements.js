// Enhancements for production-like PDF mapping workflow.
// Adds: richer PDF field inventory, type-aware filling, validation, editable review UI, and faster PDF generation.

let reviewedFieldMapping = {};
let advancedPdfFieldInventory = [];
let cachedPdfDoc = null;
let cachedPdfForm = null;
let cachedPdfFormFields = [];

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function detectPdfFieldType(field) {
  const typeName = field && field.constructor && field.constructor.name ? field.constructor.name : "Unknown";
  if (typeName.includes("CheckBox")) return "checkbox";
  if (typeName.includes("RadioGroup")) return "radio";
  if (typeName.includes("Dropdown")) return "dropdown";
  if (typeName.includes("OptionList")) return "option_list";
  if (typeName.includes("TextField")) return "text";
  return "unknown";
}

function getFieldOptions(field) {
  try {
    if (typeof field.getOptions === "function") return field.getOptions();
  } catch (error) {
    console.warn("Unable to read field options", error);
  }
  return [];
}

function getCurrentFieldValue(field, type) {
  try {
    if (type === "text" && typeof field.getText === "function") return field.getText() || null;
    if ((type === "dropdown" || type === "option_list" || type === "radio") && typeof field.getSelected === "function") return field.getSelected() || null;
    if (type === "checkbox" && typeof field.isChecked === "function") return field.isChecked();
  } catch (error) {
    console.warn("Unable to read field value", error);
  }
  return null;
}

function buildInventoryItem(field, index) {
  const name = field.getName();
  const type = detectPdfFieldType(field);
  const options = getFieldOptions(field);
  return { name, type, page: null, index, options, currentValue: getCurrentFieldValue(field, type), nearbyLabel: name, required: false };
}

function renderAdvancedFieldList(inventory) {
  if (!inventory.length) {
    fieldList.classList.add("empty-state");
    fieldList.textContent = "No fillable fields detected.";
    fieldBadge.textContent = "No fields";
    return;
  }
  fieldList.classList.remove("empty-state");
  fieldList.innerHTML = "";
  inventory.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "field-chip advanced-field-chip";
    const optionText = item.options && item.options.length ? `<small>Options: ${item.options.join(", ")}</small>` : "";
    chip.innerHTML = `<strong>${item.name}</strong><span>${item.type}</span>${optionText}`;
    fieldList.appendChild(chip);
  });
  fieldBadge.textContent = `${inventory.length} fields`;
}

inspectPdf = async function enhancedInspectPdf() {
  if (!currentPdfBytes) return;
  try {
    cachedPdfDoc = await PDFLib.PDFDocument.load(currentPdfBytes);
    cachedPdfForm = cachedPdfDoc.getForm();
    cachedPdfFormFields = cachedPdfForm.getFields();
    advancedPdfFieldInventory = cachedPdfFormFields.map(buildInventoryItem);
    currentFieldNames = advancedPdfFieldInventory.map((field) => field.name);
    fieldCount.textContent = String(currentFieldNames.length);
    renderAdvancedFieldList(advancedPdfFieldInventory);
    setStatus("PDF loaded");
  } catch (error) {
    console.error(error);
    alert("Failed to read PDF fields. Ensure the form is fillable (AcroForm).");
    setStatus("PDF error", "error");
  }
};

getPdfFieldInventory = function enhancedPdfFieldInventory() {
  return advancedPdfFieldInventory.length
    ? advancedPdfFieldInventory
    : currentFieldNames.map((name, index) => ({ name, type: "text", page: null, index, options: [], currentValue: null, nearbyLabel: name, required: false }));
};

function optionLooksLikeYes(option) {
  const n = normalizeText(option);
  return ["yes", "y", "true", "checked", "on", "1", "selected", "tick"].includes(n) || n.includes("yes");
}

function optionLooksLikeNo(option) {
  const n = normalizeText(option);
  return ["no", "n", "false", "unchecked", "off", "0", "not selected"].includes(n) || n.includes("no");
}

function coerceBooleanValue(value) {
  if (typeof value === "boolean") return value;
  const n = normalizeText(value);
  if (["yes", "y", "true", "checked", "on", "1", "selected", "tick"].includes(n)) return true;
  if (["no", "n", "false", "unchecked", "off", "0", "not selected", "none", "null"].includes(n)) return false;
  return null;
}

function findBestOption(value, options) {
  if (value === null || value === undefined || value === "" || !Array.isArray(options) || !options.length) return null;
  const raw = String(value);
  if (options.includes(raw)) return raw;
  const target = normalizeText(raw);
  let exact = options.find((option) => normalizeText(option) === target);
  if (exact) return exact;
  exact = options.find((option) => normalizeText(option).includes(target) || target.includes(normalizeText(option)));
  if (exact) return exact;
  const asBool = coerceBooleanValue(value);
  if (asBool === true) return options.find(optionLooksLikeYes) || null;
  if (asBool === false) return options.find(optionLooksLikeNo) || null;
  return null;
}

function normalizeValueForField(field, item, warnings) {
  if (!item || item.value === null || item.value === undefined || item.value === "") return item;
  if (field.type === "checkbox") {
    const boolValue = coerceBooleanValue(item.value);
    if (boolValue === null) {
      item.raw_value = String(item.value);
      item.value = null;
      item.confidence = Math.min(Number(item.confidence || 0), 0.4);
      item.needs_review = true;
      warnings.push(`Checkbox value needs review for ${field.name}`);
    } else {
      item.value = boolValue;
      item.raw_value = String(boolValue);
    }
    return item;
  }
  if (["dropdown", "radio", "option_list"].includes(field.type)) {
    const matched = findBestOption(item.value, field.options);
    if (matched === null && field.options && field.options.length) {
      item.raw_value = String(item.value);
      item.value = null;
      item.confidence = Math.min(Number(item.confidence || 0), 0.4);
      item.needs_review = true;
      warnings.push(`Invalid option rejected for ${field.name}: ${item.raw_value}`);
    } else if (matched !== null) {
      item.value = matched;
      item.raw_value = matched;
    }
  }
  return item;
}

function validateAIMapping(parsed, inventory) {
  const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];
  const fields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const validNames = new Set(inventory.map((field) => field.name));

  inventory.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(fields, field.name)) {
      fields[field.name] = { value: null, raw_value: null, confidence: 0, evidence: "Field missing from AI output", reason: "Validation inserted this field because every PDF field must be returned exactly once.", needs_review: true };
      warnings.push(`Missing field inserted: ${field.name}`);
    }
  });

  Object.keys(fields).forEach((fieldName) => {
    if (!validNames.has(fieldName)) {
      delete fields[fieldName];
      warnings.push(`Removed hallucinated field: ${fieldName}`);
    }
  });

  inventory.forEach((field) => normalizeValueForField(field, fields[field.name], warnings));
  parsed.fields = fields;
  parsed.warnings = warnings;
  return parsed;
}

const originalCallApplicationAI = callApplicationAI;
callApplicationAI = async function enhancedCallApplicationAI() {
  const parsed = await originalCallApplicationAI();
  return validateAIMapping(parsed, getPdfFieldInventory());
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

renderResult = function enhancedRenderResult(mapping) {
  reviewedFieldMapping = JSON.parse(JSON.stringify(mapping || {}));
  const entries = Object.entries(reviewedFieldMapping);
  resultList.innerHTML = "";
  if (!entries.length) {
    resultList.classList.add("empty-state");
    resultList.textContent = "No mapped fields returned.";
    mappedCount.textContent = "0";
    missingCount.textContent = "0";
    confidenceMix.textContent = "n/a";
    return;
  }

  resultList.classList.remove("empty-state");
  let mapped = 0, missing = 0;
  const confidences = [];
  const inventoryByName = Object.fromEntries(getPdfFieldInventory().map((field) => [field.name, field]));

  entries.forEach(([fieldName, meta]) => {
    const fieldInfo = inventoryByName[fieldName] || { type: "text", options: [] };
    const value = meta && meta.value !== undefined ? meta.value : null;
    const confidence = meta && typeof meta.confidence === "number" ? meta.confidence : 0;
    if (value !== null && value !== "" && value !== undefined) mapped += 1; else missing += 1;
    confidences.push(confidence);
    const item = document.createElement("div");
    item.className = `result-item review-item ${meta && meta.needs_review ? "needs-review" : ""}`;

    let controlHtml = "";
    if (fieldInfo.type === "checkbox") {
      controlHtml = `<select data-review-field="${escapeHtml(fieldName)}"><option value="">-- unset --</option><option value="true" ${value === true ? "selected" : ""}>Checked</option><option value="false" ${value === false ? "selected" : ""}>Unchecked</option></select>`;
    } else if (["dropdown", "radio", "option_list"].includes(fieldInfo.type) && fieldInfo.options && fieldInfo.options.length) {
      controlHtml = `<select data-review-field="${escapeHtml(fieldName)}"><option value="">-- unset --</option>${fieldInfo.options.map((option) => `<option value="${escapeHtml(option)}" ${String(value) === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    } else {
      controlHtml = `<textarea data-review-field="${escapeHtml(fieldName)}" rows="2">${escapeHtml(value ?? "")}</textarea>`;
    }

    item.innerHTML = `<div class="review-top"><strong>${escapeHtml(fieldName)}</strong><span>${escapeHtml(fieldInfo.type)}</span></div>${controlHtml}<small>confidence: ${confidence.toFixed(2)} | review: ${meta && meta.needs_review ? "required" : "not required"}</small><small>${escapeHtml(meta && meta.evidence ? meta.evidence : "No evidence supplied")}</small>`;
    resultList.appendChild(item);
  });

  resultList.querySelectorAll("[data-review-field]").forEach((control) => {
    control.addEventListener("input", () => {
      const fieldName = control.dataset.reviewField;
      const fieldInfo = inventoryByName[fieldName] || { type: "text" };
      let value = control.value;
      if (value === "") value = null;
      if (fieldInfo.type === "checkbox" && value !== null) value = value === "true";
      reviewedFieldMapping[fieldName].value = value;
      reviewedFieldMapping[fieldName].raw_value = value === null ? null : String(value);
      reviewedFieldMapping[fieldName].needs_review = false;
    });
  });

  mappedCount.textContent = String(mapped);
  missingCount.textContent = String(missing);
  confidenceMix.textContent = confidences.length ? `avg ${((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100).toFixed(0)}%` : "n/a";
};

function getPdfFormForGeneration() {
  if (!cachedPdfDoc || !cachedPdfForm) throw new Error("PDF form cache is not ready. Re-upload the PDF and try again.");
  return { pdfDoc: cachedPdfDoc, form: cachedPdfForm };
}

function setPdfFieldValue(form, fieldInfo, value) {
  if (value === null || value === undefined || value === "") return;
  const name = fieldInfo.name;
  try {
    if (fieldInfo.type === "checkbox") {
      const checkbox = form.getCheckBox(name);
      if (value === true) checkbox.check(); else checkbox.uncheck();
      return;
    }
    if (fieldInfo.type === "radio") {
      const matched = findBestOption(value, fieldInfo.options) || String(value);
      form.getRadioGroup(name).select(matched);
      return;
    }
    if (fieldInfo.type === "dropdown") {
      const matched = findBestOption(value, fieldInfo.options) || String(value);
      form.getDropdown(name).select(matched);
      return;
    }
    if (fieldInfo.type === "option_list") {
      const matched = findBestOption(value, fieldInfo.options) || String(value);
      form.getOptionList(name).select(matched);
      return;
    }
    form.getTextField(name).setText(String(value));
  } catch (error) {
    console.warn("Unable to set PDF field", name, fieldInfo.type, value, error);
  }
}

fillPdfWithMapping = async function enhancedFillPdfWithMapping(mapping) {
  const start = performance.now();
  const sourceMapping = Object.keys(reviewedFieldMapping).length ? reviewedFieldMapping : mapping;
  const { pdfDoc, form } = getPdfFormForGeneration();
  const inventory = getPdfFieldInventory();

  for (const fieldInfo of inventory) {
    const meta = sourceMapping[fieldInfo.name];
    const value = meta && meta.value !== undefined ? meta.value : null;
    setPdfFieldValue(form, fieldInfo, value);
  }

  form.updateFieldAppearances();
  const bytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  console.info(`PDF generated in ${Math.round(performance.now() - start)}ms`);
  return bytes;
};
