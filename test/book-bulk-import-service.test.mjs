import assert from "node:assert/strict";
import test from "node:test";

import { BookBulkImportService } from "../server/book-bulk-import-service.mjs";

test("ISBNと手動書誌を同じ保存先へ一括登録する", async () => {
  const updated = [];
  const service = new BookBulkImportService({
    bookService: {
      async importIsbn(isbn) { return { book: { id: `isbn-${isbn}`, title: `ISBN ${isbn}`, author: "著者情報なし" }, duplicate: true }; },
      async updateBook(id, changes) { updated.push({ id, changes }); return { id, ...changes }; },
      async createBook(input) { return { id: "manual-1", ...input }; },
    },
  });

  const result = await service.importBooks({
    format: "electronic",
    electronicPlatform: "DMMブックス",
    entries: [
      { isbn: "9780306406157", title: "補完書名", author: "補完著者" },
      { title: "手動書名", author: "手動著者" },
    ],
  });

  assert.equal(result.processedCount, 2);
  assert.equal(result.createdCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(updated[0].changes, {
    format: "electronic",
    physicalLocation: "",
    electronicPlatform: "DMMブックス",
    title: "補完書名",
    author: "補完著者",
  });
});

test("一括登録は一行の失敗後も残りを処理する", async () => {
  let calls = 0;
  const service = new BookBulkImportService({
    bookService: {
      async createBook(input) {
        calls += 1;
        if (calls === 1) throw new Error("storage error");
        return { id: "ok", ...input };
      },
    },
  });

  const result = await service.importBooks({ format: "physical", physicalLocation: "書斎", entries: [{ title: "失敗" }, { title: "成功" }] });
  assert.equal(result.processedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.failures[0].message, "書籍情報を取り込めませんでした。");
});
