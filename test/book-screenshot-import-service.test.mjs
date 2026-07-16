import assert from "node:assert/strict";
import test from "node:test";

import { BookScreenshotImportService, normalizeOcrLine } from "../server/book-screenshot-import-service.mjs";

test("Windows OCRが日本語の字間へ入れた空白を検索語から除く", () => {
  assert.equal(normalizeOcrLine("葬 送 の フ リ - レ ン 1"), "葬送のフリ-レン1");
  assert.equal(normalizeOcrLine("SPY x FAMILY 3"), "SPY x FAMILY 3");
});

test("OCR行をNDL候補と表紙プレビューへ変換し、UI文字は検索しない", async () => {
  const queries = [];
  const service = new BookScreenshotImportService({
    ocrService: {
      async recognize() {
        return [{ filename: "kindle.png", lines: ["電 子 書 籍", "葬 送 の フ リ - レ ン 1", "9780306406157", "¥ 770"] }];
      },
    },
    catalogService: {
      async suggestBooks(query) {
        queries.push(query);
        return [{ title: "葬送のフリーレン 1", author: "山田鐘人", publisher: "小学館", isbn: "9784098602780" }];
      },
    },
    pause: async () => {},
  });

  const result = await service.scanScreenshots([{ originalname: "kindle.png", buffer: Buffer.from("image") }]);

  assert.deepEqual(queries, ["葬送のフリ-レン1"]);
  assert.equal(result.documents, 1);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].suggestions[0].isbn, "9780306406157");
  assert.equal(result.candidates[1].suggestions[0].coverUrl, "/api/covers/preview/9784098602780");
});

test("OCRで長音をハイフンと誤認したタイトルは片仮名部分でも再検索する", async () => {
  const queries = [];
  const service = new BookScreenshotImportService({
    ocrService: { async recognize() { return [{ filename: "store.png", lines: ["き の フ リ - レ ン 1"] }]; } },
    catalogService: {
      async suggestBooks(query) {
        queries.push(query);
        return query === "フリーレン" ? [{ title: "葬送のフリーレン 1", isbn: "9784098602780" }] : [];
      },
    },
    pause: async () => {},
  });

  const result = await service.scanScreenshots([{ originalname: "store.png", buffer: Buffer.from("image") }]);
  assert.deepEqual(queries, ["きのフリ-レン1", "フリーレン"]);
  assert.equal(result.candidates[0].suggestions[0].title, "葬送のフリーレン 1");
});

test("書誌APIエラー後は後続検索を止めて混雑を悪化させない", async () => {
  let calls = 0;
  const service = new BookScreenshotImportService({
    ocrService: { async recognize() { return [{ filename: "store.png", lines: ["作品タイトル一", "作品タイトル二", "作品タイトル三"] }]; } },
    catalogService: {
      async suggestBooks() {
        calls += 1;
        throw new Error("書籍候補検索 HTTP 429");
      },
    },
    pause: async () => {},
  });

  const result = await service.scanScreenshots([{ originalname: "store.png", buffer: Buffer.from("image") }]);
  assert.equal(calls, 1);
  assert.match(result.warning, /混み合って/);
});
