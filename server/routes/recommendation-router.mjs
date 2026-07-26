import express from "express";

import { asyncRoute } from "./async-route.mjs";

/**
 * @param {{packService: import("../book-pack-service.mjs").BookPackService}} dependencies ルート依存。
 * @returns {import("express").Router} 日次パック取得ルーター。
 */
export function createRecommendationRouter({ packService }) {
  const router = express.Router();

  router.get("/api/recommendations/pack", asyncRoute(async (_request, response) => {
    response.json(await packService.getTodaysPack());
  }));

  router.post("/api/recommendations/pack/open", asyncRoute(async (_request, response) => {
    response.json(await packService.openTodaysPack());
  }));

  return router;
}
