// Example backend/edge function for production AI mapping.
// Do not expose your OpenAI API key in the browser. Host this handler on a secure backend
// and make the frontend call POST /api/map-fields.

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function mapMedicalPdfFields(req, res) {
  try {
    const { system, user, schema } = req.body;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "medical_pdf_field_mapping",
          strict: true,
          schema
        }
      }
    });

    const outputText = response.output_text;
    const parsed = JSON.parse(outputText);
    res.status(200).json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI mapping failed", details: error.message });
  }
}
