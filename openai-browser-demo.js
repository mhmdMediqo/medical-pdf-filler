// Browser-only demo integration for GitHub Pages.
// The user's OpenAI API key is read from the input field and used only for this browser session.
// Do not use this approach for production with real patient data; use a backend proxy instead.

async function callOpenAIFromBrowser(payload) {
  const apiKeyInput = document.getElementById("api-key");
  const modelInput = document.getElementById("model-input");
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";
  const model = modelInput && modelInput.value.trim() ? modelInput.value.trim() : "gpt-5";

  if (!apiKey) return null;

  const userContent = buildUserContentWithPdfImages(payload);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: payload.system }] },
        { role: "user", content: userContent }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "medical_pdf_field_mapping",
          strict: true,
          schema: payload.schema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const data = await response.json();
  const outputText = data.output_text || extractOutputText(data);
  if (!outputText) throw new Error("OpenAI response did not include output_text.");
  return normalizeStructuredOutput(JSON.parse(outputText));
}

function buildUserContentWithPdfImages(payload) {
  const content = [{ type: "input_text", text: payload.user }];
  const thumbnails = typeof getPdfPageThumbnailsForAI === "function" ? getPdfPageThumbnailsForAI() : [];

  thumbnails.slice(0, 8).forEach((thumb) => {
    if (!thumb || !thumb.dataUrl) return;
    content.push({ type: "input_text", text: `Low-resolution screenshot of PDF page ${thumb.page}. Use this only to understand visible labels, section headings, and form layout.` });
    content.push({ type: "input_image", image_url: thumb.dataUrl, detail: "low" });
  });

  return content;
}

function extractOutputText(data) {
  if (!Array.isArray(data.output)) return "";
  for (const item of data.output) {
    if (!Array.isArray(item.content)) continue;
    const textPart = item.content.find((part) => part.type === "output_text" && part.text);
    if (textPart) return textPart.text;
  }
  return "";
}

function normalizeStructuredOutput(parsed) {
  if (parsed && parsed.fields) return parsed;

  const fields = {};
  if (parsed && Array.isArray(parsed.field_mappings)) {
    parsed.field_mappings.forEach((item) => {
      if (!item || !item.field_name) return;
      fields[item.field_name] = {
        value: item.value,
        raw_value: item.raw_value,
        confidence: item.confidence,
        evidence: item.evidence,
        reason: item.reason,
        needs_review: item.needs_review
      };
    });
  }

  return {
    fields,
    unmapped_clinical_facts: parsed && Array.isArray(parsed.unmapped_clinical_facts) ? parsed.unmapped_clinical_facts : [],
    warnings: parsed && Array.isArray(parsed.warnings) ? parsed.warnings : [],
    overall_confidence: parsed && typeof parsed.overall_confidence === "number" ? parsed.overall_confidence : 0
  };
}

const previousCallApplicationAI = callApplicationAI;
callApplicationAI = async function browserAwareCallApplicationAI() {
  const payload = window.buildMediqoAIPayload({
    conversation: conversationInput.value,
    pdfFields: getPdfFieldInventory(),
    documentContext: typeof getPdfDocumentContextForAI === "function" ? getPdfDocumentContextForAI() : ""
  });
  window.lastMediqoAIPayload = payload;

  try {
    const directOpenAIResult = await callOpenAIFromBrowser(payload);
    if (directOpenAIResult) {
      return validateAIMapping(directOpenAIResult, getPdfFieldInventory());
    }
  } catch (error) {
    console.error(error);
    throw error;
  }

  return previousCallApplicationAI();
};
