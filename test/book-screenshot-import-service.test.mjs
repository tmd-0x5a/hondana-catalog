import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSuggestionsToSources,
  BookScreenshotImportService,
  extractTitleQueries,
  filterMatchingSuggestions,
  normalizeOcrLine,
  titleSimilarity,
} from "../server/book-screenshot-import-service.mjs";

function ocrLine(text, x, y, width, height) {
  return { text, x, y, width, height };
}

test("Windows OCRが日本語の字間へ入れた空白を検索語から除く", () => {
  assert.equal(normalizeOcrLine("葬 送 の フ リ - レ ン 1"), "葬送のフリ-レン1");
  assert.equal(normalizeOcrLine("SPY x FAMILY 3"), "SPY x FAMILY 3");
});

test("一覧画面の座標と文字高からタイトル行だけを抽出する", () => {
  const documents = [{
    width: 1067,
    height: 1336,
    lines: [
      ocrLine("つ く り な が ら 学 ふ ! LLM 自 作 入 門", 170, 32, 300, 19),
      ocrLine("SebastianRaschka 他", 170, 74, 147, 14),
      ocrLine("ビ ジ ネ ス", 172, 104, 56, 13),
      ocrLine("購入済み最新巻のレビューを書く", 171, 136, 219, 13),
      ocrLine("LLM", 44, 51, 57, 23),
      ocrLine("世 界 一 流 工 ン ジ ニ ア の 思 考 法", 170, 233, 259, 19),
      ocrLine("牛 尾 剛", 170, 274, 43, 14),
      ocrLine("ビ ジ ネ ス", 172, 305, 56, 13),
      ocrLine("購入済み最新巻のレビューを書く", 171, 337, 219, 13),
      ocrLine("エ ン ジ ニ ア の", 108, 243, 19, 111),
      ocrLine("ハ ッ キ ン グ ・ ラ ホ の つ く り か た 完 全 版 仮 想 環 境 に お け る ハ ッ カ ー 体 験 学 習", 171, 433, 665, 19),
      ocrLine("ー PUSIRON", 170, 477, 67, 11),
      ocrLine("ビ ジ ネ ス", 172, 505, 56, 13),
      ocrLine("購入済み最新巻のレビューを書く", 171, 537, 219, 13),
    ],
  }];

  assert.deepEqual(extractTitleQueries(documents), [
    "つくりながら学ふ! LLM自作入門",
    "世界一流工ンジニアの思考法",
    "ハッキング・ラホのつくりかた完全版仮想環境におけるハッカー体験学習",
  ]);
});

test("グリッド画面では表紙断片・著者・レーベルを除き、全カラムの書名ラベルを抽出する", () => {
  // 実際のWindows OCR出力（合成ライブラリ画面）を基にしたフィクスチャ。
  const documents = [{
    width: 1080,
    height: 1240,
    lines: [
      ocrLine("ラ イ プ ラ リ 購 入 済 み 並 び 替 え", 42, 15, 300, 23),
      // 1カラム目: 表紙アートの断片、著者、レーベルと、下部の完全な書名ラベル。
      ocrLine("葬 送 の フ リ ー レ 、", 61, 102, 200, 30),
      ocrLine("4", 61, 149, 20, 25),
      ocrLine("山 田 鐘 人", 62, 340, 80, 22),
      ocrLine("少 年 サ ン デ ー コ ミ ッ ク ス", 60, 413, 180, 18),
      ocrLine("葬 送 の フ リ ー レ ン 14", 41, 482, 200, 19),
      ocrLine("山 田 鐘 人", 41, 517, 80, 16),
      // 2カラム目。
      ocrLine("ダ ン ダ ダ ン 12", 401, 100, 200, 32),
      ocrLine("龍 幸 伸", 401, 340, 60, 22),
      ocrLine("ジ ャ ン プ コ ミ ッ ク ス", 401, 412, 160, 19),
      ocrLine("ダ ン ダ ダ ン 12", 380, 481, 160, 20),
      ocrLine("龍 幸 伸", 380, 517, 60, 16),
      // 3カラム目。表紙断片はOCR誤認（エ→工）を含む。
      ocrLine("世 界 一 流 工 ン ジ", 741, 101, 180, 31),
      ocrLine("思 考 法", 741, 145, 80, 31),
      ocrLine("牛 尾 剛", 741, 340, 60, 22),
      ocrLine("文 舂 秋", 741, 413, 60, 18),
      ocrLine("世 界 一 流 工 ン ジ ニ ア の 思 考 法", 720, 481, 260, 21),
      ocrLine("牛 尾 剛", 721, 517, 60, 16),
    ],
  }];

  assert.deepEqual(extractTitleQueries(documents), [
    "ダンダダン12",
    "世界一流工ンジニアの思考法",
    "葬送のフリーレン14",
  ]);
});

test("欧文並記と巻数差を考慮して書誌タイトルを比較する", () => {
  assert.equal(titleSimilarity("ダンダダン12", "ダンダダン = DAN DA DAN. 12"), 1);
  assert.ok(titleSimilarity("葬送のフリーレン14", "葬送のフリーレン VOL.14") >= 0.99);
  // 別の巻は候補に残せる程度の類似度に抑え、正しい巻より上位にしない。
  assert.ok(titleSimilarity("葬送のフリーレン14", "葬送のフリーレン = FRIEREN. VOL.1") <= 0.6);
});

test("一括候補は最も類似する書名だけへ割り当てる", () => {
  const assigned = assignSuggestionsToSources(
    ["ダンダダン12", "ダンダダン1"],
    [
      { title: "ダンダダン = DAN DA DAN. 12", isbn: "isbn-12" },
      { title: "ダンダダン = DAN DA DAN. 1", isbn: "isbn-1" },
    ],
  );

  assert.deepEqual(assigned.get("ダンダダン12").map((item) => item.isbn), ["isbn-12"]);
  assert.deepEqual(assigned.get("ダンダダン1").map((item) => item.isbn), ["isbn-1"]);
});

test("11書名以上は10件ずつのSRU検索へ分割し、要求間隔を空ける", async () => {
  const batches = [];
  const waits = [];
  const titles = Array.from({ length: 12 }, (_, index) => `作品タイトル${String(index + 1).padStart(2, "0")}`);
  const service = new BookScreenshotImportService({
    ocrService: { async recognize() { return [{ filename: "large.png", lines: titles }]; } },
    catalogService: { async suggestBooksBatch(queries) { batches.push(queries); return []; } },
    pause: async (milliseconds) => { waits.push(milliseconds); },
  });

  const result = await service.scanScreenshots([{ originalname: "large.png", buffer: Buffer.from("image") }]);

  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 10);
  assert.equal(batches[1].length, 2);
  assert.deepEqual(waits, [1_300]);
  assert.equal(result.candidates.length, 12);
});

test("OCR行をNDL候補と表紙プレビューへ変換し、UI文字は検索しない", async () => {
  const queries = [];
  const service = new BookScreenshotImportService({
    ocrService: {
      async recognize() {
        return [{ filename: "kindle.png", lines: ["電子書籍ライブラリ", "葬 送 の フ リ - レ ン 1", "9780306406157", "￥770"] }];
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

  assert.deepEqual(queries, ["葬送のフリーレン1"]);
  assert.equal(result.documents, 1);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].suggestions[0].isbn, "9780306406157");
  assert.equal(result.candidates[1].suggestions[0].coverUrl, "/api/covers/preview/9784098602780");
});

test("既知のOCR誤認を一度の検索語で補正する", async () => {
  const queries = [];
  const service = new BookScreenshotImportService({
    ocrService: { async recognize() { return [{ filename: "store.png", lines: ["つくりながら学ふ! LLM自作入門", "世界一流工ンジニアの思考法", "WebAPlの設計"] }]; } },
    catalogService: {
      async suggestBooks(query) {
        queries.push(query);
        return [{ title: query, isbn: `isbn-${queries.length}` }];
      },
    },
    pause: async () => {},
  });

  await service.scanScreenshots([{ originalname: "store.png", buffer: Buffer.from("image") }]);
  assert.deepEqual(new Set(queries), new Set(["つくりながら学ぶ! LLM自作入門", "世界一流エンジニアの思考法", "Web APIの設計"]));
});

test("無関係な書誌候補をタイトル類似度で除外する", () => {
  const source = "つくりながら学ふ! LLM自作入門";
  const suggestions = [
    { title: "手塚治虫world : これがホントの最終回だ! 青年マンガ編", isbn: "9780000000001" },
    { title: "つくりながら学ぶ! LLM自作入門", isbn: "9780000000002" },
  ];

  assert.ok(titleSimilarity(source, suggestions[1].title) > 0.9);
  assert.ok(titleSimilarity(source, suggestions[0].title) < 0.3);
  assert.deepEqual(filterMatchingSuggestions(source, suggestions).map((item) => item.isbn), ["9780000000002"]);
});

test("座標から抽出した複数書名を一括照合し、無関係候補を各行から除く", async () => {
  const batchQueries = [];
  const service = new BookScreenshotImportService({
    ocrService: {
      async recognize() {
        return [{ filename: "library.png", lines: ["つくりながら学ふ! LLM自作入門", "世界一流工ンジニアの思考法"] }];
      },
    },
    catalogService: {
      async suggestBooksBatch(queries) {
        batchQueries.push(queries);
        return [
          { title: "つくりながら学ぶ!LLM自作入門", isbn: "9780306406157" },
          { title: "世界一流エンジニアの思考法", isbn: "9784163917689" },
          { title: "手塚治虫world : これがホントの最終回だ!", isbn: "9780000000001" },
        ];
      },
    },
    pause: async () => { throw new Error("一括検索では待機しない"); },
  });

  const result = await service.scanScreenshots([{ originalname: "library.png", buffer: Buffer.from("image") }]);

  assert.equal(batchQueries.length, 1);
  assert.deepEqual(new Set(batchQueries[0]), new Set(["つくりながら学ぶ! LLM自作入門", "世界一流エンジニアの思考法"]));
  assert.equal(result.candidates.length, 2);
  assert.equal(result.warning, "");
  assert.ok(result.candidates.every((row) => row.suggestions.every((item) => !item.title.includes("手塚治虫"))));
});

test("429では一度だけ待って再試行し、失敗後は後続検索を止める", async () => {
  let calls = 0;
  const waits = [];
  const service = new BookScreenshotImportService({
    ocrService: { async recognize() { return [{ filename: "store.png", lines: ["作品タイトル一", "作品タイトル二"] }]; } },
    catalogService: {
      async suggestBooks() {
        calls += 1;
        throw new Error("書籍候補検索 HTTP 429");
      },
    },
    pause: async (milliseconds) => { waits.push(milliseconds); },
  });

  const result = await service.scanScreenshots([{ originalname: "store.png", buffer: Buffer.from("image") }]);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [4_000]);
  assert.match(result.warning, /書名のみ/);
  assert.deepEqual(result.unmatchedLines, []);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((row) => row.suggestions[0].metadataPending));
});
