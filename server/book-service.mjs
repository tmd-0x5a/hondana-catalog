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

function firstSortOrder(books) {
  return books.length ? Math.min(...books.map((book) => Number(book.sortOrder) || 0)) : 0;
}

/** 蔵書の作成・更新・削除とISBN書誌の取り込みを一つのユースケース境界にまとめる。 */
export class BookService {
  constructor({ repository, metadataService, coverService, now = () => new Date().toISOString(), createId = crypto.randomUUID }) {
    this.repository = repository;
    this.metadataService = metadataService;
    this.coverService = coverService;
    this.now = now;
    this.createId = createId;
  }

  async migrateStoredBooks() {
    const books = await this.repository.readBooks();
    const migratedBooks = books.map((book, index) => applyBookDefaults(book, index));
    const storageChanged = JSON.stringify(books) !== JSON.stringify(migratedBooks);
    if (storageChanged) await this.repository.saveBooks(migratedBooks);
  }

  listBooks() {
    return this.repository.readBooks();
  }

  async createBook(input) {
    const title = String(input.title || "").trim();
    if (!title) throw httpError(400, "タイトルを入力してください。");

    const books = await this.repository.readBooks();
    const book = createManualBookRecord(input, {
      id: this.createId(),
      sortOrder: firstSortOrder(books) - 1,
      timestamp: this.now(),
    });
    books.unshift(book);
    await this.repository.saveBooks(books);
    return book;
  }

  async updateBook(id, changes) {
    const books = await this.repository.readBooks();
    const bookIndex = books.findIndex((book) => String(book.id) === String(id));
    if (bookIndex < 0) throw httpError(404, "本が見つかりません。");

    books[bookIndex] = updateBookRecord(books[bookIndex], changes, {
      index: bookIndex,
      timestamp: this.now(),
    });
    await this.repository.saveBooks(books);
    return books[bookIndex];
  }

  async reorderBooks(ids) {
    const requestedIds = Array.isArray(ids) ? ids.map(String) : [];
    if (!requestedIds.length) throw httpError(400, "並び順が空です。");

    const books = await this.repository.readBooks();
    const reorderedBooks = reorderBookRecords(books, requestedIds, this.now());
    await this.repository.saveBooks(reorderedBooks);
    return reorderedBooks;
  }

  async deleteBook(id) {
    const books = await this.repository.readBooks();
    const remainingBooks = books.filter((book) => String(book.id) !== String(id));
    if (remainingBooks.length === books.length) throw httpError(404, "本が見つかりません。");
    await this.repository.saveBooks(remainingBooks);
  }

  async importIsbn(value, uploadRecord = null) {
    const isbn = normalizeIsbn(value);
    const metadata = await this.metadataService.findByIsbn(isbn);
    const books = await this.repository.readBooks();
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
    await this.repository.saveBooks(books);
    return { book, duplicate: existingIndex >= 0 };
  }

  async refreshCover(id) {
    const books = await this.repository.readBooks();
    const bookIndex = books.findIndex((book) => String(book.id) === String(id));
    if (bookIndex < 0) throw httpError(404, "本が見つかりません。");

    const isbn = normalizeIsbn(books[bookIndex].isbn);
    const preferredUrls = books[bookIndex].coverUrl?.startsWith("http") ? [books[bookIndex].coverUrl] : [];
    const coverUrl = await this.coverService.ensureCachedCover(isbn, preferredUrls);
    if (!coverUrl) throw httpError(404, "利用できる表紙画像が見つかりませんでした。");

    books[bookIndex].coverUrl = coverUrl;
    books[bookIndex].coverSource = "国立国会図書館・書影API等";
    books[bookIndex].updatedAt = this.now();
    await this.repository.saveBooks(books);
    return books[bookIndex];
  }

  /** 表紙の失敗は蔵書利用を妨げないため、各冊を独立して試して成功分だけ保存する。 */
  async backfillMissingCovers() {
    const books = await this.repository.readBooks();
    let storageChanged = false;
    for (const book of books) {
      if (book.coverUrl || !book.metadataSource) continue;
      try {
        const isbn = normalizeIsbn(book.isbn);
        const coverUrl = await this.coverService.ensureCachedCover(isbn);
        if (!coverUrl) continue;
        book.coverUrl = coverUrl;
        book.coverSource = "国立国会図書館・書影API等";
        book.updatedAt = this.now();
        storageChanged = true;
      } catch {
        // 一冊のISBNや画像が不正でも、残りの表紙補完は続行する。
      }
    }
    if (storageChanged) await this.repository.saveBooks(books);
  }
}
