import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return structuredClone(value);
}

async function parseJsonFile(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function readJson(file, fallback) {
  try {
    return await parseJsonFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return clone(fallback);
    if (error instanceof SyntaxError) {
      try {
        return await parseJsonFile(`${file}.bak`);
      } catch {
        // 修復対象を示せるよう、バックアップ側ではなく主ファイルの解析エラーを返す。
      }
    }
    throw error;
  }
}

async function backupValidJson(file) {
  try {
    await parseJsonFile(file);
    await fsp.copyFile(file, `${file}.bak`);
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return;
    throw error;
  }
}

/** 完成済み一時ファイルだけを置換し、置換前の正常なJSONをバックアップへ残す。 */
async function writeJsonAtomically(file, value) {
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await backupValidJson(file);
    try {
      await fsp.rename(temporaryFile, file);
    } catch (error) {
      const windowsReplaceFailure = error.code === "EEXIST" || error.code === "EPERM";
      if (!windowsReplaceFailure) throw error;
      await fsp.rm(file, { force: true });
      await fsp.rename(temporaryFile, file);
    }
  } finally {
    await fsp.rm(temporaryFile, { force: true });
  }
}

/** 蔵書とアップロード履歴のファイル名、初期値、JSON変換を隠す永続化境界。 */
export class LibraryRepository {
  /**
   * @param {object} options 保存設定。
   * @param {string} options.dataDir 書込可能なデータディレクトリ。
   * @param {import("../src/types.js").Book[]} options.seedBooks 初回作成時の蔵書。
   */
  constructor({ dataDir, seedBooks }) {
    this.seedBooks = seedBooks;
    this.writeQueues = new Map();
    this.paths = {
      dataDir,
      uploadDir: path.join(dataDir, "uploads"),
      coverDir: path.join(dataDir, "covers"),
      booksFile: path.join(dataDir, "books.json"),
      uploadsFile: path.join(dataDir, "uploads.json"),
    };
  }

  /** @returns {Promise<void>} 必要なディレクトリと初期JSONを作成する。 */
  async initialize() {
    await fsp.mkdir(this.paths.uploadDir, { recursive: true });
    await fsp.mkdir(this.paths.coverDir, { recursive: true });
    if (!fs.existsSync(this.paths.booksFile)) await writeJsonAtomically(this.paths.booksFile, this.seedBooks);
    if (!fs.existsSync(this.paths.uploadsFile)) await writeJsonAtomically(this.paths.uploadsFile, []);
  }

  /** @returns {Promise<import("../src/types.js").Book[]>} 蔵書スナップショット。破損時は正常な.bakを読む。 */
  readBooks() {
    return readJson(this.paths.booksFile, this.seedBooks);
  }

  /** @param {import("../src/types.js").Book[]} books 全蔵書。 @returns {Promise<void>} 原子的な保存完了。 */
  saveBooks(books) {
    return this.#queueWrite("books", () => writeJsonAtomically(this.paths.booksFile, books));
  }

  /**
   * 蔵書の読込・変更・保存を一つの直列化区間で実行し、同時更新の取りこぼしを防ぐ。
   * mutatorは受け取った配列を変更でき、その戻り値が呼出元へ返る。
   *
   * @template T
   * @param {(books: import("../src/types.js").Book[]) => T|Promise<T>} mutator 最新蔵書へ適用する処理。
   * @returns {Promise<T>} mutatorの戻り値。
   */
  updateBooks(mutator) {
    return this.#queueWrite("books", async () => {
      const books = await readJson(this.paths.booksFile, this.seedBooks);
      const result = await mutator(books);
      await writeJsonAtomically(this.paths.booksFile, books);
      return result;
    });
  }

  /** @returns {Promise<import("../src/types.js").UploadRecord[]>} アップロード履歴。 */
  readUploads() {
    return readJson(this.paths.uploadsFile, []);
  }

  /** @param {import("../src/types.js").UploadRecord[]} uploads 全履歴。 @returns {Promise<void>} 原子的な保存完了。 */
  saveUploads(uploads) {
    return this.#queueWrite("uploads", () => writeJsonAtomically(this.paths.uploadsFile, uploads));
  }

  /**
   * アップロード履歴の読込・変更・保存を一つの直列化区間で実行する。
   *
   * @template T
   * @param {(uploads: import("../src/types.js").UploadRecord[]) => T|Promise<T>} mutator 最新履歴へ適用する処理。
   * @returns {Promise<T>} mutatorの戻り値。
   */
  updateUploads(mutator) {
    return this.#queueWrite("uploads", async () => {
      const uploads = await readJson(this.paths.uploadsFile, []);
      const result = await mutator(uploads);
      await writeJsonAtomically(this.paths.uploadsFile, uploads);
      return result;
    });
  }

  #queueWrite(key, writeOperation) {
    const previousWrite = this.writeQueues.get(key) || Promise.resolve();
    const nextWrite = previousWrite.catch(() => {}).then(writeOperation);
    this.writeQueues.set(key, nextWrite);
    return nextWrite;
  }
}
