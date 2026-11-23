const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ExcelJS = require("exceljs");
const { once } = require("node:events");
const app = require("../app");
const { prisma } = require("../db/pool");
const { readUploadedFile } = require("../services/fileReader");
const { buildVerificationEmail } = require("../services/verificationEmailTemplate");
const { validateReport } = require("../utils/validateReport");
const { getSessionToken } = require("../middleware/requireUser");
const { validateStep } = require("../utils/onboarding");
const {
  generateVerificationCode,
  hashVerificationCode,
  isVerificationCodeFormat,
  verifyCodeHash,
} = require("../utils/verificationCode");

function upload(name, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { originalname: name, buffer, size: buffer.length };
}

test("extracts supported text formats and trims NUL bytes", async () => {
  const file = upload("notes.md", "  Decision notes\u0000\n");
  assert.equal(await readUploadedFile(file), "Decision notes");
});

test("rejects unsupported, empty, and over-limit extracted files", async () => {
  await assert.rejects(readUploadedFile(upload("data.exe", "x")), /Supported files/);
  await assert.rejects(readUploadedFile(upload("blank.txt", "")), /empty/);
  await assert.rejects(readUploadedFile(upload("large.txt", "x".repeat(50_001))), /50,000/);
});

test("extracts spreadsheet rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Plan");
  sheet.addRow(["Metric", "Value"]);
  sheet.addRow(["Revenue", 42000]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const text = await readUploadedFile(upload("plan.xlsx", buffer));
  assert.match(text, /Sheet: Plan/);
  assert.match(text, /Revenue\t42000/);
});

test("validates a complete AI report and rejects incomplete content", () => {
  const report = {
    executiveSummary: "A measured review.",
    recommendation: "Run a small test before a full rollout.",
    confidence: "medium",
    keyConsiderations: ["The sample size is small."],
    nextSteps: ["Gather customer feedback."],
    assumptions: ["The current margin is accurate."],
    risks: ["Demand may be lower than forecast."],
  };
  assert.deepEqual(validateReport(report), { ...report, confidence: "medium" });
  assert.throws(() => validateReport({ ...report, risks: [] }), /incomplete report/);
});

test("generates six-digit verification codes and stores them as one-way hashes", async () => {
  const code = generateVerificationCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(isVerificationCodeFormat(code), true);
  assert.equal(isVerificationCodeFormat("12345"), false);
  assert.equal(isVerificationCodeFormat("12a456"), false);

  const codeHash = await hashVerificationCode(code);
  assert.notEqual(codeHash, code);
  assert.equal(await verifyCodeHash(code, codeHash), true);
  const differentCode = code === "999999" ? "888888" : "999999";
  assert.equal(await verifyCodeHash(differentCode, codeHash), false);
});

test("accepts Bearer session tokens and retains cookie session support", () => {
  const bearerRequest = {
    get: () => "Bearer api-token",
    cookies: { spiritwolf_session: "cookie-token" },
  };
  assert.equal(getSessionToken(bearerRequest), "api-token");

  const cookieRequest = {
    get: () => undefined,
    cookies: { spiritwolf_session: "cookie-token" },
  };
  assert.equal(getSessionToken(cookieRequest), "cookie-token");
});

test("validates onboarding steps and permits optional form fields to be blank", () => {
  assert.deepEqual(validateStep(1, {
    businessName: "  Spiritwolf Labs ",
    industry: "B2B SaaS",
    stage: "Growing",
  }), {
    businessName: "Spiritwolf Labs",
    industry: "B2B SaaS",
    stage: "Growing",
    description: "",
  });
  assert.deepEqual(validateStep(3, {
    competitors: [],
    pricingModel: "Usage-based",
  }), {
    competitors: [],
    pricingModel: "Usage-based",
    competitiveMoats: [],
    pricingFriction: "",
  });
  assert.throws(() => validateStep(4, {
    quarterlyGoals: [],
    biggestObstacle: "Unclear ICP Definition",
    planningHorizon: "6 Months",
  }), /Quarterly goals/);
  assert.throws(() => validateStep(1, {
    businessName: "Spiritwolf Labs",
    industry: "B2B SaaS",
    stage: "Invalid",
  }), /Stage/);
});

test("onboarding saves four steps, gates analysis, and marks completion", async () => {
  const originalFindSession = prisma.session.findFirst;
  const profileModel = prisma.onboardingProfile;
  const originals = {
    findUnique: profileModel.findUnique,
    upsert: profileModel.upsert,
    update: profileModel.update,
    createAnalysis: prisma.analysis.create,
  };
  const originalFetch = global.fetch;
  const originalAiApiKey = process.env.AI_API_KEY;
  let profile = null;
  prisma.session.findFirst = async () => ({
    user: { id: "onboarding-test-user", name: "Test User", email: "test@example.com" },
  });
  profileModel.findUnique = async () => profile;
  profileModel.upsert = async ({ create, update }) => {
    profile = profile ? { ...profile, ...update } : { ...create, completedAt: null };
    return profile;
  };
  profileModel.update = async ({ data }) => {
    profile = { ...profile, ...data };
    return profile;
  };

  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const httpFetch = global.fetch;
  const headers = {
    Authorization: "Bearer onboarding-test-token",
    "Content-Type": "application/json",
  };
  async function send(path, method, body) {
    const response = await httpFetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, payload: await response.json() };
  }

  try {
    let result = await send("/api/onboarding", "GET");
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.onboarding.nextStep, 1);

    result = await send("/api/analysis", "POST", {
      decision: "Should we launch a new product?",
    });
    assert.equal(result.response.status, 409);

    result = await send("/api/onboarding/complete", "POST");
    assert.equal(result.response.status, 409);
    assert.match(result.payload.error, /steps 1, 2, 3, 4/);

    const steps = [
      {
        businessName: "Spiritwolf Labs",
        industry: "B2B SaaS",
        stage: "Growing",
      },
      {
        targetCustomerProfile: "Mid-market technology companies",
        customerTypes: ["B2B Mid-Market"],
        geographicMarkets: ["North America"],
      },
      { competitors: [], pricingModel: "Subscription / SaaS" },
      {
        quarterlyGoals: ["Reduce Churn"],
        biggestObstacle: "Resource Constraints",
        planningHorizon: "6 Months",
      },
    ];
    for (let index = 0; index < steps.length; index += 1) {
      result = await send(`/api/onboarding/steps/${index + 1}`, "PUT", steps[index]);
      assert.equal(result.response.status, 200);
    }

    result = await send("/api/onboarding/complete", "POST");
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.onboarding.completed, true);
    assert.equal(result.payload.onboarding.nextStep, null);
    assert.equal(result.payload.next, "analysis");

    result = await send("/api/onboarding", "GET");
    assert.equal(result.payload.onboarding.steps["1"].businessName, "Spiritwolf Labs");

    process.env.AI_API_KEY = "test-analysis-key";
    let aiRequest;
    global.fetch = async (_url, options) => {
      aiRequest = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                executiveSummary: "A measured review of the launch decision.",
                recommendation: "Run a limited pilot before a broader launch.",
                confidence: "medium",
                keyConsiderations: ["The target segment is mid-market."],
                nextSteps: ["Define pilot success criteria."],
                assumptions: ["The supplied customer profile is accurate."],
                risks: ["Pilot results may not generalize."],
              }),
            },
          }],
        }),
      };
    };
    prisma.analysis.create = async () => ({});
    result = await send("/api/analysis", "POST", {
      decision: "Should we launch a new product?",
    });
    assert.equal(result.response.status, 201);
    assert.match(aiRequest.messages[1].content, /Spiritwolf Labs/);
    assert.match(aiRequest.messages[1].content, /Mid-market technology companies/);

    result = await send("/api/onboarding/steps/1", "PUT", steps[0]);
    assert.equal(result.payload.onboarding.completed, false);
    result = await send("/api/analysis", "POST", {
      decision: "Should we launch a new product?",
    });
    assert.equal(result.response.status, 409);
  } finally {
    prisma.session.findFirst = originalFindSession;
    profileModel.findUnique = originals.findUnique;
    profileModel.upsert = originals.upsert;
    profileModel.update = originals.update;
    prisma.analysis.create = originals.createAnalysis;
    global.fetch = originalFetch;
    if (originalAiApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalAiApiKey;
    server.close();
    await once(server, "close");
  }
});

test("verification email contains the inline brand logo and escapes the recipient name", () => {
  const email = buildVerificationEmail("<Taylor & Co>", "123456");
  assert.match(email.html, /src="cid:spiritwolf-logo"/);
  assert.match(email.html, /alt="Spiritwolf Technologies"/);
  assert.match(email.html, /&lt;Taylor &amp; Co&gt;/);
  assert.doesNotMatch(email.html, /<Taylor & Co>/);
  assert.equal(email.attachments[0].cid, "spiritwolf-logo");
  assert.equal(fs.existsSync(email.attachments[0].path), true);
});

test("password login rejects users who have not completed registration", async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;
  let userCreated = false;
  prisma.user.findUnique = async () => null;
  prisma.user.create = async () => {
    userCreated = true;
    throw new Error("Login must not create an account.");
  };

  const server = app.listen(0);
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "ChangeMe123!" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.match(payload.error, /Register and verify your email before logging in/);
    assert.equal(userCreated, false);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
    server.close();
    await once(server, "close");
  }
});
