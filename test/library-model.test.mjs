import assert from "node:assert/strict";
import test from "node:test";

import { buildSeriesGroups, filterAndSortBooks } from "../src/library-model.js";

const books = [
  {
    id: "physical-2",
    title: "作品 2",
    author: "著者B",
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
