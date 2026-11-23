const crypto = require("node:crypto");
const express = require("express");
const { prisma } = require("../db/pool");
const { requireUser } = require("../middleware/requireUser");
const { requestAnalysis } = require("../services/aiProvider");
const { AppError } = require("../utils/appError");

const router = express.Router();
const MAX_CONTEXT_CHARS = 50_000;

router.use(requireUser);

router.post("/", async (request, response, next) => {
  try {
    const { decision, details = "", context = "", externalResearch = false } = request.body || {};
    if (typeof decision !== "string" || decision.trim().length < 8 || decision.trim().length > 500) {
      throw new AppError(400, "Decision must be between 8 and 500 characters.");
    }
    if (typeof details !== "string" || details.length > 2000) {
      throw new AppError(400, "Additional details must be 2,000 characters or fewer.");
    }
    if (typeof context !== "string" || context.length > MAX_CONTEXT_CHARS) {
      throw new AppError(400, "Attached context must be 50,000 characters or fewer.");
    }
    if (typeof externalResearch !== "boolean") {
      throw new AppError(400, "externalResearch must be a boolean.");
    }

    const onboarding = await prisma.onboardingProfile.findUnique({
      where: { userId: request.user.id },
      select: {
        step1: true,
        step2: true,
        step3: true,
        step4: true,
        completedAt: true,
      },
    });
    if (!onboarding?.completedAt) {
      throw new AppError(409, "Complete all four onboarding steps before starting an analysis.");
    }

    const businessContext = JSON.stringify({
      business: onboarding.step1,
      idealCustomerProfile: onboarding.step2,
      competitorsAndPricing: onboarding.step3,
      goalsAndChallenges: onboarding.step4,
    }, null, 2);
    const report = await requestAnalysis({
      decision: decision.trim(),
      details: details.trim(),
      context: [
        context.trim(),
        `Completed business onboarding profile:\n${businessContext}`,
      ].filter(Boolean).join("\n\n"),
      externalResearch,
    });
    const analysis = {
      id: crypto.randomUUID(),
      decision: decision.trim(),
      report,
      createdAt: new Date().toISOString(),
    };
    await prisma.analysis.create({
      data: {
        id: analysis.id,
        userId: request.user.id,
        decision: analysis.decision,
        report,
      },
    });
    response.status(201).json({ analysis });
  } catch (error) {
    next(error);
  }
});

router.get("/history", async (request, response, next) => {
  try {
    response.json({
      analyses: (await prisma.analysis.findMany({
        where: { userId: request.user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, decision: true, report: true, createdAt: true },
      })).map((analysis) => ({
        ...analysis,
        createdAt: analysis.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
