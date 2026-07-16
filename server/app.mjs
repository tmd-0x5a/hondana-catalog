import fs from "node:fs";
import path from "node:path";

import express from "express";
import multer from "multer";

/**
 * Expressのミドルウェア順、静的配信、共通エラー形式を構成する。
 *
 * @param {object} options アプリ構成。
 * @param {string} options.distDir Viteビルド成果物の絶対パス。
 * @param {string} options.uploadDir アップロード画像ディレクトリ。
 * @param {string} options.coverDir 表紙キャッシュディレクトリ。
 * @param {import("express").Router[]} options.routers APIルーター一覧。
 * @param {import("express").RequestHandler[]} [options.securityMiddleware=[]] 本文解析前に適用する防御ミドルウェア。
 * @returns {import("express").Express} 構成済みExpressアプリ。
 */
export function createApp({ distDir, uploadDir, coverDir, routers, securityMiddleware = [] }) {
  const app = express();
  app.disable("x-powered-by");
  securityMiddleware.forEach((middleware) => app.use(middleware));
  app.use(express.json({ limit: "1mb" }));
  app.use("/uploads", express.static(uploadDir, { maxAge: "1d" }));
  app.use("/covers", express.static(coverDir, { maxAge: "30d" }));
  routers.forEach((router) => app.use(router));

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((request, response, next) => {
      const isPageNavigation = request.method === "GET" && request.accepts("html");
      if (isPageNavigation) return response.sendFile(path.join(distDir, "index.html"));
      next();
    });
  }

  app.use((error, _request, response, _next) => {
    const requestedStatus = error.status || (error instanceof multer.MulterError ? 400 : 500);
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;
    if (status >= 500) console.error(error);
    const message = status >= 500
      ? "処理中にエラーが発生しました。PC側のログを確認してください。"
      : error.message;
    response.status(status).json({ error: message, ...(error.upload ? { upload: error.upload } : {}) });
  });
  return app;
}
