# Spiritwolf API

## Run locally

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, the SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`), and `AI_API_KEY`. For port `465`, set `SMTP_SECURE=true`; for `587`, use `SMTP_SECURE=false`. To enable Google sign-in, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`, and add the callback URL to the Google OAuth client's authorized redirect URIs. `AI_BASE_URL` and `AI_MODEL` can point at an OpenAI-compatible chat-completions provider.
3. Install dependencies, generate the Prisma Client, and push the schema:

   ```bash
   npm install
   npm run prisma:generate
   npm run prisma:push
   ```

4. Start the API:

   ```bash
   npm run dev
   ```

The Prisma schema is in `prisma/schema.prisma`. The API listens on port `4000` by default. Set `PORT` or `FRONTEND_ORIGIN` as needed. Add the provider's SSL parameters to `DATABASE_URL` when hosted PostgreSQL requires TLS.

## Postman

Import [`Spiritwolf API.postman_collection.json`](./Spiritwolf%20API.postman_collection.json) into Postman. The collection's `baseUrl` defaults to `http://localhost:4000`; change it if the API runs elsewhere. First send **Register**, retrieve the emailed code, set the collection's `verificationCode` variable, then send **Verify email**. Only after successful verification does the account exist and password login become available. Verification includes a session token and sets the session cookie; the collection saves the token for protected endpoints. Password login also returns and saves a token. Use the same `testEmail` and `testPassword` variables for register and login. Change the email before registering again, since duplicate registration returns `409`.

The file-reading request uses `multipart/form-data` with a `file` field. Select a local file in Postman; the collection includes the field but cannot bundle a file path. Supported formats are `.txt`, `.csv`, `.md`, `.pdf`, and `.xlsx`.

Google sign-in is a browser-based redirect flow. Start it at `GET /api/auth/google` in a browser; the configured callback handles Google's redirect. Callback parameters are issued by Google and should not be fabricated for a normal sign-in.

## Endpoints

Unless stated otherwise, errors have the form `{"error":"message"}`. Protected endpoints accept either a session cookie named `spiritwolf_session` or `Authorization: Bearer <token>`. Email/password registration sends a verification code and does not create an account or session until the code is verified. Google sign-in continues to use Google's verified-email claim and does not require this OTP. The code expires after 5 minutes, allows up to 5 incorrect attempts, and can be resent once per minute. Successful email verification and password login return a session token and set the session cookie; sessions expire after 7 days. JSON request bodies use `Content-Type: application/json`.

### `GET /health`

No authentication or request body.

**200 response**

```json
{ "status": "ok" }
```

### `POST /api/auth/register`

Begin account creation. `name` must be 2–120 characters, `email` must be valid, and `password` must be 8–128 characters. This sends a 6-digit code to the email address; it does not create an account or session yet.

**Request**

```json
{
  "name": "Taylor Example",
  "email": "taylor@example.com",
  "password": "ChangeMe123!"
}
```

**202 response**

```json
{
  "message": "A verification code has been sent to your email address.",
  "email": "taylor@example.com"
}
```

Duplicate email returns `409`; SMTP must be configured to deliver the code.

### `POST /api/auth/verify-email`

Verify the code sent by registration. The code expires after 5 minutes. Up to 5 incorrect attempts are allowed; request a new code after reaching the limit.

**Request**

```json
{
  "email": "taylor@example.com",
  "code": "123456"
}
```

**201 response**

```json
{
  "user": {
    "id": "user-id",
    "name": "Taylor Example",
    "email": "taylor@example.com"
  },
  "token": "session-token"
}
```

The response also sets the `spiritwolf_session` cookie. Send the returned token on subsequent API requests as `Authorization: Bearer session-token`.

### `POST /api/auth/verification/resend`

Resend a code for a pending registration. A resend is allowed once per minute. No pending registration returns a generic `202` response.

**Request**

```json
{
  "email": "taylor@example.com"
}
```

**202 response**

```json
{
  "message": "A new verification code has been sent to your email address.",
  "email": "taylor@example.com"
}
```

### `POST /api/auth/login`

Create a session for an existing email/password account. The email/password account is created only after successful registration-code verification; login never creates an account. Attempting login before registration and verification returns `401`.

**Request**

```json
{
  "email": "taylor@example.com",
  "password": "ChangeMe123!"
}
```

**200 response**

```json
{
  "user": {
    "id": "user-id",
    "name": "Taylor Example",
    "email": "taylor@example.com"
  },
  "token": "session-token"
}
```

Sets the session cookie and returns a token usable as a Bearer token. Invalid credentials or an account that has not been created by completing registration return `401`.

### `POST /api/auth/logout`

Revoke the current session when present and clear its cookie. No request body.

**200 response**

```json
{ "message": "Logged out." }
```

### `GET /api/auth/me`

Return the signed-in account. Requires a session.

**200 response**

```json
{
  "user": {
    "id": "user-id",
    "name": "Taylor Example",
    "email": "taylor@example.com"
  }
}
```

### `GET /api/auth/google`

Start Google OAuth. No request body. With Google OAuth configured, redirects to Google's consent page; without it, redirects to the frontend login page with `authError=google_not_configured`.

### `GET /api/auth/google/callback`

Google OAuth callback, normally called by Google with `code` and `state` query parameters after the `/google` flow. No JSON body. On success, sets the session cookie and redirects to the frontend. Errors redirect to the frontend login page with an `authError` query parameter.

### `GET /api/onboarding`

Return the signed-in user's saved four-step business profile and whether onboarding is complete. Requires a session.

**200 response**

```json
{
  "onboarding": {
    "steps": {
      "1": {
        "businessName": "Spiritwolf Labs",
        "industry": "B2B Cloud Infrastructure & SaaS",
        "stage": "Growing",
        "description": "Workflow automation for software teams."
      },
      "2": null,
      "3": null,
      "4": null
    },
    "completed": false,
    "completedAt": null,
    "nextStep": 2
  }
}
```

### `PUT /api/onboarding/steps/{1|2|3|4}`

Save or replace an individual step. Each step is persisted separately, so a user can leave and resume onboarding. All endpoints require a session. Save each step before moving on; after editing a step on a completed profile, call the completion endpoint again.

**Step 1 request**

```json
{
  "businessName": "Spiritwolf Labs",
  "industry": "B2B Cloud Infrastructure & SaaS",
  "stage": "Growing",
  "description": "Workflow automation for software teams."
}
```

`businessName` (1–120 chars), `industry` (1–100 chars), and `stage` (`Idea`, `Early`, `Growing`, or `Established`) are required. `description` is optional (up to 1,000 chars).

**Step 2 request**

```json
{
  "targetCustomerProfile": "Mid-market CISOs and Security Directors",
  "customerTypes": ["B2B Mid-Market"],
  "geographicMarkets": ["North America"],
  "averageDealSize": "$45,000",
  "salesMotion": "Sales-Assisted"
}
```

`targetCustomerProfile` (1–250 chars), one or more `customerTypes` (`B2B Enterprise`, `B2B Mid-Market`, `B2C / Consumer`, `B2B2C`), and one or more `geographicMarkets` (`North America`, `Europe / UK`, `APAC`, `Global`) are required. `averageDealSize` (up to 50 chars) and `salesMotion` (`Product-Led (PLG)`, `Sales-Assisted`, `Channel / Partner`) are optional.

**Step 3 request**

```json
{
  "competitors": ["Vanta", "Drata"],
  "pricingModel": "Subscription / SaaS",
  "competitiveMoats": ["Proprietary IP", "Switching Cost"],
  "pricingFriction": "Enterprise prospects request custom terms."
}
```

`competitors` is an array of up to 20 names (each 1–100 chars; it may be empty). `pricingModel` is required and must be `Subscription / SaaS`, `Usage-based`, `Per-Seat`, or `Fixed Tier`. `competitiveMoats` is optional and may contain `Proprietary IP`, `Switching Cost`, `Data Network Effects`, or `Speed to Deployment`. `pricingFriction` is optional (up to 250 chars).

**Step 4 request**

```json
{
  "quarterlyGoals": ["Increase Conversion / Win Rate", "Reduce Churn"],
  "biggestObstacle": "Unclear ICP Definition",
  "businessInquiry": "Where should we focus next?",
  "planningHorizon": "12+ Months"
}
```

Select one or more `quarterlyGoals` from `Increase Conversion / Win Rate`, `Scale Enterprise Outbound`, `Reduce Churn`, and `Refine Pricing Tier`. `biggestObstacle` is required (`Unclear ICP Definition`, `Resource Constraints`, `Long Sales Cycles`, or `Product Differentiation`). `businessInquiry` is optional (up to 500 chars), and `planningHorizon` must be `1-3 Months`, `6 Months`, or `12+ Months`.

Each successful save returns the refreshed `onboarding` status. Invalid or missing required values return `400`.

### `POST /api/onboarding/complete`

Mark onboarding complete after all four steps have been saved. Requires a session. Missing steps return `409` and list the steps that still need to be completed.

**200 response**

```json
{
  "onboarding": {
    "steps": { "1": {}, "2": {}, "3": {}, "4": {} },
    "completed": true,
    "completedAt": "2026-01-01T12:00:00.000Z",
    "nextStep": null
  },
  "next": "analysis"
}
```

The frontend can move the user to the decision-analysis screen after this response. `POST /api/analysis` returns `409` until onboarding is complete; completed business profile data is automatically included as analysis context.

### `POST /api/analysis`

Generate and save a decision report. Requires a session and a configured `AI_API_KEY`. `decision` is required (8–500 characters); other fields are optional. `details` is limited to 2,000 characters, `context` to 50,000 characters, and `externalResearch` must be a boolean.

**Request**

```json
{
  "decision": "Should we launch the new subscription plan?",
  "details": "We are considering a three-month pilot before a full launch.",
  "context": "Current retention is 84%; the plan is still being validated.",
  "externalResearch": false
}
```

**201 response**

```json
{
  "analysis": {
    "id": "analysis-id",
    "decision": "Should we launch the new subscription plan?",
    "report": {
      "executiveSummary": "A concise assessment of the decision.",
      "recommendation": "Run a limited pilot and review results before expanding.",
      "confidence": "medium",
      "keyConsiderations": ["Validate customer demand during the pilot."],
      "nextSteps": ["Define success metrics before the pilot begins."],
      "assumptions": ["The retention figure reflects the current customer base."],
      "risks": ["Pilot results may not represent broader demand."]
    },
    "createdAt": "2026-01-01T12:00:00.000Z"
  }
}
```

The report is generated by the configured AI provider, so its text will vary. `externalResearch: true` requests external research, but this backend does not provide a browsing tool and the report should state that limitation.

### `GET /api/analysis/history`

Return the current account's latest 50 analyses. Requires a session; no request body.

**200 response**

```json
{
  "analyses": [
    {
      "id": "analysis-id",
      "decision": "Should we launch the new subscription plan?",
      "report": {
        "executiveSummary": "A concise assessment of the decision.",
        "recommendation": "Run a limited pilot before expanding.",
        "confidence": "medium",
        "keyConsiderations": ["Validate customer demand."],
        "nextSteps": ["Define pilot success metrics."],
        "assumptions": ["The supplied retention figure is accurate."],
        "risks": ["The pilot may not represent broader demand."]
      },
      "createdAt": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

An account with no saved reports receives `{"analyses":[]}`.

### `POST /api/files/read`

Extract text from one uploaded file. Requires a session. Send `multipart/form-data` with the file in the `file` field; maximum upload size is 10 MB and extracted text is limited to 50,000 characters.

**200 response**

```json
{
  "fileName": "notes.txt",
  "text": "The extracted file contents.",
  "characters": 28
}
```

### Common errors

- `400` invalid/missing fields, malformed JSON, missing upload, or incorrect/expired verification code.
- `401` no valid session for a protected endpoint.
- `409` email already registered.
- `429` verification code resend cooldown or too many incorrect code attempts.
- `502` SMTP delivery failure.
- `503` SMTP settings missing or invalid.
- `413` upload or extracted text exceeds its size limit.
- `415` unsupported file extension.
- `422` file could not be read or contains no readable text.
- `502`, `503`, or `504` analysis provider errors or timeout.
- `502` or `503` SMTP delivery/configuration errors during registration.
- `404` unknown route.

Run focused backend checks with `npm test`.
