const express = require("express");
const { prisma } = require("../db/pool");
const { requireUser } = require("../middleware/requireUser");
const { AppError } = require("../utils/appError");
const { validateStep } = require("../utils/onboarding");

const router = express.Router();
const PROFILE_SELECT = {
  step1: true,
  step2: true,
  step3: true,
  step4: true,
  completedAt: true,
};

function formatOnboarding(profile) {
  const steps = {
    1: profile?.step1 || null,
    2: profile?.step2 || null,
    3: profile?.step3 || null,
    4: profile?.step4 || null,
  };
  const nextStep = [1, 2, 3, 4].find((step) => !steps[step]) || null;
  return {
    steps,
    completed: Boolean(profile?.completedAt),
    completedAt: profile?.completedAt ? profile.completedAt.toISOString() : null,
    nextStep,
  };
}

router.use(requireUser);

router.get("/", async (request, response, next) => {
  try {
    const profile = await prisma.onboardingProfile.findUnique({
      where: { userId: request.user.id },
      select: PROFILE_SELECT,
    });
    response.json({ onboarding: formatOnboarding(profile) });
  } catch (error) {
    next(error);
  }
});

router.put("/steps/:step", async (request, response, next) => {
  try {
    const step = Number(request.params.step);
    if (!Number.isInteger(step) || step < 1 || step > 4) {
      throw new AppError(400, "Step must be a number from 1 to 4.");
    }

    const data = validateStep(step, request.body);
    const stepField = `step${step}`;
    const profile = await prisma.onboardingProfile.upsert({
      where: { userId: request.user.id },
      create: { userId: request.user.id, [stepField]: data },
      update: { [stepField]: data, completedAt: null },
      select: PROFILE_SELECT,
    });
    response.json({ onboarding: formatOnboarding(profile) });
  } catch (error) {
    next(error);
  }
});

router.post("/complete", async (request, response, next) => {
  try {
    const profile = await prisma.onboardingProfile.findUnique({
      where: { userId: request.user.id },
      select: PROFILE_SELECT,
    });
    const missingSteps = profile
      ? [1, 2, 3, 4].filter((step) => !profile[`step${step}`])
      : [1, 2, 3, 4];
    if (missingSteps.length) {
      throw new AppError(409, `Complete onboarding steps ${missingSteps.join(", ")} before continuing.`);
    }

    const completedProfile = await prisma.onboardingProfile.update({
      where: { userId: request.user.id },
      data: { completedAt: new Date() },
      select: PROFILE_SELECT,
    });
    response.json({
      onboarding: formatOnboarding(completedProfile),
      next: "analysis",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
