import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return structuredClone(value);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

async function writeJson(file, value) {
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 蔵書とアップロード履歴の保存場所を一か所へ閉じ込める。
 * ルート処理はファイル名を知らず、業務データの読み書きだけを依頼する。
 */
export function createLibraryStore({ dataDir, seedBooks }) {
  const paths = {
    dataDir,
    uploadDir: path.join(dataDir, "uploads"),
    coverDir: path.join(dataDir, "covers"),
    booksFile: path.join(dataDir, "books.json"),
    uploadsFile: path.join(dataDir, "uploads.json"),
  };

  return {
    paths,
    async initialize() {
      await fsp.mkdir(paths.uploadDir, { recursive: true });
      await fsp.mkdir(paths.coverDir, { recursive: true });
      if (!fs.existsSync(paths.booksFile)) await writeJson(paths.booksFile, seedBooks);
      if (!fs.existsSync(paths.uploadsFile)) await writeJson(paths.uploadsFile, []);
    },
    readBooks() {
      return readJson(paths.booksFile, seedBooks);
    },
    saveBooks(books) {
      return writeJson(paths.booksFile, books);
    },
    readUploads() {
      return readJson(paths.uploadsFile, []);
    },
    saveUploads(uploads) {
      return writeJson(paths.uploadsFile, uploads);
    },
  };
}
