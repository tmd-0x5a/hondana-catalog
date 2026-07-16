import assert from "node:assert/strict";
import test from "node:test";

import { parseBulkImportText } from "../src/bulk-import-model.js";

test("ISBN一覧とタイトル・著者のタブ区切りを同じ入力から解析する", () => {
  const parsed = parseBulkImportText("978-0-306-40615-7\n書名\t著者名\n9784088820118\t別の書名\t別の著者");

  assert.deepEqual(parsed, {
    entries: [
      { isbn: "9780306406157", title: "", author: "" },
      { isbn: "", title: "書名", author: "著者名" },
      { isbn: "9784088820118", title: "別の書名", author: "別の著者" },
    ],
    errors: [],
  });
});

test("一括解析は処理件数を指定上限で止める", () => {
  const parsed = parseBulkImportText("本1\n本2\n本3", 2);
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.errors, ["一度に取り込めるのは2件までです。"]);
});
