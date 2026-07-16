import { applyBookDefaults } from "./book-model.mjs";
import { stripIsbn } from "./isbn.mjs";

const EDITABLE_BOOK_FIELDS = [
  "title",
  "titleReading",
  "author",
  "authorReading",
  "publisher",
  "published",
  "pages",
  "status",
  "rating",
  "shelf",
  "tags",
  "note",
  "category",
  "bookType",
  "format",
  "physicalLocation",
  "electronicPlatform",
  "electronicUrl",
  "seriesName",
  "volumeNumber",
  "reminderDate",
  "reminderNote",
];

/**
 * 検証済み入力から、保存に必要な既定値を含む手動登録レコードを作る。
 *
 * @param {Record<string, unknown>} input validateBookCreateInputの戻り値。
 * @param {{id: string, sortOrder: number, timestamp: string}} context サーバー生成値。
 * @returns {import("../src/types.js").Book} 新しい蔵書レコード。
 */
export function createManualBookRecord(input, { id, sortOrder, timestamp }) {
  return applyBookDefaults({
    id,
    title: String(input.title).trim(),
    titleReading: String(input.titleReading || ""),
    author: String(input.author || "著者情報なし"),
    authorReading: String(input.authorReading || ""),
    isbn: stripIsbn(input.isbn || ""),
    publisher: String(input.publisher || ""),
    published: String(input.published || ""),
    pages: String(input.pages || ""),
    shelf: String(input.shelf || "未整理"),
    tags: Array.isArray(input.tags) ? input.tags : ["手動登録"],
    status: input.status === "読了" ? "読了" : "未読",
    rating: Number(input.rating) || 0,
    note: String(input.note || ""),
    category: String(input.category || "その他"),
    bookType: input.bookType,
    format: input.format,
    physicalLocation: String(input.physicalLocation || ""),
    electronicPlatform: String(input.electronicPlatform || ""),
    electronicUrl: String(input.electronicUrl || ""),
    seriesName: String(input.seriesName || ""),
    volumeNumber: Number(input.volumeNumber) || null,
    reminderDate: String(input.reminderDate || ""),
    reminderNote: String(input.reminderNote || ""),
    coverUrl: "",
    metadataSource: "手動登録",
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
    sprite: null,
  });
}

/**
 * 既存蔵書へ検証済み編集項目だけを適用する。
 *
 * @param {import("../src/types.js").Book} book 更新元。
 * @param {Record<string, unknown>} changes validateBookUpdateInputの戻り値。
 * @param {{index: number, timestamp: string}} context 互換既定値と更新日時。
 * @returns {import("../src/types.js").Book} 更新後の新しいオブジェクト。
 */
export function updateBookRecord(book, changes, { index, timestamp }) {
  const updatedBook = { ...book };
  for (const field of EDITABLE_BOOK_FIELDS) {
    if (changes[field] !== undefined) updatedBook[field] = changes[field];
  }
  if (changes.category !== undefined) {
    updatedBook.bookType = changes.category === "マンガ" ? "manga" : "book";
  }
  updatedBook.updatedAt = timestamp;
  return applyBookDefaults(updatedBook, index);
}

/**
 * 再取得する書誌より、利用者が設定した所蔵・分類・読書状態を優先して統合する。
 *
 * @param {object} values 統合材料。
 * @param {import("../src/types.js").Book|null} values.existingBook 同一ISBNの既存蔵書。
 * @param {import("../src/types.js").BookMetadata} values.metadata 外部書誌。
 * @param {string} values.isbn 正規化済みISBN-13。
 * @param {string} values.id 保存ID。
 * @param {number} values.sortOrder 手動並び順。
 * @param {import("../src/types.js").UploadRecord|null} values.uploadRecord 元画像記録。
 * @param {string} values.timestamp 更新日時。
 * @returns {import("../src/types.js").Book} 統合済み蔵書。
 */
export function mergeImportedBookRecord({
  existingBook,
  metadata,
  isbn,
  id,
  sortOrder,
  uploadRecord,
  timestamp,
}) {
  return applyBookDefaults({
    ...(existingBook || {}),
    id,
    ...metadata,
    isbn,
    titleReading: existingBook?.titleReading || metadata.titleReading || "",
    authorReading: existingBook?.authorReading || metadata.authorReading || "",
    shelf: existingBook?.shelf || "新着 / 未整理",
    tags: metadata.tags?.length ? metadata.tags : existingBook?.tags || ["自動登録"],
    status: existingBook?.status || "未読",
    rating: existingBook?.rating || 0,
    category: existingBook?.category || metadata.category || "その他",
    bookType: existingBook?.bookType || metadata.bookType || "book",
    format: existingBook?.format || "physical",
    physicalLocation: existingBook?.physicalLocation || "未設定",
    electronicPlatform: existingBook?.electronicPlatform || "",
    seriesName: existingBook?.seriesName || metadata.seriesName || "",
    volumeNumber: existingBook?.volumeNumber || metadata.volumeNumber || null,
    sortOrder,
    uploadedImageUrl: uploadRecord ? `/uploads/${uploadRecord.storedFilename}` : existingBook?.uploadedImageUrl || "",
    createdAt: existingBook?.createdAt || timestamp,
    updatedAt: timestamp,
    sprite: null,
  });
}

/**
 * 指定IDを先頭から並べ、指定されなかった蔵書を元順序で後続させる。
 *
 * @param {import("../src/types.js").Book[]} books 全蔵書。
 * @param {string[]} requestedIds 希望順ID。
 * @param {string} timestamp 更新日時。
 * @returns {import("../src/types.js").Book[]} 入力配列を変更しない並び替え結果。
 */
export function reorderBookRecords(books, requestedIds, timestamp) {
  const requestedOrder = new Map(requestedIds.map((id, index) => [String(id), index]));
  const trailingStart = books.length;
  return books
    .map((book, index) => ({
      ...book,
      sortOrder: requestedOrder.has(String(book.id))
        ? requestedOrder.get(String(book.id))
        : trailingStart + index,
      updatedAt: timestamp,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}
