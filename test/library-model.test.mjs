import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeriesGroups,
  buildShelfEntries,
  buildShelfSections,
  electronicBookUrl,
  filterAndSortBooks,
  initialSectionLabel,
} from "../src/library-model.js";

const books = [
  {
    id: "physical-2",
    title: "作品 2",
    author: "著者B",
    publisher: "出版社B",
    category: "マンガ",
    format: "physical",
    physicalLocation: "本棚B",
    seriesName: "作品",
    volumeNumber: 2,
    sortOrder: 1,
    nextVolumeNumber: 3,
    nextVolumeIsbn: "9780000000003",
  },
  {
    id: "electronic-1",
    title: "作品 1",
    author: "著者A",
    publisher: "出版社A",
    category: "マンガ",
    format: "electronic",
    electronicPlatform: "DMMブックス",
    seriesName: "作品",
    volumeNumber: 1,
    sortOrder: 0,
  },
  {
    id: "novel",
    title: "小説",
    author: "著者C",
    publisher: "出版社A",
    category: "小説",
    format: "physical",
    reminderDate: "2026-07-15",
    sortOrder: 2,
  },
];

test("シリーズ集約は所持最大巻と次巻をまとめる", () => {
  const [series] = buildSeriesGroups(books);

  assert.equal(series.seriesName, "作品");
  assert.equal(series.ownedMax, 2);
  assert.equal(series.nextVolumeNumber, 3);
  assert.match(series.ownershipLabel, /実本/);
  assert.match(series.ownershipLabel, /DMMブックス/);
});

test("所有形態とカテゴリで絞り込んでタイトル順に並べる", () => {
  const result = filterAndSortBooks(books, {
    categoryFilter: "マンガ",
    ownershipFilter: "electronic",
    platformFilter: "DMMブックス",
    query: "作品",
    sortMode: "title",
    status: "すべて",
    viewMode: "library",
  });

  assert.deepEqual(result.map((book) => book.id), ["electronic-1"]);
  assert.deepEqual(books.map((book) => book.id), ["physical-2", "electronic-1", "novel"]);
});

test("リマインダー表示では日付がある本だけを残す", () => {
  const result = filterAndSortBooks(books, {
    categoryFilter: "all",
    ownershipFilter: "all",
    platformFilter: "all",
    query: "",
    sortMode: "manual",
    status: "すべて",
    viewMode: "reminders",
  });

  assert.deepEqual(result.map((book) => book.id), ["novel"]);
});

test("電子書籍リンクはHTTPSだけを返し、古い危険URLを媒体ホームへ戻す", () => {
  assert.equal(electronicBookUrl({ electronicUrl: "https://example.com/book", electronicPlatform: "" }), "https://example.com/book");
  assert.equal(
    electronicBookUrl({ electronicUrl: "javascript:alert(1)", electronicPlatform: "Amazon Kindle" }),
    "https://www.amazon.co.jp/kindle-dbs/storefront",
  );
});

test("出版社・著者・評価・シリーズ有無を追加条件として絞り込める", () => {
  const result = filterAndSortBooks(books.map((book, index) => ({ ...book, rating: index + 3 })), {
    authorFilter: "著者A",
    categoryFilter: "マンガ",
    minimumRating: 4,
    ownershipFilter: "all",
    platformFilter: "all",
    publisherFilter: "出版社A",
    query: "",
    seriesFilter: "series",
    sortMode: "publisher",
    status: "すべて",
    viewMode: "library",
  });

  assert.deepEqual(result.map((book) => book.id), ["electronic-1"]);
});

test("シリーズを一項目へまとめ、出版社順の棚見出しを作る", () => {
  const sorted = filterAndSortBooks(books, {
    categoryFilter: "all",
    ownershipFilter: "all",
    platformFilter: "all",
    query: "",
    sortMode: "publisher",
    status: "すべて",
    viewMode: "library",
  });
  const entries = buildShelfEntries(sorted);
  const sections = buildShelfSections(entries, "publisher", true);

  assert.equal(entries.filter((entry) => entry.kind === "series").length, 1);
  assert.equal(entries.find((entry) => entry.kind === "series").books.length, 2);
  assert.deepEqual(sections.map((section) => section.label), ["出版社A"]);
});

test("かな・英字を行見出しへ変換し、読みのない漢字を推測しない", () => {
  assert.equal(initialSectionLabel("オレンジ"), "あ行");
  assert.equal(initialSectionLabel("Kafka"), "A-Z");
  assert.equal(initialSectionLabel("葬送のフリーレン"), "読み未設定");
  assert.equal(initialSectionLabel(""), "読み未設定");
});

test("漢字タイトルは保存済みの読みを使って行見出しへ分ける", () => {
  const entries = buildShelfEntries([{ id: "frieren", title: "葬送のフリーレン", titleReading: "そうそうのふりーれん" }]);
  const [section] = buildShelfSections(entries, "title", true);
  assert.equal(section.label, "さ行");
});
