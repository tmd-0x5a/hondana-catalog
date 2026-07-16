import { validateBulkImportInput } from "./request-validation.mjs";

function fallbackMetadataChanges(book, entry) {
  const changes = {};
  if (entry.title && (!book.title || book.title.startsWith("ISBN "))) changes.title = entry.title;
  if (entry.author && (!book.author || book.author === "著者情報なし")) changes.author = entry.author;
  if (entry.publisher && !book.publisher) changes.publisher = entry.publisher;
  return changes;
}

/** ISBN書誌取得と手動書誌作成を束ね、行単位で失敗を分離する一括取り込みユースケース。 */
export class BookBulkImportService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./book-service.mjs").BookService} dependencies.bookService 単冊の登録・更新処理。
   */
  constructor({ bookService }) {
    this.bookService = bookService;
  }

  /**
   * @param {unknown} input HTTP由来の一括取り込み入力。
   * @returns {Promise<{books: object[], processedCount: number, createdCount: number, duplicateCount: number, failedCount: number, failures: object[]}>} 行ごとの処理結果。
   */
  async importBooks(input) {
    const validated = validateBulkImportInput(input);
    const books = [];
    const failures = [];
    let createdCount = 0;
    let duplicateCount = 0;

    for (let index = 0; index < validated.entries.length; index += 1) {
      const entry = validated.entries[index];
      try {
        const result = entry.isbn
          ? await this.#importIsbnEntry(entry, validated)
          : { book: await this.#createManualEntry(entry, validated), duplicate: false };
        books.push(result.book);
        if (result.duplicate) duplicateCount += 1;
        else createdCount += 1;
      } catch (error) {
        failures.push({
          row: index + 1,
          title: entry.title,
          isbn: entry.isbn,
          message: Number(error?.status) >= 400 && Number(error?.status) < 500
            ? error.message
            : "書籍情報を取り込めませんでした。",
        });
      }
    }

    return {
      books,
      processedCount: books.length,
      createdCount,
      duplicateCount,
      failedCount: failures.length,
      failures,
    };
  }

  async #importIsbnEntry(entry, target) {
    const imported = await this.bookService.importIsbn(entry.isbn);
    const book = await this.bookService.updateBook(imported.book.id, {
      format: target.format,
      physicalLocation: target.physicalLocation,
      electronicPlatform: target.electronicPlatform,
      ...fallbackMetadataChanges(imported.book, entry),
    });
    return { book, duplicate: imported.duplicate };
  }

  #createManualEntry(entry, target) {
    return this.bookService.createBook({
      title: entry.title,
      author: entry.author,
      publisher: entry.publisher,
      format: target.format,
      physicalLocation: target.physicalLocation,
      electronicPlatform: target.electronicPlatform,
    });
  }
}
