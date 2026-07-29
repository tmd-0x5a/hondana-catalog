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

test("紹介文はopenBDの内容紹介を優先し、なければGoogle Booksを使う", async () => {
  function createService({ openBdTextContent, googleDescription }) {
    return new BookMetadataService({
      httpClient: {
        async getJson(url) {
          if (String(url).includes("openbd")) {
            return [{
              summary: { title: "書名", author: "著者" },
              onix: openBdTextContent ? { CollateralDetail: { TextContent: openBdTextContent } } : {},
            }];
          }
          return { items: [{ volumeInfo: { description: googleDescription } }] };
        },
      },
      coverService: { async ensureCachedCover() { return ""; } },
    });
  }

  // TextType 03（長い紹介）を02より優先する。
  const openBdFirst = await createService({
    openBdTextContent: [
      { TextType: "02", Text: "短い内容紹介" },
      { TextType: "03", Text: "<p>長い内容紹介</p>" },
    ],
    googleDescription: "Google Booksの説明",
  }).findByIsbn("9780306406157");
  assert.equal(openBdFirst.description, "長い内容紹介");
  assert.equal(openBdFirst.note, "長い内容紹介");

  // openBDに内容紹介がなければGoogle Booksへ落とす。
  const googleFallback = await createService({
    openBdTextContent: null,
    googleDescription: "Google Booksの説明",
  }).findByIsbn("9780306406157");
  assert.equal(googleFallback.description, "Google Booksの説明");

  // どちらにもなければdescriptionは空のまま、noteだけ定型文になる。
  const missing = await createService({ openBdTextContent: null, googleDescription: "" })
    .findByIsbn("9780306406157");
  assert.equal(missing.description, "");
  assert.match(missing.note, /自動登録/);
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

test("パック候補の紹介文と書影有無をopenBDへ一括照会する", async () => {
  const service = new BookMetadataService({
    httpClient: {
      async getJson() {
        return [
          {
            summary: { cover: "https://cover.openbd.jp/covered.jpg" },
            onix: { CollateralDetail: { TextContent: [{ TextType: "03", Text: "紹介あり" }] } },
          },
          { summary: { cover: "" } },
        ];
      },
    },
    coverService: { async ensureCachedCover() { return ""; } },
  });

  const details = await service.findPackCandidateDetails([
    "9780306406157",
    "9784088821207",
  ]);

  assert.deepEqual(details.get("9780306406157"), {
    description: "紹介あり",
    hasCover: true,
  });
  assert.deepEqual(details.get("9784088821207"), {
    description: "",
    hasCover: false,
  });
});
