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

const MAX_BACKUP_GENERATIONS = 7;
const BACKUP_FILE_PATTERN = /^books-\d{4}-\d{2}-\d{2}\.json$/;

/** 蔵書とアップロード履歴のファイル名、初期値、JSON変換を隠す永続化境界。 */
export class LibraryRepository {
  /**
   * @param {object} options 保存設定。
   * @param {string} options.dataDir 書込可能なデータディレクトリ。
   * @param {Partial<import("../src/types.js").Book>[]} options.seedBooks 初回作成時の蔵書。起動時にmigrateStoredBooksが現行形式へ補完する。
   * @param {() => Date} [options.now] 日次バックアップの基準日。テスト差し替え用。
   */
  constructor({ dataDir, seedBooks, now = () => new Date() }) {
    this.seedBooks = seedBooks;
    this.now = now;
    this.writeQueues = new Map();
    this.paths = {
      dataDir,
      uploadDir: path.join(dataDir, "uploads"),
      coverDir: path.join(dataDir, "covers"),
      backupDir: path.join(dataDir, "backups"),
      booksFile: path.join(dataDir, "books.json"),
      uploadsFile: path.join(dataDir, "uploads.json"),
      packFile: path.join(dataDir, "daily-pack.json"),
    };
  }

  /** @returns {Promise<void>} 必要なディレクトリと初期JSONを作成し、日次バックアップを更新する。 */
  async initialize() {
    await fsp.mkdir(this.paths.uploadDir, { recursive: true });
    await fsp.mkdir(this.paths.coverDir, { recursive: true });
    await fsp.mkdir(this.paths.backupDir, { recursive: true });
    if (!fs.existsSync(this.paths.booksFile)) await writeJsonAtomically(this.paths.booksFile, this.seedBooks);
    if (!fs.existsSync(this.paths.uploadsFile)) await writeJsonAtomically(this.paths.uploadsFile, []);
    await this.#createDailyBackup();
  }

  /**
   * 起動日ごとに一度だけbooks.jsonのスナップショットを残し、直近の世代だけを保持する。
   * 直前一世代の.bakが守れない、数日前からの誤操作・データ破損からの復旧手段になる。
   */
  async #createDailyBackup() {
    const date = this.now();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const backupFile = path.join(this.paths.backupDir, `books-${stamp}.json`);
    if (!fs.existsSync(backupFile)) {
      try {
        await fsp.copyFile(this.paths.booksFile, backupFile);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const backups = (await fsp.readdir(this.paths.backupDir))
      .filter((name) => BACKUP_FILE_PATTERN.test(name))
      .sort();
    for (const expired of backups.slice(0, -MAX_BACKUP_GENERATIONS)) {
      await fsp.rm(path.join(this.paths.backupDir, expired), { force: true });
    }
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

  /** @returns {Promise<{date: string, cards: object[], openedAt: string|null}|null>} 保存済みの日次パック。 */
  readPack() {
    return readJson(this.paths.packFile, null);
  }

  /** @param {{date: string, cards: object[], openedAt: string|null}} pack 日次パック。 @returns {Promise<void>} 原子的な保存完了。 */
  savePack(pack) {
    return this.#queueWrite("pack", () => writeJsonAtomically(this.paths.packFile, pack));
  }

  #queueWrite(key, writeOperation) {
    const previousWrite = this.writeQueues.get(key) || Promise.resolve();
    const nextWrite = previousWrite.catch(() => {}).then(writeOperation);
    this.writeQueues.set(key, nextWrite);
    return nextWrite;
  }
}
