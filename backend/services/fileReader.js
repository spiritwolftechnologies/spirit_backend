const path = require("node:path");
const ExcelJS = require("exceljs");
const pdfParse = require("pdf-parse");
const { AppError } = require("../utils/appError");

const SUPPORTED_EXTENSIONS = new Set([".txt", ".csv", ".md", ".pdf", ".xlsx"]);
const MAX_EXTRACTED_CHARS = 50_000;

async function readUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new AppError(400, "Choose a file to attach.");
  }
  const extension = path.extname(file.originalname).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new AppError(415, "Supported files are .txt, .csv, .md, .pdf, and .xlsx.");
  }
  if (file.size === 0) throw new AppError(400, "The selected file is empty.");

  let text;
  try {
    if (extension === ".txt" || extension === ".csv" || extension === ".md") {
      text = file.buffer.toString("utf8");
    } else if (extension === ".pdf") {
      const result = await pdfParse(file.buffer, { max: 100 });
      text = result.text;
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);
      const sheets = [];
      workbook.eachSheet((sheet) => {
        const rows = [];
        sheet.eachRow((row) => {
          rows.push(row.values.slice(1).map((value) => {
            if (value === null || value === undefined) return "";
            if (typeof value === "object" && "text" in value) return value.text;
            if (typeof value === "object" && "result" in value) return value.result;
            return String(value);
          }).join("\t"));
        });
        sheets.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
      });
      text = sheets.join("\n\n");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Unable to extract uploaded file:", error);
    throw new AppError(422, "This file could not be read. Check that it is a valid, unprotected document.");
  }

  if (typeof text !== "string" || !text.trim()) {
    throw new AppError(422, "No readable text was found in the file.");
  }
  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) throw new AppError(422, "No readable text was found in the file.");
  if (normalized.length > MAX_EXTRACTED_CHARS) {
    throw new AppError(413, "Extracted text exceeds the 50,000 character limit.");
  }
  return normalized;
}

module.exports = { readUploadedFile, MAX_EXTRACTED_CHARS };
