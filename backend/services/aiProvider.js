const { AppError } = require("../utils/appError");
const { validateReport } = require("../utils/validateReport");

const REPORT_SCHEMA = `{
  "executiveSummary": "A concise assessment of the decision",
  "recommendation": "A clear, qualified recommendation",
  "confidence": "low, medium, or high",
  "keyConsiderations": ["..."],
  "nextSteps": ["..."],
  "assumptions": ["..."],
  "risks": ["..."]
}`;

async function requestAnalysis({ decision, details, context, externalResearch }) {
  if (!process.env.AI_API_KEY) {
    throw new AppError(503, "AI analysis is not configured. Set AI_API_KEY on the backend.");
  }
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl}/chat/completions`;
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 45_000);
  const system = [
    "You are Spiritwolf, a careful business decision-support analyst.",
    "Do not fabricate facts, statistics, citations, or source links. Clearly distinguish provided evidence from assumptions.",
    externalResearch
      ? "External research was requested, but you have no browsing tool in this request. State that limitation; do not imply research was performed."
      : "Do not perform or claim external research.",
    "Return only a complete JSON object matching this shape exactly:",
    REPORT_SCHEMA,
  ].join("\n");
  const userMessage = [
    `Decision: ${decision}`,
    details ? `Additional details: ${details}` : "",
    context ? `Attached context:\n${context}` : "",
  ].filter(Boolean).join("\n\n");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new AppError(504, "The AI provider timed out. Please try again.");
    }
    console.error("AI provider connection failed:", error);
    throw new AppError(502, "Could not connect to the AI provider.");
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("AI provider returned an error:", response.status, body.slice(0, 1000));
    throw new AppError(
      response.status === 429 ? 503 : 502,
      response.status === 429
        ? "The AI provider is busy. Please try again shortly."
        : "The AI provider could not complete this analysis.",
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AppError(502, "The AI provider returned an invalid response.");
  }

  const choice = payload?.choices?.[0];
  if (!choice || choice.finish_reason === "length" || choice.finish_reason === "content_filter") {
    throw new AppError(502, "The AI provider returned an incomplete response. Please try again.");
  }
  if (typeof choice.message?.content !== "string" || !choice.message.content.trim()) {
    throw new AppError(502, "The AI provider returned an empty response.");
  }

  let report;
  try {
    report = JSON.parse(choice.message.content);
  } catch {
    throw new AppError(502, "The AI provider returned a malformed report.");
  }
  return validateReport(report);
}

module.exports = { requestAnalysis };
