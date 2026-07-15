import express from "express";

import { asyncRoute } from "./async-route.mjs";

export function createBookRouter({ bookService, catalogService }) {
  const router = express.Router();

  router.get("/api/books", asyncRoute(async (_request, response) => {
    response.json({ books: await bookService.listBooks() });
  }));

  router.get("/api/books/suggest", asyncRoute(async (request, response) => {
    const query = String(request.query.q || "").trim();
    const suggestions = query.length < 2 ? [] : await catalogService.suggestBooks(query);
    response.json({ suggestions, source: "NDLサーチAPI" });
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
    const books = await bookService.reorderBooks(request.body.ids);
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
    const result = await bookService.importIsbn(request.body.isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));

  return router;
}
