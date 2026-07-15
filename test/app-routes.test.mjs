import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../server/app.mjs";
import { createBookRouter } from "../server/routes/book-router.mjs";
import { createSystemRouter } from "../server/routes/system-router.mjs";

test("HTTPルートはサービス結果を既存のAPI形式で返す", async (context) => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-app-"));
  context.after(() => fsp.rm(tempDir, { recursive: true, force: true }));
  const bookService = {
    async listBooks() { return [{ id: "book-1", title: "既存本" }]; },
    async createBook(input) { return { id: "book-2", title: input.title }; },
  };
  const routers = [
    createSystemRouter({ bookService, port: 0, getLanAddress: () => "127.0.0.1" }),
    createBookRouter({ bookService, catalogService: { suggestBooks: async () => [] } }),
  ];
  const app = createApp({
    distDir: path.join(tempDir, "missing-dist"),
    uploadDir: tempDir,
    coverDir: tempDir,
    routers,
  });
  const server = await new Promise((resolve) => {
    const runningServer = app.listen(0, "127.0.0.1", () => resolve(runningServer));
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const booksResponse = await fetch(`${baseUrl}/api/books`);
  const createResponse = await fetch(`${baseUrl}/api/books`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "新しい本" }),
  });

  assert.equal((await healthResponse.json()).ok, true);
  assert.deepEqual((await booksResponse.json()).books, [{ id: "book-1", title: "既存本" }]);
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).book.title, "新しい本");
});
