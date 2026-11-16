const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

function generateVerificationCode() {
  return String(crypto.randomInt(100_000, 1_000_000));
}

function isVerificationCodeFormat(code) {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

function hashVerificationCode(code) {
  return bcrypt.hash(code, 10);
}

function verifyCodeHash(code, codeHash) {
  return bcrypt.compare(code, codeHash);
}

module.exports = {
  generateVerificationCode,
  hashVerificationCode,
  isVerificationCodeFormat,
  verifyCodeHash,
};
