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

  async initialize() {
    await fsp.mkdir(this.paths.uploadDir, { recursive: true });
    await fsp.mkdir(this.paths.coverDir, { recursive: true });
    if (!fs.existsSync(this.paths.booksFile)) await writeJsonAtomically(this.paths.booksFile, this.seedBooks);
    if (!fs.existsSync(this.paths.uploadsFile)) await writeJsonAtomically(this.paths.uploadsFile, []);
  }

  readBooks() {
    return readJson(this.paths.booksFile, this.seedBooks);
  }

  saveBooks(books) {
    return this.#queueWrite("books", () => writeJsonAtomically(this.paths.booksFile, books));
  }

  readUploads() {
    return readJson(this.paths.uploadsFile, []);
  }

  saveUploads(uploads) {
    return this.#queueWrite("uploads", () => writeJsonAtomically(this.paths.uploadsFile, uploads));
  }

  #queueWrite(key, writeOperation) {
    const previousWrite = this.writeQueues.get(key) || Promise.resolve();
    const nextWrite = previousWrite.catch(() => {}).then(writeOperation);
    this.writeQueues.set(key, nextWrite);
    return nextWrite;
  }
}
