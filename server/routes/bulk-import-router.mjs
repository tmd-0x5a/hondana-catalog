import express from "express";

import { asyncRoute } from "./async-route.mjs";

/**
 * @param {{bulkImportService: import("../book-bulk-import-service.mjs").BookBulkImportService}} dependencies 一括取り込みサービス。
 * @returns {import("express").Router} 一括取り込みルーター。
 */
export function createBulkImportRouter({ bulkImportService }) {
  const router = express.Router();
  router.post("/api/books/bulk", asyncRoute(async (request, response) => {
    const result = await bulkImportService.importBooks(request.body);
    response.status(result.createdCount > 0 ? 201 : 200).json(result);
  }));
  return router;
}
