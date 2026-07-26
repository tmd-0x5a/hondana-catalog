import assert from "node:assert/strict";
import test from "node:test";

import { BookService } from "../server/book-service.mjs";

class MemoryRepository {
  constructor(books = []) {
    this.books = structuredClone(books);
  }

  async readBooks() {
    return structuredClone(this.books);
  }

  async saveBooks(books) {
    this.books = structuredClone(books);
  }

  async updateBooks(mutator) {
    const books = structuredClone(this.books);
    const result = await mutator(books);
    this.books = books;
    return result;
  }
}

const metadata = {
  title: "更新された書名",
  titleReading: "こうしんされたしょめい",
  author: "書誌著者",
  publisher: "出版社",
  published: "2026-01-01",
  category: "その他",
  bookType: "book",
  seriesName: "",
  volumeNumber: null,
  tags: ["書誌タグ"],
  note: "書誌メモ",
  metadataSource: "テスト",
};

test("ISBN再登録では書誌を更新して所蔵情報を保持する", async () => {
  const repository = new MemoryRepository([{
    id: "owned",
    title: "古い書名",
    titleReading: "りようしゃがなおしたよみ",
    isbn: "9780306406157",
    category: "小説",
    format: "electronic",
    electronicPlatform: "DMMブックス",
    status: "読了",
    shelf: "お気に入り",
    sortOrder: 4,
    createdAt: "2025-01-01T00:00:00.000Z",
  }]);
  const service = new BookService({
    repository,
    metadataService: { findByIsbn: async () => metadata },
    coverService: { ensureCachedCover: async () => "" },
    now: () => "2026-07-15T00:00:00.000Z",
    createId: () => "new-id",
  });

  const result = await service.importIsbn("978-0-306-40615-7");

  assert.equal(result.duplicate, true);
  assert.equal(result.book.title, "更新された書名");
  assert.equal(result.book.titleReading, "りようしゃがなおしたよみ");
  assert.equal(result.book.status, "読了");
  assert.equal(result.book.format, "electronic");
  assert.equal(result.book.electronicPlatform, "DMMブックス");
  assert.equal(result.book.category, "小説");
  assert.equal(repository.books.length, 1);
});

test("手動登録ではタイトル必須と先頭の手動並び順を適用する", async () => {
  const repository = new MemoryRepository([{ id: "existing", sortOrder: 3 }]);
  const service = new BookService({
    repository,
    metadataService: {},
    coverService: {},
    now: () => "2026-07-15T00:00:00.000Z",
    createId: () => "created",
  });

  const book = await service.createBook({ title: "手動の本", category: "技術" });
  assert.equal(book.id, "created");
  assert.equal(book.sortOrder, 2);
  assert.equal(repository.books[0].id, "created");

  await assert.rejects(() => service.createBook({ title: " " }), { status: 400 });
});

test("書誌補完では既存値を守りながら不足した読みと表紙だけを保存する", async () => {
  const repository = new MemoryRepository([{
    id: "missing-metadata",
    isbn: "9780306406157",
    metadataSource: "openBD",
    coverUrl: "https://example.com/remote.jpg",
    titleReading: "",
    authorReading: "利用者入力の著者よみ",
  }]);
  const service = new BookService({
    repository,
    metadataService: { findByIsbn: async () => ({
      coverUrl: "/covers/9780306406157.webp",
      titleReading: "しょめいのよみ",
      authorReading: "外部書誌の著者よみ",
    }) },
    coverService: { ensureCachedCover: async () => "" },
    now: () => "2026-07-16T00:00:00.000Z",
  });

  await service.backfillMetadataGaps();

  assert.equal(repository.books[0].coverUrl, "/covers/9780306406157.webp");
  assert.equal(repository.books[0].titleReading, "しょめいのよみ");
  assert.equal(repository.books[0].authorReading, "利用者入力の著者よみ");
  assert.equal(repository.books[0].updatedAt, "2026-07-16T00:00:00.000Z");
  assert.equal(repository.books[0].metadataCheckedAt, "2026-07-16T00:00:00.000Z");
});

test("書誌補完は確認日時で再試行を抑え、外部APIの呼び出し回数を制限する", async () => {
  let apiCalls = 0;
  const repository = new MemoryRepository([
    // metadataSourceのない手動・サンプル由来の本も、ISBNがあれば補完対象になる。
    { id: "manual-book", isbn: "9780306406157", coverUrl: "", titleReading: "", authorReading: "" },
    // 不正ISBNはAPIを呼ばずに失敗し、確認日時だけ記録される。
    { id: "broken-isbn", isbn: "978-4-き-000021-8", coverUrl: "" },
    // 3日以内に確認済みの本は再試行しない。
    { id: "recently-checked", isbn: "9784088821832", coverUrl: "", metadataCheckedAt: "2026-07-17T00:00:00.000Z" },
  ]);
  const service = new BookService({
    repository,
    metadataService: {
      findByIsbn: async () => {
        apiCalls += 1;
        return { coverUrl: "/covers/9780306406157.webp", titleReading: "よみ", authorReading: "ちょしゃのよみ" };
      },
    },
    coverService: { ensureCachedCover: async () => "" },
    now: () => "2026-07-18T00:00:00.000Z",
  });

  await service.backfillMetadataGaps();

  assert.equal(apiCalls, 1);
  assert.equal(repository.books[0].coverUrl, "/covers/9780306406157.webp");
  assert.equal(repository.books[0].metadataCheckedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(repository.books[1].metadataCheckedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(repository.books[2].metadataCheckedAt, "2026-07-17T00:00:00.000Z");

  // 直後の再実行では、全冊が取得済みまたは確認済みのため外部APIを呼ばない。
  await service.backfillMetadataGaps();
  assert.equal(apiCalls, 1);
});
