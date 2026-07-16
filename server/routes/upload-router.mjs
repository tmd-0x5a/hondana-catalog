import express from "express";
import multer from "multer";

import { httpError } from "../http-error.mjs";
import { MAX_UPLOAD_BYTES } from "../image-validator.mjs";
import { asyncRoute } from "./async-route.mjs";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function createImageUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 1,
      parts: 3,
      fieldNameSize: 100,
      fieldSize: 256,
    },
    fileFilter(_request, file, callback) {
      const allowed = ALLOWED_IMAGE_TYPES.has(file.mimetype);
      callback(allowed ? null : httpError(400, "画像ファイルを選択してください。"), allowed);
    },
  });
}

/**
 * 画像受信、再解析、ISBN手動補完、通知非表示のルートを生成する。
 *
 * @param {object} dependencies ルート依存。
 * @param {import("../upload-service.mjs").UploadService} dependencies.uploadService アップロードサービス。
 * @param {import("express").RequestHandler} [dependencies.uploadRateLimit] 画像受信専用レート制限。
 * @returns {import("express").Router} `/api/upload`と`/api/uploads`ルーター。
 */
export function createUploadRouter({ uploadService, uploadRateLimit = (_request, _response, next) => next() }) {
  const router = express.Router();
  const imageUpload = createImageUploadMiddleware();

  router.get("/api/uploads", asyncRoute(async (request, response) => {
    const uploads = await uploadService.listVisibleUploads(request.query.limit);
    response.json({ uploads });
  }));

  router.post("/api/uploads/:id/dismiss", asyncRoute(async (request, response) => {
    await uploadService.dismissUpload(request.params.id);
    response.status(204).end();
  }));

  router.post("/api/upload", uploadRateLimit, imageUpload.single("image"), asyncRoute(async (request, response) => {
    if (!request.file) throw httpError(400, "画像を選択してください。");
    const result = await uploadService.receiveImage(request.file, request.body?.isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));

  router.post("/api/uploads/:id/isbn", asyncRoute(async (request, response) => {
    const result = await uploadService.completeWithIsbn(request.params.id, request.body?.isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));

  router.post("/api/uploads/:id/retry", asyncRoute(async (request, response) => {
    const result = await uploadService.retryBarcode(request.params.id);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));

  return router;
}
