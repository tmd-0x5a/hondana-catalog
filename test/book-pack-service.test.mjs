import assert from "node:assert/strict";
import test from "node:test";

import { BookPackService, drawGenres, drawRareGenre } from "../server/book-pack-service.mjs";

class MemoryRepository {
  constructor(books = [], pack = null) {
    this.books = structuredClone(books);
    this.pack = pack;
    this.saveCount = 0;
  }

  async readBooks() {
    return structuredClone(this.books);
  }

  async readPack() {
    return this.pack ? structuredClone(this.pack) : null;
  }

  async savePack(pack) {
    this.pack = structuredClone(pack);
    this.saveCount += 1;
  }
}

const ownedBooks = [
  { id: "1", title: "技術書A", isbn: "9784798194639", category: "技術", publisher: "翔泳社", author: "著者A" },
  { id: "2", title: "技術書B", isbn: "9784873119069", category: "技術", publisher: "翔泳社", author: "著者B" },
  { id: "3", title: "技術書C", isbn: "9784839987800", category: "技術", publisher: "翔泳社", author: "著者C" },
  { id: "4", title: "マンガA", isbn: "9784088820118", category: "マンガ", publisher: "集英社", author: "著者D" },
];

/** 決まった順に値を返す擬似乱数。抽選結果を固定してテストする。 */
function sequenceRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function createService({ repository, catalogService, metadataService, random = () => 0 }) {
  return new BookPackService({
    repository,
    catalogService,
    metadataService,
    random,
    now: () => new Date("2026-07-20T09:00:00"),
    pause: async () => {},
  });
}

test("ジャンルは蔵書の冊数比率で抽選し、レア枠は未所蔵ジャンルから選ぶ", () => {
  // 技術3冊・マンガ1冊なので、0〜0.75未満が技術、0.75以上がマンガに当たる。
  assert.deepEqual(drawGenres(ownedBooks, 4, sequenceRandom([0, 0.5, 0.74, 0.9])), ["技術", "技術", "技術", "マンガ"]);

  // 蔵書にないジャンルだけがレア枠の候補になる。
  const rareGenre = drawRareGenre(ownedBooks, () => 0);
  assert.ok(!["技術", "マンガ"].includes(rareGenre));

  // 全ジャンルを所蔵している場合は最も冊数の少ないジャンルを使う。
  const allGenres = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"]
    .flatMap((category, index) => Array.from({ length: index === 3 ? 1 : 5 }, (_, n) => ({ id: `${category}-${n}`, category })));
  assert.equal(drawRareGenre(allGenres, () => 0), "ビジネス");
});

test("所蔵済みISBN・同名タイトル・パック内重複を候補から除外する", async () => {
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        return [
          { title: "技術書A", isbn: "9784798194639", author: "著者A" }, // 所蔵ISBNのため除外
          { title: "技術書B", isbn: "9780306406157", author: "別著者" }, // 同名タイトルのため除外
          { title: "未所蔵の技術書", isbn: "9784088821207", author: "新著者", publisher: "翔泳社" },
        ];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() {
        return [{ title: "未所蔵の実用書", isbn: "9784088825991", author: "実用著者" }];
      },
    },
    metadataService: { async findByIsbn() { throw new Error("書誌なし"); } },
  });

  const pack = await service.prepareTodaysPack();
  const isbns = pack.cards.map((card) => card.isbn);

  assert.ok(!isbns.includes("9784798194639"));
  assert.ok(!isbns.includes("9780306406157"));
  // 4枠すべてが同じ1冊しか返さない検索でも、重複せず1枚だけ入る。
  assert.equal(isbns.filter((isbn) => isbn === "9784088821207").length, 1);
  assert.equal(pack.cards.filter((card) => card.rare).length, 1);
});

test("候補のISBN-10を13桁へ正規化し、書誌が無くてもNDLの書名を残す", async () => {
  let requestedIsbn = "";
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        // NDLはISBN-10の書誌も返す。openBDはISBN-10を受け付けないため13桁化が必要。
        return [{ title: "経営学入門", isbn: "4492222553", author: "秋保雅男", publisher: "東洋経済新報社" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return []; },
    },
    metadataService: {
      async findByIsbn(isbn) {
        requestedIsbn = isbn;
        // 書誌が見つからない場合のfindByIsbnの戻り値を再現する。
        return { title: `ISBN ${isbn}`, author: "著者情報なし", coverUrl: "", description: "" };
      },
    },
  });

  const pack = await service.prepareTodaysPack();
  const [card] = pack.cards;

  assert.equal(requestedIsbn, "9784492222553");
  assert.equal(card.isbn, "9784492222553");
  assert.equal(card.title, "経営学入門");
  assert.equal(card.author, "秋保雅男");
});

test("候補ゼロの枠は引き直してパックの枚数を保つ", async () => {
  let attempts = 0;
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        attempts += 1;
        // 最初の2回は候補ゼロ、以降は見つかる状況を再現する。
        const availableIsbns = ["9784088837260", "9784098540174", "9784163917689", "9780306406157"];
        return attempts <= 2
          ? []
          : [{ title: `候補${attempts}`, isbn: availableIsbns[attempts % availableIsbns.length], author: "著者" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return [{ title: "レア候補", isbn: "9784088825991", author: "著者" }]; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  const pack = await service.prepareTodaysPack();

  // 引き直しがなければ2枚しか出ないが、補充により枚数が回復する。
  assert.ok(pack.cards.length > 2, `期待: 3枚以上, 実際: ${pack.cards.length}枚`);
  assert.equal(pack.cards.filter((card) => card.rare).length, 1);
});

test("紹介文が取得できない本も書誌情報だけでカードになる", async () => {
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        return [{ title: "候補書名", isbn: "9784088821207", author: "候補著者", publisher: "出版社", published: "2026" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return []; },
    },
    metadataService: {
      async findByIsbn() {
        return { title: "候補書名", author: "候補著者", publisher: "出版社", published: "2026", coverUrl: "", description: "" };
      },
    },
  });

  const pack = await service.prepareTodaysPack();
  const [card] = pack.cards;

  assert.equal(card.description, "");
  assert.equal(card.title, "候補書名");
  assert.equal(card.author, "候補著者");
  // 表紙が未取得でも、プレビュー経由で表示できるURLを持たせる。
  assert.equal(card.coverUrl, "/api/covers/preview/9784088821207");
});

test("候補の紹介文を一括照会し、紹介文のある本を優先して選ぶ", async () => {
  const batches = [];
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    // 常に先頭を選ぶ乱数でも、紹介文のある2冊目が選ばれることを確かめる。
    random: () => 0,
    catalogService: {
      async findBooksByPublisher() {
        return [
          { title: "紹介文なしの本", isbn: "9784088837260", author: "著者A" },
          { title: "紹介文ありの本", isbn: "9784098540174", author: "著者B" },
        ];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return []; },
    },
    metadataService: {
      async findDescriptionsByIsbns(isbns) {
        batches.push(isbns);
        return new Map([["9784098540174", "openBDの内容紹介"]]);
      },
      // 書誌照会が失敗しても、一括照会で得た紹介文は残る。
      async findByIsbn() { throw new Error("Google Books 429"); },
    },
  });

  const pack = await service.prepareTodaysPack();
  const [card] = pack.cards;

  // 1枠につき1回だけ、候補全件をまとめて照会する。
  assert.deepEqual(batches[0], ["9784088837260", "9784098540174"]);
  assert.equal(card.title, "紹介文ありの本");
  assert.equal(card.description, "openBDの内容紹介");
});

test("カードには選ばれた理由を持たせる", async () => {
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() { return [{ title: "候補", isbn: "9784088837260", author: "著者" }]; },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return [{ title: "レア候補", isbn: "9784088825991", author: "著者" }]; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  const pack = await service.prepareTodaysPack();
  const rareCard = pack.cards.find((card) => card.rare);
  const normalCard = pack.cards.find((card) => !card.rare);

  // 枠のジャンルと実際の本のジャンルは一致しないことがあるため、理由を表示に使う。
  assert.match(normalCard.reason, /の本$/);
  assert.match(rareCard.reason, /^未開拓の/);
});

test("同じ日の2回目は外部APIを呼ばず保存済みパックを返す", async () => {
  let searchCalls = 0;
  const repository = new MemoryRepository(ownedBooks);
  const catalogService = {
    async findBooksByPublisher() {
      searchCalls += 1;
      return [{ title: "候補書名", isbn: "9784088821207", author: "著者" }];
    },
    async findBooksByCreator() { return []; },
    async findBooksByKeyword() { return []; },
  };
  const metadataService = { async findByIsbn() { return { description: "紹介文" }; } };

  const first = await createService({ repository, catalogService, metadataService }).prepareTodaysPack();
  const callsAfterFirst = searchCalls;
  const second = await createService({ repository, catalogService, metadataService }).prepareTodaysPack();

  assert.equal(searchCalls, callsAfterFirst);
  assert.deepEqual(second.cards, first.cards);
  assert.equal(second.date, "2026-07-20");
});

test("未生成の日は待たせずpreparingを返し、裏で生成を始める", async () => {
  let releaseSearch;
  const searchStarted = new Promise((resolve) => { releaseSearch = resolve; });
  let pending;
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        releaseSearch();
        // 生成が終わらない状態を作り、GETがそれを待たないことを確かめる。
        await new Promise((resolve) => { pending = resolve; });
        return [{ title: "候補", isbn: "9784088837260", author: "著者" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return []; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  const state = await service.getTodaysPack();

  assert.equal(state.status, "preparing");
  assert.deepEqual(state.cards, []);
  assert.equal(state.date, "2026-07-20");
  assert.equal(state.progress.total, 5);
  // 生成はバックグラウンドで動き出している。
  await searchStarted;
  pending();
});

test("生成中の再取得では同じ処理を待ち、外部APIを重ねて呼ばない", async () => {
  let searchCalls = 0;
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        searchCalls += 1;
        return [{ title: `候補${searchCalls}`, isbn: "9784088837260", author: "著者" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return [{ title: "レア", isbn: "9784088825991", author: "著者" }]; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  // 同時に生成を要求しても、生成は1回だけ走る。
  const [first, second] = await Promise.all([service.prepareTodaysPack(), service.prepareTodaysPack()]);
  const callsAfterPrepare = searchCalls;

  assert.deepEqual(first.cards, second.cards);
  assert.equal(repository.saveCount, 1);

  // 生成後のGETは保存済みをreadyとして返す。
  const state = await service.getTodaysPack();
  assert.equal(state.status, "ready");
  assert.equal(state.cards.length, first.cards.length);
  assert.equal(searchCalls, callsAfterPrepare);
});

test("候補が決まるたびに進捗が進む", async () => {
  const observed = [];
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() {
        observed.push(service.progress.completed);
        return [{ title: `候補${observed.length}`, isbn: ["9784088837260", "9784098540174", "9784163917689", "9780306406157"][observed.length % 4], author: "著者" }];
      },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return [{ title: "レア", isbn: "9784088825991", author: "著者" }]; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  await service.prepareTodaysPack();

  // 1枠目の検索時点では0、2枠目は1……と単調に増える。
  assert.deepEqual(observed.slice(0, 2), [0, 1]);
  assert.equal(service.progress.total, 5);
});

test("開封すると開封日時を記録し、二度目は同じ日時を保つ", async () => {
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() { return [{ title: "候補", isbn: "9784088821207", author: "著者" }]; },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() { return []; },
    },
    metadataService: { async findByIsbn() { return {}; } },
  });

  const opened = await service.openTodaysPack();
  assert.equal(opened.openedAt, "2026-07-20T00:00:00.000Z");

  const reopened = await service.openTodaysPack();
  assert.equal(reopened.openedAt, opened.openedAt);
});

test("一枠の検索が失敗しても残りの枠でパックを作る", async () => {
  const repository = new MemoryRepository(ownedBooks);
  const service = createService({
    repository,
    catalogService: {
      async findBooksByPublisher() { throw new Error("書籍候補検索 HTTP 429"); },
      async findBooksByCreator() { return []; },
      async findBooksByKeyword() {
        return [{ title: "レア候補", isbn: "9784088825991", author: "レア著者" }];
      },
    },
    metadataService: { async findByIsbn() { return { description: "紹介文" }; } },
  });

  const pack = await service.prepareTodaysPack();

  assert.equal(pack.cards.length, 1);
  assert.equal(pack.cards[0].rare, true);
  assert.equal(pack.cards[0].description, "紹介文");
});
