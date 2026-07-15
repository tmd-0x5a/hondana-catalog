import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LibraryRepository } from "../server/library-repository.mjs";

test("蔵書とアップロード履歴を指定データディレクトリへ保存する", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-repository-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const seedBooks = [{ id: "seed", title: "初期蔵書" }];
  const repository = new LibraryRepository({ dataDir, seedBooks });

  await repository.initialize();
  assert.deepEqual(await repository.readBooks(), seedBooks);
  assert.deepEqual(await repository.readUploads(), []);

  await repository.saveBooks([{ id: "saved", title: "保存済み" }]);
  await repository.saveUploads([{ id: "upload" }]);
  assert.equal((await repository.readBooks())[0].id, "saved");
  assert.equal((await repository.readUploads())[0].id, "upload");
});

test("同じJSONへの書込みを直列化し、破損時は直前バックアップを読む", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-atomic-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const repository = new LibraryRepository({ dataDir, seedBooks: [] });
  await repository.initialize();

  const firstWrite = repository.saveBooks([{ id: "first" }]);
  const secondWrite = repository.saveBooks([{ id: "second" }]);
  await Promise.all([firstWrite, secondWrite]);
  assert.equal((await repository.readBooks())[0].id, "second");

  await fsp.writeFile(repository.paths.booksFile, "{broken json", "utf8");
  assert.equal((await repository.readBooks())[0].id, "first");

  await repository.saveBooks([{ id: "third" }]);
  await fsp.writeFile(repository.paths.booksFile, "{broken again", "utf8");
  assert.equal((await repository.readBooks())[0].id, "first");
});
