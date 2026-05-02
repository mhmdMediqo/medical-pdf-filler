// Browser-only demo integration for GitHub Pages.
// The user's OpenAI API key is read from the input field and used only for this browser session.
// Do not use this approach for production with real patient data; use a backend proxy instead.

async function callOpenAIFromBrowser(payload) {
  const apiKeyInput = document.getElementById("api-key");
  const modelInput = document.getElementById("model-input");
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";
  const model = modelInput && modelInput.value.trim() ? modelInput.value.trim() : "gpt-4.1";

  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: payload.system },
        { role: "user", content: payload.user }
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
  return JSON.parse(outputText);
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

const previousCallApplicationAI = callApplicationAI;
callApplicationAI = async function browserAwareCallApplicationAI() {
  const payload = window.buildMediqoAIPayload({
    conversation: conversationInput.value,
    pdfFields: getPdfFieldInventory(),
    documentContext: ""
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
