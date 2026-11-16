const crypto = require("node:crypto");
const { prisma } = require("../db/pool");
const { AppError } = require("../utils/appError");

const SESSION_COOKIE = "spiritwolf_session";

function getSessionToken(request) {
  const authorization = request.get("authorization");
  const bearerMatch = typeof authorization === "string"
    ? authorization.match(/^Bearer\s+(\S+)$/i)
    : null;
  return bearerMatch ? bearerMatch[1] : request.cookies[SESSION_COOKIE];
}

async function requireUser(request, _response, next) {
  const token = getSessionToken(request);
  if (!token) return next(new AppError(401, "Not authenticated."));

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!session) return next(new AppError(401, "Your session has expired. Please log in again."));

  request.user = session.user;
  request.sessionTokenHash = tokenHash;
  return next();
}

module.exports = { requireUser, SESSION_COOKIE, getSessionToken };
