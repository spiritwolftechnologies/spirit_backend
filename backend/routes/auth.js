const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const { prisma } = require("../db/pool");
const { requireUser, SESSION_COOKIE, getSessionToken } = require("../middleware/requireUser");
const { AppError } = require("../utils/appError");
const { sendVerificationEmail } = require("../services/verificationEmail");
const {
  generateVerificationCode,
  hashVerificationCode,
  isVerificationCodeFormat,
  verifyCodeHash,
} = require("../utils/verificationCode");

const router = express.Router();
const OAUTH_STATE_COOKIE = "spiritwolf_google_state";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_CODE_TTL = 5 * 60 * 1000;
const VERIFICATION_RESEND_DELAY = 60 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "http://localhost:3000").split(",")[0].trim();

function sessionCookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge,
  };
}

function setSession(response, token) {
  response.cookie(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
}

function googleRedirectUri() {
  return process.env.GOOGLE_CALLBACK_URL ||
    `http://localhost:${process.env.PORT || 4000}/api/auth/google/callback`;
}

function redirectToLogin(response, code) {
  response.redirect(`${FRONTEND_ORIGIN}/login?authError=${encodeURIComponent(code)}`);
}

async function findGoogleUser(profile) {
  const accountWhere = {
    provider_providerAccountId: {
      provider: "google",
      providerAccountId: profile.sub,
    },
  };
  const linkedAccount = await prisma.oAuthAccount.findUnique({
    where: accountWhere,
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  if (linkedAccount) return linkedAccount.user;

  const email = profile.email.trim().toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    try {
      await prisma.oAuthAccount.create({
        data: {
          provider: "google",
          providerAccountId: profile.sub,
          userId: existingUser.id,
        },
      });
      return { id: existingUser.id, name: existingUser.name, email: existingUser.email };
    } catch (error) {
      if (error.code !== "P2002") throw error;
      const racedAccount = await prisma.oAuthAccount.findUnique({
        where: accountWhere,
        select: { user: { select: { id: true, name: true, email: true } } },
      });
      if (racedAccount) return racedAccount.user;
      throw error;
    }
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: (profile.name || email.split("@")[0]).trim().slice(0, 120),
          email,
        },
        select: { id: true, name: true, email: true },
      });
      await transaction.oAuthAccount.create({
        data: {
          provider: "google",
          providerAccountId: profile.sub,
          userId: user.id,
        },
      });
      return user;
    });
  } catch (error) {
    if (error.code !== "P2002") throw error;
    const racedAccount = await prisma.oAuthAccount.findUnique({
      where: accountWhere,
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (racedAccount) return racedAccount.user;
    throw error;
  }
}

function validateEmail(email) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AppError(400, "Enter a valid work email address.");
  }
  return email.trim().toLowerCase();
}

function validateCredentials(email, password) {
  validateEmail(email);
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AppError(400, "Password must be between 8 and 128 characters.");
  }
}

async function createSession(user, response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE);
  await prisma.session.create({
    data: { tokenHash, userId: user.id, expiresAt },
  });
  setSession(response, token);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    token,
  };
}

router.post("/register", async (request, response, next) => {
  try {
    const { name, email, password } = request.body || {};
    validateCredentials(email, password);
    const normalizedEmail = validateEmail(email);
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
      throw new AppError(400, "Name must be between 2 and 120 characters.");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) throw new AppError(409, "An account with this email already exists.");

    const now = new Date();
    const pendingVerification = await prisma.emailVerification.findUnique({
      where: { email: normalizedEmail },
      select: { lastSentAt: true },
    });
    if (pendingVerification && now.getTime() - pendingVerification.lastSentAt.getTime() < VERIFICATION_RESEND_DELAY) {
      throw new AppError(429, "Wait a minute before requesting another verification code.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    await prisma.emailVerification.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        codeHash,
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL),
        lastSentAt: now,
      },
      update: {
        name: name.trim(),
        passwordHash,
        codeHash,
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL),
        attempts: 0,
        lastSentAt: now,
      },
    });
    try {
      await sendVerificationEmail(normalizedEmail, code, name.trim());
    } catch (error) {
      await prisma.emailVerification.deleteMany({
        where: { email: normalizedEmail, codeHash },
      });
      throw error;
    }
    response.status(202).json({
      message: "A verification code has been sent to your email address.",
      email: normalizedEmail,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/verify-email", async (request, response, next) => {
  try {
    const { email, code } = request.body || {};
    const normalizedEmail = validateEmail(email);
    if (!isVerificationCodeFormat(code)) {
      throw new AppError(400, "Enter the 6-digit verification code.");
    }

    const pendingVerification = await prisma.emailVerification.findUnique({
      where: { email: normalizedEmail },
    });
    if (!pendingVerification || pendingVerification.expiresAt.getTime() <= Date.now()) {
      if (pendingVerification) {
        await prisma.emailVerification.deleteMany({
          where: { email: normalizedEmail, codeHash: pendingVerification.codeHash },
        });
      }
      throw new AppError(400, "The verification code is invalid or expired.");
    }
    if (pendingVerification.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      throw new AppError(429, "Too many incorrect verification attempts. Request a new code.");
    }

    if (!(await verifyCodeHash(code, pendingVerification.codeHash))) {
      await prisma.emailVerification.updateMany({
        where: {
          email: normalizedEmail,
          codeHash: pendingVerification.codeHash,
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError(400, "The verification code is invalid or expired.");
    }

    const user = await prisma.$transaction(async (transaction) => {
      const claimedVerification = await transaction.emailVerification.deleteMany({
        where: {
          email: normalizedEmail,
          codeHash: pendingVerification.codeHash,
          expiresAt: { gt: new Date() },
          attempts: { lt: VERIFICATION_MAX_ATTEMPTS },
        },
      });
      if (claimedVerification.count !== 1) {
        throw new AppError(400, "The verification code is invalid or expired.");
      }

      try {
        return await transaction.user.create({
          data: {
            name: pendingVerification.name,
            email: normalizedEmail,
            passwordHash: pendingVerification.passwordHash,
          },
          select: { id: true, name: true, email: true },
        });
      } catch (error) {
        if (error.code === "P2002") {
          throw new AppError(409, "An account with this email already exists.");
        }
        throw error;
      }
    });

    response.status(201).json(await createSession(user, response));
  } catch (error) {
    next(error);
  }
});

router.post("/verification/resend", async (request, response, next) => {
  try {
    const normalizedEmail = validateEmail((request.body || {}).email);
    const pendingVerification = await prisma.emailVerification.findUnique({
      where: { email: normalizedEmail },
    });
    if (!pendingVerification) {
      return response.status(202).json({
        message: "If registration is pending for this email, a new code has been sent.",
      });
    }

    const now = new Date();
    if (now.getTime() - pendingVerification.lastSentAt.getTime() < VERIFICATION_RESEND_DELAY) {
      throw new AppError(429, "Wait a minute before requesting another verification code.");
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    await prisma.emailVerification.update({
      where: { email: normalizedEmail },
      data: {
        codeHash,
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL),
        attempts: 0,
        lastSentAt: now,
      },
    });
    try {
      await sendVerificationEmail(normalizedEmail, code, pendingVerification.name);
    } catch (error) {
      await prisma.emailVerification.deleteMany({
        where: { email: normalizedEmail, codeHash },
      });
      throw error;
    }
    response.status(202).json({
      message: "A new verification code has been sent to your email address.",
      email: normalizedEmail,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (request, response, next) => {
  try {
    const { email, password } = request.body || {};
    validateCredentials(email, password);
    const user = await prisma.user.findUnique({
      where: { email: validateEmail(email) },
    });
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(
        401,
        "Email or password is incorrect. Register and verify your email before logging in if you don't already have an account.",
      );
    }
    response.json(await createSession(user, response));
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (request, response, next) => {
  try {
    const token = getSessionToken(request);
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await prisma.session.deleteMany({ where: { tokenHash } });
    }
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(0));
    response.json({ message: "Logged out." });
  } catch (error) {
    next(error);
  }
});

router.get("/google", (request, response) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirectToLogin(response, "google_not_configured");
  }

  const state = crypto.randomBytes(32).toString("base64url");
  response.cookie(OAUTH_STATE_COOKIE, state, sessionCookieOptions(5 * 60 * 1000));
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  return response.redirect(authorizationUrl.toString());
});

router.get("/google/callback", async (request, response) => {
  const expectedState = request.cookies[OAUTH_STATE_COOKIE];
  const actualState = typeof request.query.state === "string" ? request.query.state : "";
  response.clearCookie(OAUTH_STATE_COOKIE, sessionCookieOptions(0));

  if (request.query.error || typeof request.query.code !== "string") {
    return redirectToLogin(response, "google_cancelled");
  }
  if (
    !expectedState ||
    expectedState.length !== actualState.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(actualState))
  ) {
    return redirectToLogin(response, "google_state_invalid");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirectToLogin(response, "google_not_configured");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: request.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      console.error("Google token exchange failed with status:", tokenResponse.status);
      return redirectToLogin(response, "google_exchange_failed");
    }
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string") {
      return redirectToLogin(response, "google_profile_failed");
    }
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!profileResponse.ok) {
      console.error("Google profile lookup failed with status:", profileResponse.status);
      return redirectToLogin(response, "google_profile_failed");
    }
    const profile = await profileResponse.json();
    if (
      typeof profile.sub !== "string" ||
      typeof profile.email !== "string" ||
      profile.email_verified !== true
    ) {
      return redirectToLogin(response, "google_email_unverified");
    }

    const user = await findGoogleUser(profile);
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    await prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE),
      },
    });
    setSession(response, sessionToken);
    return response.redirect(`${FRONTEND_ORIGIN}/`);
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    return redirectToLogin(response, "google_failed");
  }
});

router.get("/me", requireUser, (request, response) => {
  response.json({ user: request.user });
});

module.exports = router;
