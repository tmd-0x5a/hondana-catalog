import assert from "node:assert/strict";
import test from "node:test";

import { BookMetadataService } from "../server/book-metadata-service.mjs";

test("openBDのONIX照合キーをタイトル・著者の読みに取り込む", async () => {
  const service = new BookMetadataService({
    httpClient: {
      async getJson(url) {
        if (String(url).includes("openbd")) {
          return [{
            summary: { title: "葬送のフリーレン", author: "山田太郎", publisher: "出版社" },
            onix: {
              DescriptiveDetail: {
                TitleDetail: { TitleElement: { TitleText: { collationkey: "ソウソウノフリーレン" } } },
                Contributor: [{ PersonName: { collationkey: "ヤマダタロウ" } }],
              },
            },
          }];
        }
        return { items: [] };
      },
    },
    coverService: { async ensureCachedCover() { return ""; } },
  });

  const metadata = await service.findByIsbn("9780306406157");

  assert.equal(metadata.titleReading, "ソウソウノフリーレン");
  assert.equal(metadata.authorReading, "ヤマダタロウ");
});

test("openBDとGoogle Booksの表紙候補を両方キャッシュサービスへ渡す", async () => {
  let receivedUrls = [];
  const service = new BookMetadataService({
    httpClient: {
      async getJson(url) {
        if (String(url).includes("openbd")) {
          return [{ summary: { title: "書名", cover: "https://cover.openbd.jp/example.jpg" } }];
        }
        return { items: [{ volumeInfo: { imageLinks: { thumbnail: "https://books.google.com/example.jpg" } } }] };
      },
    },
    coverService: {
      async ensureCachedCover(_isbn, urls) {
        receivedUrls = urls;
        return "/covers/9780306406157.webp";
      },
    },
  });

  const metadata = await service.findByIsbn("9780306406157");

  assert.deepEqual(receivedUrls, [
    "https://cover.openbd.jp/example.jpg",
    "https://books.google.com/example.jpg",
  ]);
  assert.equal(metadata.coverUrl, "/covers/9780306406157.webp");
});
