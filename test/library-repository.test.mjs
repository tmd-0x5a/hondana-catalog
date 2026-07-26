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

test("日次パックを蔵書と別ファイルへ保存し、未生成ならnullを返す", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-pack-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const repository = new LibraryRepository({ dataDir, seedBooks: [] });
  await repository.initialize();

  assert.equal(await repository.readPack(), null);

  const pack = { date: "2026-07-20", cards: [{ isbn: "9784088821207", title: "候補" }], openedAt: null };
  await repository.savePack(pack);
  assert.deepEqual(await repository.readPack(), pack);

  // 連続保存も他ファイルと同じく直列化し、最後の書込みが残る。
  await Promise.all([
    repository.savePack({ ...pack, openedAt: "2026-07-20T00:00:00.000Z" }),
    repository.savePack({ ...pack, openedAt: "2026-07-20T01:00:00.000Z" }),
  ]);
  assert.equal((await repository.readPack()).openedAt, "2026-07-20T01:00:00.000Z");
  // 蔵書ファイルには影響しない。
  assert.deepEqual(await repository.readBooks(), []);
});

test("起動日ごとに蔵書スナップショットを残し、古い世代を削除する", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-backup-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));

  let currentDate = new Date("2026-07-01T09:00:00");
  const openRepository = () => new LibraryRepository({
    dataDir,
    seedBooks: [{ id: "seed", title: "初期蔵書" }],
    now: () => currentDate,
  });

  // 同じ日の再起動ではスナップショットを増やさない。
  await openRepository().initialize();
  await openRepository().initialize();
  let backups = await fsp.readdir(path.join(dataDir, "backups"));
  assert.deepEqual(backups, ["books-2026-07-01.json"]);

  // 10日分の起動を繰り返すと、最新7世代だけが残る。
  for (let day = 2; day <= 10; day += 1) {
    currentDate = new Date(`2026-07-${String(day).padStart(2, "0")}T09:00:00`);
    await openRepository().initialize();
  }
  backups = (await fsp.readdir(path.join(dataDir, "backups"))).sort();
  assert.equal(backups.length, 7);
  assert.deepEqual(backups.at(0), "books-2026-07-04.json");
  assert.deepEqual(backups.at(-1), "books-2026-07-10.json");

  // スナップショットは当日のbooks.jsonの内容を保持する。
  const firstBackup = JSON.parse(await fsp.readFile(path.join(dataDir, "backups", "books-2026-07-04.json"), "utf8"));
  assert.equal(firstBackup[0].id, "seed");
});

test("同時の読込・変更・保存を一つの更新トランザクションとして直列化する", async (context) => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-transaction-"));
  context.after(() => fsp.rm(dataDir, { recursive: true, force: true }));
  const repository = new LibraryRepository({ dataDir, seedBooks: [] });
  await repository.initialize();

  const addFirst = repository.updateBooks(async (books) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    books.push({ id: "first" });
  });
  const addSecond = repository.updateBooks((books) => {
    books.push({ id: "second" });
  });
  await Promise.all([addFirst, addSecond]);

  assert.deepEqual((await repository.readBooks()).map((book) => book.id), ["first", "second"]);
});
