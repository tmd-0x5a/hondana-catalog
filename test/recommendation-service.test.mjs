import assert from "node:assert/strict";
import test from "node:test";

import { RecommendationService } from "../server/recommendation-service.mjs";

test("読了・高評価の著者候補から所蔵済みを除外する", async () => {
  const service = new RecommendationService({
    repository: {
      async readBooks() {
        return [
          { id: "owned", title: "所蔵本", author: "著者A", isbn: "9780306406157", status: "読了", rating: 5 },
          { id: "unread", title: "未読本", author: "著者B", isbn: "9780000000002", status: "未読", rating: 0 },
        ];
      },
    },
    catalogService: {
      async findBooksByCreator() {
        return [
          { title: "所蔵本", author: "著者A", isbn: "9780306406157" },
          { title: "おすすめ本", author: "著者A", isbn: "9784873119038" },
        ];
      },
    },
  });

  const result = await service.listRecommendations();

  assert.equal(result.seedCount, 1);
  assert.deepEqual(result.recommendations.map((book) => book.title), ["おすすめ本"]);
  assert.equal(result.recommendations[0].coverUrl, "/api/covers/preview/9784873119038");
});
