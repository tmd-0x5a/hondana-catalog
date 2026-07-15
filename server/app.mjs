import fs from "node:fs";
import path from "node:path";

import express from "express";
import multer from "multer";

/** Expressのミドルウェア順、静的配信、共通エラー形式だけを構成する。 */
export function createApp({ distDir, uploadDir, coverDir, routers }) {
  const app = express();
  app.disable("x-powered-by");
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
    console.error(error);
    const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
    const message = status >= 500
      ? "処理中にエラーが発生しました。PC側のログを確認してください。"
      : error.message;
    response.status(status).json({ error: message, ...(error.upload ? { upload: error.upload } : {}) });
  });
  return app;
}
