require("dotenv").config();

const cors = require("cors");
const cookieParser = require("cookie-parser");
const express = require("express");
const { initializeDatabase } = require("./db/init");
const authRoutes = require("./routes/auth");
const analysisRoutes = require("./routes/analysis");
const fileRoutes = require("./routes/files");
const { AppError } = require("./utils/appError");

const app = express();
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, "This origin is not allowed."));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/files", fileRoutes);

app.use((_request, _response, next) => next(new AppError(404, "Route not found.")));
app.use((error, _request, response, _next) => {
  if (error.name === "MulterError") {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return response.status(status).json({
      error: status === 413 ? "The file exceeds the 10 MB size limit." : error.message,
    });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must contain valid JSON." });
  }

  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error("API request failed:", error);
  return response.status(status).json({
    error: status >= 500 ? "The server could not complete the request." : error.message,
  });
});

const port = Number(process.env.PORT || 4000);
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      app.listen(port, () => console.log(`Spiritwolf API listening on port ${port}`));
    })
    .catch((error) => {
      console.error("Backend startup failed:", error);
      process.exitCode = 1;
    });
}

module.exports = app;
