const express = require("express");
const multer = require("multer");
const { requireUser } = require("../middleware/requireUser");
const { readUploadedFile } = require("../services/fileReader");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

router.post("/read", requireUser, upload.single("file"), async (request, response, next) => {
  try {
    const text = await readUploadedFile(request.file);
    response.json({
      fileName: request.file.originalname,
      text,
      characters: text.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
