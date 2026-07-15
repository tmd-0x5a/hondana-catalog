import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { httpError } from "./http-error.mjs";

const MAX_UPLOAD_HISTORY = 100;
const SUCCESS_NOTICE_LIFETIME_MS = 60 * 1000;

function imageExtension(file) {
  const extensionByMimeType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  return extensionByMimeType[file.mimetype] || path.extname(file.originalname).toLowerCase() || ".jpg";
}

/** 画像ファイル、解析状態、アップロード履歴、ISBN確定処理をまとめる。 */
export class UploadService {
  constructor({ repository, bookService, barcodeScanner, uploadDir, now = () => new Date().toISOString(), createId = crypto.randomUUID }) {
    this.repository = repository;
    this.bookService = bookService;
    this.barcodeScanner = barcodeScanner;
    this.uploadDir = uploadDir;
    this.now = now;
    this.createId = createId;
  }

  async listVisibleUploads(limitValue) {
    const limit = Math.min(Math.max(Number(limitValue) || 10, 1), MAX_UPLOAD_HISTORY);
    const uploads = await this.repository.readUploads();
    const recentSuccessCutoff = Date.now() - SUCCESS_NOTICE_LIFETIME_MS;
    return uploads
      .filter((upload) => this.#isVisible(upload, recentSuccessCutoff))
      .slice(0, limit);
  }

  async dismissUpload(id) {
    const uploads = await this.repository.readUploads();
    const uploadIndex = uploads.findIndex((upload) => upload.id === id);
    if (uploadIndex < 0) throw httpError(404, "アップロード履歴が見つかりません。");
    uploads[uploadIndex] = { ...uploads[uploadIndex], dismissedAt: this.now() };
    await this.repository.saveUploads(uploads);
  }

  async receiveImage(file, suppliedIsbn) {
    const storedFilename = await this.#saveImage(file);
    const upload = await this.#saveUploadRecord({
      id: this.createId(),
      originalName: file.originalname || "iPhoneの写真",
      storedFilename,
      imageUrl: `/uploads/${storedFilename}`,
      status: "processing",
      message: "ISBNバーコードを解析しています。",
      createdAt: this.now(),
    });

    try {
      const isbn = suppliedIsbn || await this.barcodeScanner.scan(file.buffer);
      return await this.#completeUpload(upload, isbn);
    } catch (error) {
      if (error.status !== 422) throw error;
      error.upload = await this.#saveUploadRecord({
        ...upload,
        status: "needs_isbn",
        message: error.message,
      });
      throw error;
    }
  }

  async completeWithIsbn(uploadId, isbn) {
    const upload = await this.#findUpload(uploadId);
    return this.#completeUpload(upload, isbn);
  }

  async retryBarcode(uploadId) {
    const upload = await this.#findUpload(uploadId);
    const image = await fsp.readFile(path.join(this.uploadDir, upload.storedFilename));
    const isbn = await this.barcodeScanner.scan(image);
    return this.#completeUpload(upload, isbn);
  }

  #isVisible(upload, recentSuccessCutoff) {
    if (upload.dismissedAt) return false;
    if (upload.status !== "success") return true;
    const completedAt = Date.parse(upload.completedAt || upload.createdAt || 0);
    return completedAt >= recentSuccessCutoff;
  }

  async #saveImage(file) {
    const storedFilename = `${Date.now()}-${this.createId()}${imageExtension(file)}`;
    await fsp.writeFile(path.join(this.uploadDir, storedFilename), file.buffer);
    return storedFilename;
  }

  async #saveUploadRecord(record) {
    const uploads = await this.repository.readUploads();
    const existingIndex = uploads.findIndex((upload) => upload.id === record.id);
    if (existingIndex >= 0) uploads[existingIndex] = record;
    else uploads.unshift(record);
    await this.repository.saveUploads(uploads.slice(0, MAX_UPLOAD_HISTORY));
    return record;
  }

  async #findUpload(id) {
    const uploads = await this.repository.readUploads();
    const upload = uploads.find((item) => item.id === id);
    if (!upload) throw httpError(404, "アップロード画像が見つかりません。");
    return upload;
  }

  async #completeUpload(upload, isbn) {
    const { book, duplicate } = await this.bookService.importIsbn(isbn, upload);
    const completedUpload = {
      ...upload,
      isbn: book.isbn,
      bookId: book.id,
      status: "success",
      message: duplicate ? "登録済みの本を更新しました。" : "本棚に登録しました。",
      completedAt: this.now(),
    };
    await this.#saveUploadRecord(completedUpload);
    return { book, upload: completedUpload, duplicate };
  }
}
