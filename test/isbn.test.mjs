import assert from "node:assert/strict";
import test from "node:test";

import { normalizeIsbn, stripIsbn, validIsbn10, validIsbn13 } from "../server/isbn.mjs";

test("ISBNの区切り文字を除去する", () => {
  assert.equal(stripIsbn("978-4-08-745122-4"), "9784087451224");
  assert.equal(stripIsbn("0 8044 2957 x"), "080442957X");
});

test("ISBN-10とISBN-13のチェックサムを検証する", () => {
  assert.equal(validIsbn10("0306406152"), true);
  assert.equal(validIsbn10("0306406153"), false);
  assert.equal(validIsbn13("9780306406157"), true);
  assert.equal(validIsbn13("9780306406158"), false);
});

test("ISBN-10をISBN-13へ変換する", () => {
  assert.equal(normalizeIsbn("0-306-40615-2"), "9780306406157");
});

test("不正なISBNはAPI向けの400エラーとして拒否する", () => {
  assert.throws(
    () => normalizeIsbn("9780306406158"),
    (error) => error.status === 400 && /ISBN-10またはISBN-13/.test(error.message),
  );
});
