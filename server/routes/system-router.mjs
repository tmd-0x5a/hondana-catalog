import express from "express";
import QRCode from "qrcode";

import { buildOfflineLibraryHtml } from "../offline-library.mjs";
import { asyncRoute } from "./async-route.mjs";

function pocketBook(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    seriesName: book.seriesName,
    volumeNumber: book.volumeNumber,
    format: book.format,
    physicalLocation: book.physicalLocation,
    electronicPlatform: book.electronicPlatform,
  };
}

export function createSystemRouter({ bookService, port, getLanAddress }) {
  const router = express.Router();

  router.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "本棚カタログ", port });
  });

  router.get("/api/config", asyncRoute(async (_request, response) => {
    const lanIp = getLanAddress();
    const baseUrl = `http://${lanIp}:${port}`;
    const uploadUrl = `${baseUrl}/upload`;
    response.json({
      lanIp,
      port,
      baseUrl,
      uploadUrl,
      checkUrl: `${baseUrl}/check`,
      qrCode: await QRCode.toDataURL(uploadUrl, { margin: 1, width: 196 }),
    });
  }));

  router.get("/api/offline-library", asyncRoute(async (_request, response) => {
    const books = await bookService.listBooks();
    const snapshot = { syncedAt: new Date().toISOString(), books: books.map(pocketBook) };
    response.set({
      "content-type": "text/html; charset=utf-8",
      "content-disposition": 'attachment; filename="hondana-pocket.html"',
      "cache-control": "no-store",
    });
    response.send(buildOfflineLibraryHtml(snapshot));
  }));

  return router;
}
