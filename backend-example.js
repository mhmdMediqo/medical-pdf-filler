// Example backend/edge function for production AI mapping.
// Do not expose your OpenAI API key in the browser or commit it to GitHub.
// Store it as OPENAI_API_KEY in your hosting provider environment variables.
// The frontend calls POST /api/map-fields with { system, user, schema }.

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

export async function mapMedicalPdfFields(req, res) {
  try {
    const { system, user, schema } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    }

    const response = await client.responses.create({
      model: MODEL,
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

    const parsed = JSON.parse(response.output_text);
    res.status(200).json({ ...parsed, model: MODEL });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI mapping failed", details: error.message });
  }
}
