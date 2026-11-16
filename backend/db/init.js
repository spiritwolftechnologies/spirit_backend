const { prisma } = require("./pool");

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured before starting the API.");
  }
  await prisma.$connect();
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.emailVerification.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

module.exports = { initializeDatabase };
