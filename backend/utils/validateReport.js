const { AppError } = require("./appError");

const STRING_FIELDS = ["executiveSummary", "recommendation", "confidence"];
const LIST_FIELDS = ["keyConsiderations", "nextSteps", "assumptions", "risks"];

function validateReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(502, "The AI provider returned an incomplete report.");
  }
  for (const field of STRING_FIELDS) {
    if (typeof value[field] !== "string" || value[field].trim().length < 3 || value[field].length > 4000) {
      throw new AppError(502, "The AI provider returned an incomplete report.");
    }
  }
  if (!["low", "medium", "high"].includes(value.confidence.toLowerCase())) {
    throw new AppError(502, "The AI provider returned an invalid confidence level.");
  }
  for (const field of LIST_FIELDS) {
    if (
      !Array.isArray(value[field]) ||
      value[field].length < 1 ||
      value[field].length > 8 ||
      value[field].some((item) => typeof item !== "string" || item.trim().length < 2 || item.length > 1000)
    ) {
      throw new AppError(502, "The AI provider returned an incomplete report.");
    }
  }
  return {
    executiveSummary: value.executiveSummary.trim(),
    recommendation: value.recommendation.trim(),
    confidence: value.confidence.toLowerCase(),
    keyConsiderations: value.keyConsiderations.map((item) => item.trim()),
    nextSteps: value.nextSteps.map((item) => item.trim()),
    assumptions: value.assumptions.map((item) => item.trim()),
    risks: value.risks.map((item) => item.trim()),
  };
}

module.exports = { validateReport };
