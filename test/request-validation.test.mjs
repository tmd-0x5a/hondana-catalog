import assert from "node:assert/strict";
import test from "node:test";

import {
  validateBookCreateInput,
  validateBookUpdateInput,
  validateBulkImportInput,
  validateReorderIds,
  validateSearchText,
  validateUploadLimit,
} from "../server/request-validation.mjs";

test("蔵書入力は許可項目を正規化し、未知項目と危険なURLを拒否する", () => {
  const created = validateBookCreateInput({
    title: "  テスト本  ",
    isbn: "978-0-306-40615-7",
    category: "技術",
    rating: 4,
    tags: [" API "],
    electronicUrl: "https://example.com/books/1",
  });
  assert.equal(created.title, "テスト本");
  assert.equal(created.isbn, "9780306406157");
  assert.deepEqual(created.tags, ["API"]);

  assert.throws(() => validateBookCreateInput({ title: "本", admin: true }), { status: 400 });
  assert.throws(() => validateBookCreateInput({ title: "本", electronicUrl: "file:///C:/Windows/system.ini" }), { status: 400 });
  assert.throws(() => validateBookUpdateInput({ isbn: "9780306406157" }), { status: 400 });
});

test("一括取り込みは所有形態と各行を検証する", () => {
  const input = validateBulkImportInput({
    format: "electronic",
    electronicPlatform: "DMMブックス",
    entries: [{ isbn: "978-0-306-40615-7", title: "補助書名" }, { title: "手動書名", author: "著者" }],
  });
  assert.equal(input.entries[0].isbn, "9780306406157");
  assert.equal(input.physicalLocation, "");
  assert.throws(() => validateBulkImportInput({ format: "electronic", entries: [{ title: "本" }] }), { status: 400 });
  assert.throws(() => validateBulkImportInput({ format: "physical", entries: Array.from({ length: 201 }, () => ({ title: "本" })) }), { status: 400 });
});

test("配列・検索語・取得件数に処理量上限を適用する", () => {
  assert.deepEqual(validateReorderIds([1, "book-2"]), ["1", "book-2"]);
  assert.throws(() => validateReorderIds(["same", "same"]), { status: 400 });
  assert.equal(validateSearchText("  葬送のフリーレン ", { maxLength: 20 }), "葬送のフリーレン");
  assert.throws(() => validateSearchText("x".repeat(201), { maxLength: 200 }), { status: 400 });
  assert.equal(validateUploadLimit(undefined), 10);
  assert.equal(validateUploadLimit("100"), 100);
  assert.throws(() => validateUploadLimit("101"), { status: 400 });
});
