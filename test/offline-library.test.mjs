import assert from "node:assert/strict";
import test from "node:test";

import { buildOfflineLibraryHtml } from "../server/offline-library.mjs";

test("持ち出しHTMLへ埋め込む蔵書文字列をscript終端から保護する", () => {
  const html = buildOfflineLibraryHtml({
    books: [{ title: "</script><script>alert(1)</script>", author: "A\u2028B" }],
    syncedAt: "2026-07-15T00:00:00.000Z",
  });

  assert.match(html, /\\u003c\/script>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});
