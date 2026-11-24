const express = require("express");
const { prisma } = require("../db/pool");
const { requireUser } = require("../middleware/requireUser");
const { AppError } = require("../utils/appError");
const { validateOnboarding } = require("../utils/onboarding");

const router = express.Router();
const PROFILE_SELECT = {
  step1: true,
  step2: true,
  step3: true,
  step4: true,
  completedAt: true,
};

function formatOnboarding(profile) {
  return {
    onboarding: profile
      ? {
          ...(profile.step1 || {}),
          ...(profile.step2 || {}),
          ...(profile.step3 || {}),
          ...(profile.step4 || {}),
        }
      : null,
    completed: Boolean(profile?.completedAt),
    completedAt: profile?.completedAt ? profile.completedAt.toISOString() : null,
  };
}

router.use(requireUser);

router.get("/", async (request, response, next) => {
  try {
    const profile = await prisma.onboardingProfile.findUnique({
      where: { userId: request.user.id },
      select: PROFILE_SELECT,
    });
    response.json(formatOnboarding(profile));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (request, response, next) => {
  try {
    const data = validateOnboarding(request.body?.onboarding);
    const completedAt = new Date();
    let profile;
    try {
      profile = await prisma.onboardingProfile.create({
        data: { userId: request.user.id, ...data, completedAt },
        select: PROFILE_SELECT,
      });
    } catch (error) {
      if (error.code === "P2002") {
        throw new AppError(409, "Onboarding already exists. Use PUT /api/onboarding to edit it.");
      }
      throw error;
    }
    response.json({
      ...formatOnboarding(profile),
      next: "analysis",
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (request, response, next) => {
  try {
    const data = validateOnboarding(request.body?.onboarding);
    let profile;
    try {
      profile = await prisma.onboardingProfile.update({
        where: { userId: request.user.id },
        data: { ...data, completedAt: new Date() },
        select: PROFILE_SELECT,
      });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError(404, "No onboarding profile exists yet. Submit it with POST /api/onboarding first.");
      }
      throw error;
    }
    response.json({
      ...formatOnboarding(profile),
      next: "analysis",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
