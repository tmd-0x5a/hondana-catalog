import { applyBookDefaults } from "./book-model.mjs";
import { stripIsbn } from "./isbn.mjs";

const EDITABLE_BOOK_FIELDS = [
  "title",
  "author",
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

export function createManualBookRecord(input, { id, sortOrder, timestamp }) {
  return applyBookDefaults({
    id,
    title: String(input.title).trim(),
    author: String(input.author || "著者情報なし"),
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

/** 再取得する書誌より、ユーザーが設定した所蔵・分類・読書状態を優先して統合する。 */
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
