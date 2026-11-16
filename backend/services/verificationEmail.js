const nodemailer = require("nodemailer");
const { AppError } = require("../utils/appError");
const { buildVerificationEmail } = require("./verificationEmailTemplate");

async function sendVerificationEmail(email, code, name) {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT || 587);
  const secureValue = process.env.SMTP_SECURE;

  if (!host || !from || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError(503, "Email verification is not configured. Set the SMTP environment variables.");
  }
  if (secureValue && !["true", "false"].includes(secureValue.toLowerCase())) {
    throw new AppError(503, "SMTP_SECURE must be either true or false.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: secureValue ? secureValue.toLowerCase() === "true" : port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  try {
    const emailContent = buildVerificationEmail(name, code);
    const result = await transporter.sendMail({
      from,
      to: email,
      subject: `${code} is your Spiritwolf verification code`,
      ...emailContent,
    });
    if (result.rejected.includes(email)) {
      throw new Error("SMTP server rejected the recipient.");
    }
  } catch (error) {
    console.error("Verification email delivery failed:", error.message);
    throw new AppError(502, "Could not send the verification email. Check SMTP settings and try again.");
  }
}

module.exports = { sendVerificationEmail };
