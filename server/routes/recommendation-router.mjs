import express from "express";

import { asyncRoute } from "./async-route.mjs";

/**
 * @param {{recommendationService: import("../recommendation-service.mjs").RecommendationService}} dependencies ルート依存。
 * @returns {import("express").Router} おすすめ取得ルーター。
 */
export function createRecommendationRouter({ recommendationService }) {
  const router = express.Router();
  router.get("/api/recommendations", asyncRoute(async (_request, response) => {
    response.json(await recommendationService.listRecommendations());
  }));
  return router;
}
