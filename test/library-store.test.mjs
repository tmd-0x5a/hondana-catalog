import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLibraryStore } from "../server/library-store.mjs";

test("蔵書とアップロード履歴を指定データディレクトリへ保存する", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-store-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const seedBooks = [{ id: "seed", title: "初期蔵書" }];
  const store = createLibraryStore({ dataDir, seedBooks });

  await store.initialize();
  assert.deepEqual(await store.readBooks(), seedBooks);
  assert.deepEqual(await store.readUploads(), []);

  await store.saveBooks([{ id: "saved", title: "保存済み" }]);
  await store.saveUploads([{ id: "upload" }]);
  assert.equal((await store.readBooks())[0].id, "saved");
  assert.equal((await store.readUploads())[0].id, "upload");
});
