import express from "express";

import { asyncRoute } from "./async-route.mjs";

export function createSeriesRouter({ seriesService }) {
  const router = express.Router();

  router.post("/api/series/check", asyncRoute(async (request, response) => {
    response.json(await seriesService.checkSeries(request.body.seriesName));
  }));

  router.post("/api/series/check-all", asyncRoute(async (_request, response) => {
    const results = await seriesService.checkAllSeries();
    response.json({ checked: results.length, results });
  }));

  return router;
}
