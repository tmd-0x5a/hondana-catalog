import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { httpError } from "./http-error.mjs";
import { prepareUploadedImage } from "./image-validator.mjs";
import { normalizeIsbn } from "./isbn.mjs";
import { validateResourceId, validateUploadLimit } from "./request-validation.mjs";

const MAX_UPLOAD_HISTORY = 100;
const SUCCESS_NOTICE_LIFETIME_MS = 60 * 1000;

function safeOriginalName(value) {
  return path.basename(String(value || "iPhoneの写真"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 120) || "iPhoneの写真";
}

function safeStoredFilename(value) {
  const filename = String(value || "");
  if (path.basename(filename) !== filename || !/^[A-Za-z0-9.-]{1,200}$/.test(filename)) {
    throw httpError(400, "保存画像のファイル名が正しくありません。");
  }
  return filename;
}

/** 画像ファイル、解析状態、アップロード履歴、ISBN確定処理をまとめる。 */
export class UploadService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./library-repository.mjs").LibraryRepository} dependencies.repository 保存境界。
   * @param {import("./book-service.mjs").BookService} dependencies.bookService ISBN登録サービス。
   * @param {import("./barcode-scanner.mjs").BarcodeScanner} dependencies.barcodeScanner 画像解析器。
   * @param {string} dependencies.uploadDir 画像保存先。
   * @param {(buffer: Buffer) => Promise<{extension: string, buffer: Buffer}>} [dependencies.prepareImage] 画像検査・再構築関数。
   * @param {() => string} [dependencies.now] ISO日時関数。
   * @param {() => string} [dependencies.createId] 一意ID関数。
   */
  constructor({
    repository,
    bookService,
    barcodeScanner,
    uploadDir,
    prepareImage = prepareUploadedImage,
    now = () => new Date().toISOString(),
    createId = crypto.randomUUID,
  }) {
    this.repository = repository;
    this.bookService = bookService;
    this.barcodeScanner = barcodeScanner;
    this.uploadDir = uploadDir;
    this.prepareImage = prepareImage;
    this.now = now;
    this.createId = createId;
  }

  /**
   * @param {unknown} limitValue 取得件数クエリ。
   * @returns {Promise<import("../src/types.js").UploadRecord[]>} 表示対象の新しい履歴。
   */
  async listVisibleUploads(limitValue) {
    const limit = validateUploadLimit(limitValue);
    const uploads = await this.repository.readUploads();
    const recentSuccessCutoff = Date.now() - SUCCESS_NOTICE_LIFETIME_MS;
    return uploads
      .filter((upload) => this.#isVisible(upload, recentSuccessCutoff))
      .slice(0, limit);
  }

  /** @param {unknown} id アップロードID。 @returns {Promise<void>} */
  async dismissUpload(id) {
    const uploadId = validateResourceId(id, "アップロードID");
    await this.repository.updateUploads((uploads) => {
      const uploadIndex = uploads.findIndex((upload) => upload.id === uploadId);
      if (uploadIndex < 0) throw httpError(404, "アップロード履歴が見つかりません。");
      uploads[uploadIndex] = { ...uploads[uploadIndex], dismissedAt: this.now() };
    });
  }

  /**
   * 画像を検証・保存してISBNを解析し、蔵書へ登録する。
   *
   * @param {{buffer: Buffer, originalname?: string, mimetype?: string}} file Multer受信ファイル。
   * @param {unknown} suppliedIsbn 端末内で先に読み取れたISBN。
   * @returns {Promise<{book: import("../src/types.js").Book, upload: import("../src/types.js").UploadRecord, duplicate: boolean}>} 登録結果。
   */
  async receiveImage(file, suppliedIsbn) {
    if (!file || !Buffer.isBuffer(file.buffer)) throw httpError(400, "画像を選択してください。");
    const clientDetectedIsbn = suppliedIsbn ? normalizeIsbn(suppliedIsbn) : "";
    const preparedImage = await this.prepareImage(file.buffer);
    const storedFilename = await this.#saveImage(preparedImage.buffer, preparedImage.extension);
    const upload = await this.#saveUploadRecord({
      id: this.createId(),
      originalName: safeOriginalName(file.originalname),
      storedFilename,
      imageUrl: `/uploads/${storedFilename}`,
      status: "processing",
      message: "ISBNバーコードを解析しています。",
      createdAt: this.now(),
    });

    try {
      const isbn = clientDetectedIsbn || await this.barcodeScanner.scan(preparedImage.buffer);
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

  /**
   * @param {unknown} uploadId 手動補完するアップロードID。
   * @param {unknown} isbn ISBN-10またはISBN-13。
   * @returns {Promise<object>} ISBN登録結果。
   */
  async completeWithIsbn(uploadId, isbn) {
    const upload = await this.#findUpload(uploadId);
    return this.#completeUpload(upload, isbn);
  }

  /**
   * @param {unknown} uploadId 再解析するアップロードID。
   * @returns {Promise<object>} ISBN登録結果。
   */
  async retryBarcode(uploadId) {
    const upload = await this.#findUpload(uploadId);
    const image = await fsp.readFile(path.join(this.uploadDir, safeStoredFilename(upload.storedFilename)));
    const isbn = await this.barcodeScanner.scan(image);
    return this.#completeUpload(upload, isbn);
  }

  #isVisible(upload, recentSuccessCutoff) {
    if (upload.dismissedAt) return false;
    if (upload.status !== "success") return true;
    const completedAt = Date.parse(upload.completedAt || upload.createdAt || 0);
    return completedAt >= recentSuccessCutoff;
  }

  async #saveImage(buffer, extension) {
    const storedFilename = `${Date.now()}-${this.createId()}${extension}`;
    await fsp.writeFile(path.join(this.uploadDir, storedFilename), buffer);
    return storedFilename;
  }

  async #saveUploadRecord(record) {
    return this.repository.updateUploads((uploads) => {
      const existingIndex = uploads.findIndex((upload) => upload.id === record.id);
      if (existingIndex >= 0) uploads[existingIndex] = record;
      else uploads.unshift(record);
      uploads.splice(MAX_UPLOAD_HISTORY);
      return record;
    });
  }

  async #findUpload(id) {
    const uploadId = validateResourceId(id, "アップロードID");
    const uploads = await this.repository.readUploads();
    const upload = uploads.find((item) => item.id === uploadId);
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
