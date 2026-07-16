import express from "express";
import multer from "multer";

import { httpError } from "../http-error.mjs";
import { MAX_UPLOAD_BYTES } from "../image-validator.mjs";
import { MAX_OCR_SCREENSHOTS } from "../windows-ocr-service.mjs";
import { asyncRoute } from "./async-route.mjs";

const ALLOWED_SCREENSHOT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function createScreenshotUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: MAX_OCR_SCREENSHOTS,
      fields: 0,
      parts: MAX_OCR_SCREENSHOTS,
      fieldNameSize: 100,
    },
    fileFilter(_request, file, callback) {
      const allowed = ALLOWED_SCREENSHOT_TYPES.has(file.mimetype);
      callback(allowed ? null : httpError(400, "JPEG、PNG、WebP、HEIC画像を選択してください。"), allowed);
    },
  });
}

/**
 * @param {object} dependencies 一括取り込み依存。
 * @param {import("../book-bulk-import-service.mjs").BookBulkImportService} dependencies.bulkImportService 一括登録サービス。
 * @param {import("../book-screenshot-import-service.mjs").BookScreenshotImportService} dependencies.screenshotImportService OCR候補生成サービス。
 * @param {import("express").RequestHandler} [dependencies.screenshotRateLimit] OCR専用レート制限。
 * @returns {import("express").Router} 一括取り込みルーター。
 */
export function createBulkImportRouter({ bulkImportService, screenshotImportService, screenshotRateLimit = (_request, _response, next) => next() }) {
  const router = express.Router();
  const screenshotUpload = createScreenshotUploadMiddleware();

  router.post(
    "/api/books/bulk/scan",
    screenshotRateLimit,
    screenshotUpload.array("screenshots", MAX_OCR_SCREENSHOTS),
    asyncRoute(async (request, response) => {
      if (!request.files?.length) throw httpError(400, "スクリーンショットを選択してください。");
      response.json(await screenshotImportService.scanScreenshots(request.files));
    }),
  );

  router.post("/api/books/bulk", asyncRoute(async (request, response) => {
    const result = await bulkImportService.importBooks(request.body);
    response.status(result.createdCount > 0 ? 201 : 200).json(result);
  }));
  return router;
}
