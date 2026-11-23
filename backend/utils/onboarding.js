const { AppError } = require("./appError");

const OPTIONS = {
  stage: ["Idea", "Early", "Growing", "Established"],
  customerTypes: ["B2B Enterprise", "B2B Mid-Market", "B2C / Consumer", "B2B2C"],
  geographicMarkets: ["North America", "Europe / UK", "APAC", "Global"],
  salesMotion: ["Product-Led (PLG)", "Sales-Assisted", "Channel / Partner"],
  pricingModel: ["Subscription / SaaS", "Usage-based", "Per-Seat", "Fixed Tier"],
  competitiveMoats: [
    "Proprietary IP",
    "Switching Cost",
    "Data Network Effects",
    "Speed to Deployment",
  ],
  quarterlyGoals: [
    "Increase Conversion / Win Rate",
    "Scale Enterprise Outbound",
    "Reduce Churn",
    "Refine Pricing Tier",
  ],
  biggestObstacle: [
    "Unclear ICP Definition",
    "Resource Constraints",
    "Long Sales Cycles",
    "Product Differentiation",
  ],
  planningHorizon: ["1-3 Months", "6 Months", "12+ Months"],
};

function requiredText(value, field, maxLength, minLength = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < minLength ||
    value.trim().length > maxLength
  ) {
    throw new AppError(400, `${field} must be between ${minLength} and ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new AppError(400, `${field} must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function selectedOption(value, field, options) {
  if (!options.includes(value)) {
    throw new AppError(400, `${field} must be one of: ${options.join(", ")}.`);
  }
  return value;
}

function selectedOptions(value, field, options, { required = true, max = options.length } = {}) {
  if (!Array.isArray(value) || value.length > max || (required && value.length === 0)) {
    throw new AppError(400, `${field} must be an array${required ? " with at least one selection" : ""}.`);
  }
  const selections = value.map((item) => selectedOption(item, field, options));
  if (new Set(selections).size !== selections.length) {
    throw new AppError(400, `${field} must not contain duplicate selections.`);
  }
  return selections;
}

function validateStep(step, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Step data must be a JSON object.");
  }

  switch (step) {
    case 1:
      return {
        businessName: requiredText(value.businessName, "Business name", 120),
        industry: requiredText(value.industry, "Industry", 100),
        stage: selectedOption(value.stage, "Stage", OPTIONS.stage),
        description: optionalText(value.description, "Description", 1000),
      };
    case 2:
      return {
        targetCustomerProfile: requiredText(value.targetCustomerProfile, "Target customer profile", 250),
        customerTypes: selectedOptions(value.customerTypes, "Customer types", OPTIONS.customerTypes),
        geographicMarkets: selectedOptions(value.geographicMarkets, "Geographic markets", OPTIONS.geographicMarkets),
        averageDealSize: optionalText(value.averageDealSize, "Average deal size", 50),
        salesMotion: value.salesMotion === undefined || value.salesMotion === ""
          ? ""
          : selectedOption(value.salesMotion, "Sales motion", OPTIONS.salesMotion),
      };
    case 3:
      if (!Array.isArray(value.competitors) || value.competitors.length > 20) {
        throw new AppError(400, "Competitors must be an array with no more than 20 entries.");
      }
      return {
        competitors: value.competitors.map((competitor) =>
          requiredText(competitor, "Competitor name", 100),
        ),
        pricingModel: selectedOption(value.pricingModel, "Pricing model", OPTIONS.pricingModel),
        competitiveMoats: value.competitiveMoats === undefined
          ? []
          : selectedOptions(value.competitiveMoats, "Competitive moats", OPTIONS.competitiveMoats, { required: false }),
        pricingFriction: optionalText(value.pricingFriction, "Pricing friction", 250),
      };
    case 4:
      return {
        quarterlyGoals: selectedOptions(value.quarterlyGoals, "Quarterly goals", OPTIONS.quarterlyGoals),
        biggestObstacle: selectedOption(value.biggestObstacle, "Biggest obstacle", OPTIONS.biggestObstacle),
        businessInquiry: optionalText(value.businessInquiry, "Business inquiry", 500),
        planningHorizon: selectedOption(value.planningHorizon, "Planning horizon", OPTIONS.planningHorizon),
      };
    default:
      throw new AppError(400, "Step must be a number from 1 to 4.");
  }
}

module.exports = { validateStep };
