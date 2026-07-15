import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBookDefaults,
  inferBookClassification,
  normalizedSeriesName,
  parseVolumeNumber,
} from "../server/book-model.mjs";

test("古い蔵書データへ現在の保存既定値を補う", () => {
  const book = applyBookDefaults({ title: "テスト", shelf: "本棚A", bookType: "manga" }, 7);

  assert.equal(book.category, "マンガ");
  assert.equal(book.format, "physical");
  assert.equal(book.physicalLocation, "本棚A");
  assert.equal(book.sortOrder, 7);
  assert.equal(book.volumeNumber, null);
});

test("電子書籍ストア名の既存表記を正規化する", () => {
  const book = applyBookDefaults({ format: "electronic", electronicPlatform: "kindle" });

  assert.equal(book.electronicPlatform, "Amazon Kindle");
  assert.equal(book.physicalLocation, "");
});

test("タイトルに含まれる巻数表記を抽出する", () => {
  assert.equal(parseVolumeNumber("葬送のフリーレン 第12巻"), 12);
  assert.equal(parseVolumeNumber("作品名 VOL. 4"), 4);
  assert.equal(parseVolumeNumber("巻数なし"), null);
});

test("コミック書誌からシリーズ名と巻数を推定する", () => {
  const classification = inferBookClassification({ title: "サンプルコミックス 8" });

  assert.equal(classification.category, "マンガ");
  assert.equal(classification.seriesName, "サンプルコミックス");
  assert.equal(classification.volumeNumber, 8);
});

test("シリーズ名の記号と全半角差を比較キーから除く", () => {
  assert.equal(normalizedSeriesName("作品名：第１部"), normalizedSeriesName("作品名 第1部"));
});
