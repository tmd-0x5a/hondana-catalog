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

/**
 * 稼働情報、LAN接続設定、持ち出し本棚のルートを生成する。
 *
 * @param {object} dependencies ルート依存。
 * @param {import("../book-service.mjs").BookService} dependencies.bookService 蔵書読込サービス。
 * @param {number} dependencies.port 待受ポート。
 * @param {() => string} dependencies.getLanAddress LAN IPv4取得関数。
 * @param {string} dependencies.accessToken 起動ごとのLAN接続トークン。
 * @returns {import("express").Router} システム系APIルーター。
 */
export function createSystemRouter({ bookService, port, getLanAddress, accessToken }) {
  const router = express.Router();

  router.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "本棚カタログ", port });
  });

  router.get("/api/config", asyncRoute(async (_request, response) => {
    const lanIp = getLanAddress();
    const baseUrl = `http://${lanIp}:${port}`;
    const uploadUrl = `${baseUrl}/upload`;
    const authorizedUploadUrl = `${uploadUrl}?access_token=${encodeURIComponent(accessToken)}`;
    response.json({
      lanIp,
      port,
      baseUrl,
      uploadUrl,
      authorizedUploadUrl,
      checkUrl: `${baseUrl}/check`,
      qrCode: await QRCode.toDataURL(authorizedUploadUrl, { margin: 1, width: 196 }),
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
