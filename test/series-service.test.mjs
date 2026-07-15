import assert from "node:assert/strict";
import test from "node:test";

import { SeriesService } from "../server/series-service.mjs";

test("所持最大巻より後の最初の巻をシリーズ全冊へ保存する", async () => {
  const repository = {
    books: [
      { id: "1", category: "マンガ", seriesName: "作品", volumeNumber: 1 },
      { id: "2", category: "マンガ", seriesName: "作品", volumeNumber: 2 },
    ],
    async readBooks() { return structuredClone(this.books); },
    async saveBooks(books) { this.books = structuredClone(books); },
  };
  const catalogService = {
    async findSeriesVolumes() {
      return [
        { title: "作品", volumeNumber: 1, isbn: "1" },
        { title: "作品", volumeNumber: 2, isbn: "2" },
        { title: "作品", volumeNumber: 3, isbn: "3", published: "2026-07-01" },
      ];
    },
  };
  const service = new SeriesService({
    repository,
    catalogService,
    now: () => "2026-07-15T00:00:00.000Z",
  });

  const result = await service.checkSeries("作品");

  assert.equal(result.ownedMax, 2);
  assert.equal(result.nextAvailable.volumeNumber, 3);
  assert.equal(repository.books[0].nextVolumeNumber, 3);
  assert.equal(repository.books[1].nextVolumeIsbn, "3");
});
