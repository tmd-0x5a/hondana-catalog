import crypto from "node:crypto";

import { applyBookDefaults } from "./book-model.mjs";
import {
  createManualBookRecord,
  mergeImportedBookRecord,
  reorderBookRecords,
  updateBookRecord,
} from "./book-record.mjs";
import { httpError } from "./http-error.mjs";
import { normalizeIsbn, stripIsbn } from "./isbn.mjs";
import {
  validateBookCreateInput,
  validateBookUpdateInput,
  validateReorderIds,
  validateResourceId,
} from "./request-validation.mjs";

function firstSortOrder(books) {
  return books.length ? Math.min(...books.map((book) => Number(book.sortOrder) || 0)) : 0;
}

/** 補完failed本を再試行するまでの間隔。起動ごとの外部API呼び出しを抑える。 */
const METADATA_RETRY_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
/** 一度の起動で補完を試みる最大冊数。 */
const MAX_BACKFILL_BOOKS_PER_RUN = 15;

/**
 * ローカル表紙または書名・著者の読みが不足するISBN蔵書だけを補完対象にする。
 * 直近に確認済みの本は、外部APIに情報がない可能性が高いため再試行間隔まで除外する。
 */
function needsMetadataBackfill(book, nowMs) {
  if (!book.isbn) return false;
  const hasLocalCover = book.coverUrl?.startsWith("/covers/");
  if (hasLocalCover && book.titleReading && book.authorReading) return false;
  const lastCheckedMs = Date.parse(book.metadataCheckedAt || "");
  return !Number.isFinite(lastCheckedMs) || nowMs - lastCheckedMs >= METADATA_RETRY_INTERVAL_MS;
}

/** 既存の利用者入力を上書きせず、外部書誌から埋められる不足項目だけを返す。 */
function createMetadataBackfill(book, metadata, coverUrl) {
  const changes = {};
  if (!book.coverUrl?.startsWith("/covers/") && coverUrl) changes.coverUrl = coverUrl;
  if (!book.titleReading && metadata.titleReading) changes.titleReading = metadata.titleReading;
  if (!book.authorReading && metadata.authorReading) changes.authorReading = metadata.authorReading;
  return changes;
}

/** 蔵書の作成・更新・削除とISBN書誌の取り込みを一つのユースケース境界にまとめる。 */
export class BookService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./library-repository.mjs").LibraryRepository} dependencies.repository 保存境界。
   * @param {import("./book-metadata-service.mjs").BookMetadataService} dependencies.metadataService 書誌取得サービス。
   * @param {import("./cover-service.mjs").CoverService} dependencies.coverService 表紙取得サービス。
   * @param {() => string} [dependencies.now] ISO日時を返す関数。
   * @param {() => string} [dependencies.createId] 一意IDを返す関数。
   */
  constructor({ repository, metadataService, coverService, now = () => new Date().toISOString(), createId = crypto.randomUUID }) {
    this.repository = repository;
    this.metadataService = metadataService;
    this.coverService = coverService;
    this.now = now;
    this.createId = createId;
  }

  /** @returns {Promise<void>} 保存済み蔵書を現行スキーマへ移行する。 */
  async migrateStoredBooks() {
    const books = await this.repository.readBooks();
    const migratedBooks = books.map((book, index) => applyBookDefaults(book, index));
    const storageChanged = JSON.stringify(books) !== JSON.stringify(migratedBooks);
    if (storageChanged) await this.repository.saveBooks(migratedBooks);
  }

  /** @returns {Promise<import("../src/types.js").Book[]>} 全蔵書のスナップショット。 */
  listBooks() {
    return this.repository.readBooks();
  }

  /**
   * @param {unknown} input HTTP由来の新規登録入力。
   * @returns {Promise<import("../src/types.js").Book>} 作成した蔵書。
   */
  async createBook(input) {
    const validatedInput = validateBookCreateInput(input);
    return this.repository.updateBooks((books) => {
      const book = createManualBookRecord(validatedInput, {
        id: this.createId(),
        sortOrder: firstSortOrder(books) - 1,
        timestamp: this.now(),
      });
      books.unshift(book);
      return book;
    });
  }

  /**
   * @param {unknown} id 蔵書ID。
   * @param {unknown} changes HTTP由来の更新差分。
   * @returns {Promise<import("../src/types.js").Book>} 更新後の蔵書。
   */
  async updateBook(id, changes) {
    const bookId = validateResourceId(id, "蔵書ID");
    const validatedChanges = validateBookUpdateInput(changes);
    return this.repository.updateBooks((books) => {
      const bookIndex = books.findIndex((book) => String(book.id) === bookId);
      if (bookIndex < 0) throw httpError(404, "本が見つかりません。");
      books[bookIndex] = updateBookRecord(books[bookIndex], validatedChanges, {
        index: bookIndex,
        timestamp: this.now(),
      });
      return books[bookIndex];
    });
  }

  /**
   * @param {unknown} ids 希望順に並べた蔵書ID配列。
   * @returns {Promise<import("../src/types.js").Book[]>} 保存後の全蔵書。
   */
  async reorderBooks(ids) {
    const requestedIds = validateReorderIds(ids);
    return this.repository.updateBooks((books) => {
      const reorderedBooks = reorderBookRecords(books, requestedIds, this.now());
      books.splice(0, books.length, ...reorderedBooks);
      return reorderedBooks;
    });
  }

  /**
   * @param {unknown} id 削除する蔵書ID。
   * @returns {Promise<void>}
   */
  async deleteBook(id) {
    const bookId = validateResourceId(id, "蔵書ID");
    await this.repository.updateBooks((books) => {
      const bookIndex = books.findIndex((book) => String(book.id) === bookId);
      if (bookIndex < 0) throw httpError(404, "本が見つかりません。");
      books.splice(bookIndex, 1);
    });
  }

  /**
   * ISBNから書誌を取得し、同一ISBNがあれば利用者項目を保ったまま更新する。
   *
   * @param {unknown} value ISBN-10またはISBN-13。
   * @param {import("../src/types.js").UploadRecord|null} [uploadRecord=null] 元画像の記録。
   * @returns {Promise<{book: import("../src/types.js").Book, duplicate: boolean}>} 登録結果。
   */
  async importIsbn(value, uploadRecord = null) {
    const isbn = normalizeIsbn(value);
    const metadata = await this.metadataService.findByIsbn(isbn);
    return this.repository.updateBooks((books) => {
      const existingIndex = books.findIndex((book) => stripIsbn(book.isbn) === isbn);
      const existingBook = existingIndex >= 0 ? books[existingIndex] : null;
      const book = mergeImportedBookRecord({
        existingBook,
        metadata,
        isbn,
        id: existingBook?.id || this.createId(),
        sortOrder: existingBook?.sortOrder ?? firstSortOrder(books) - 1,
        uploadRecord,
        timestamp: this.now(),
      });

      if (existingIndex >= 0) books.splice(existingIndex, 1);
      books.unshift(book);
      return { book, duplicate: existingIndex >= 0 };
    });
  }

  /**
   * @param {unknown} id 表紙を再取得する蔵書ID。
   * @returns {Promise<import("../src/types.js").Book>} 更新後の蔵書。
   */
  async refreshCover(id) {
    const bookId = validateResourceId(id, "蔵書ID");
    const books = await this.repository.readBooks();
    const bookIndex = books.findIndex((book) => String(book.id) === bookId);
    if (bookIndex < 0) throw httpError(404, "本が見つかりません。");

    const isbn = normalizeIsbn(books[bookIndex].isbn);
    const metadata = await this.metadataService.findByIsbn(isbn);
    const preferredUrls = books[bookIndex].coverUrl?.startsWith("http") ? [books[bookIndex].coverUrl] : [];
    const coverUrl = metadata.coverUrl || await this.coverService.ensureCachedCover(isbn, preferredUrls);
    if (!coverUrl) throw httpError(404, "利用できる表紙画像が見つかりませんでした。");
    return this.repository.updateBooks((latestBooks) => {
      const latestIndex = latestBooks.findIndex((book) => String(book.id) === bookId);
      if (latestIndex < 0) throw httpError(404, "本が見つかりません。");
      latestBooks[latestIndex].coverUrl = coverUrl;
      latestBooks[latestIndex].coverSource = "openBD・Google Books・Open Library等";
      latestBooks[latestIndex].updatedAt = this.now();
      return latestBooks[latestIndex];
    });
  }

  /**
   * ISBN登録済み蔵書のローカル表紙と読みを補完する。各冊の失敗は分離する。
   * 漢字から読みを推測せず、外部書誌が返した読みだけを保存する。
   * 試行した本には成否にかかわらず確認日時を記録し、次回以降の外部API呼び出しを再試行間隔まで抑える。
   *
   * @param {object} [options] 実行条件。
   * @param {number} [options.maxBooks] 今回の実行で試みる最大冊数。一括取り込み直後は取り込み件数まで広げる。
   * @returns {Promise<void>}
   */
  async backfillMetadataGaps({ maxBooks = MAX_BACKFILL_BOOKS_PER_RUN } = {}) {
    const books = await this.repository.readBooks();
    const nowMs = Date.parse(this.now());
    const targets = books
      .filter((book) => needsMetadataBackfill(book, nowMs))
      .slice(0, maxBooks);
    if (!targets.length) return;

    const updates = new Map();
    for (const book of targets) {
      const changes = { metadataCheckedAt: this.now() };
      try {
        const isbn = normalizeIsbn(book.isbn);
        const metadata = await this.metadataService.findByIsbn(isbn);
        let coverUrl = metadata.coverUrl || "";
        if (!book.coverUrl?.startsWith("/covers/") && !coverUrl) {
          const preferredUrls = book.coverUrl?.startsWith("http") ? [book.coverUrl] : [];
          coverUrl = await this.coverService.ensureCachedCover(isbn, preferredUrls);
        }
        Object.assign(changes, createMetadataBackfill(book, metadata, coverUrl));
      } catch {
        // 不正ISBNや外部エラーでも確認日時だけは記録し、残りの書誌補完を続行する。
      }
      updates.set(String(book.id), changes);
    }

    await this.repository.updateBooks((latestBooks) => {
      for (const book of latestBooks) {
        const changes = updates.get(String(book.id));
        if (!changes) continue;
        book.metadataCheckedAt = changes.metadataCheckedAt;
        let bookChanged = false;
        if (changes.coverUrl && !book.coverUrl?.startsWith("/covers/")) {
          book.coverUrl = changes.coverUrl;
          book.coverSource = "openBD・Google Books・Open Library等";
          bookChanged = true;
        }
        if (changes.titleReading && !book.titleReading) {
          book.titleReading = changes.titleReading;
          bookChanged = true;
        }
        if (changes.authorReading && !book.authorReading) {
          book.authorReading = changes.authorReading;
          bookChanged = true;
        }
        if (bookChanged) book.updatedAt = this.now();
      }
    });
  }
}
