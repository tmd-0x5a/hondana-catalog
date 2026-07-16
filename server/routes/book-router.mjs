import express from "express";

import { normalizeIsbn } from "../isbn.mjs";
import { validateSearchText } from "../request-validation.mjs";
import { asyncRoute } from "./async-route.mjs";

/**
 * 蔵書CRUD、候補検索、ISBN登録のHTTPルートを生成する。
 *
 * @param {object} dependencies ルートが委譲するサービス。
 * @param {import("../book-service.mjs").BookService} dependencies.bookService 蔵書ユースケース。
 * @param {import("../ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL候補検索。
 * @param {import("../book-metadata-service.mjs").BookMetadataService} dependencies.metadataService 書影候補取得。
 * @returns {import("express").Router} `/api/books`と`/api/isbn`を提供するルーター。
 */
export function createBookRouter({ bookService, catalogService, metadataService }) {
  const router = express.Router();

  router.get("/api/books", asyncRoute(async (_request, response) => {
    response.json({ books: await bookService.listBooks() });
  }));

  router.get("/api/books/suggest", asyncRoute(async (request, response) => {
    const query = validateSearchText(request.query.q ?? "", { minLength: 0, maxLength: 200, label: "検索語" });
    const suggestions = query.length < 2 ? [] : await catalogService.suggestBooks(query);
    response.json({
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        coverUrl: `/api/covers/preview/${encodeURIComponent(suggestion.isbn)}`,
      })),
      source: "NDLサーチAPI",
    });
  }));

  router.get("/api/covers/preview/:isbn", asyncRoute(async (request, response) => {
    const isbn = normalizeIsbn(request.params.isbn);
    const metadata = await metadataService.findByIsbn(isbn);
    if (!metadata.coverUrl?.startsWith("/covers/")) {
      return response.status(404).json({ error: "利用できる表紙画像が見つかりませんでした。" });
    }
    return response.redirect(302, metadata.coverUrl);
  }));

  router.post("/api/books", asyncRoute(async (request, response) => {
    const book = await bookService.createBook(request.body);
    response.status(201).json({ book });
  }));

  router.patch("/api/books/:id", asyncRoute(async (request, response) => {
    const book = await bookService.updateBook(request.params.id, request.body);
    response.json({ book });
  }));

  router.post("/api/books/reorder", asyncRoute(async (request, response) => {
    const books = await bookService.reorderBooks(request.body?.ids);
    response.json({ books });
  }));

  router.post("/api/books/:id/refresh-cover", asyncRoute(async (request, response) => {
    const book = await bookService.refreshCover(request.params.id);
    response.json({ book });
  }));

  router.delete("/api/books/:id", asyncRoute(async (request, response) => {
    await bookService.deleteBook(request.params.id);
    response.status(204).end();
  }));

  router.post("/api/isbn", asyncRoute(async (request, response) => {
    const result = await bookService.importIsbn(request.body?.isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));

  return router;
}
