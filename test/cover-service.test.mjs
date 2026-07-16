import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CoverService, isAllowedCoverUrl } from "../server/cover-service.mjs";

test("表紙取得は既知HTTPSホストだけを許可する", () => {
  assert.equal(isAllowedCoverUrl("https://cover.openbd.jp/9780306406157.jpg"), true);
  assert.equal(isAllowedCoverUrl("http://cover.openbd.jp/book.jpg"), false);
  assert.equal(isAllowedCoverUrl("https://127.0.0.1/private.jpg"), false);
});

test("表紙リダイレクトは追跡前に遷移先を検査する", async (context) => {
  const coverDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hondana-cover-"));
  context.after(() => fsp.rm(coverDir, { recursive: true, force: true }));
  const requestedUrls = [];
  const service = new CoverService({
    coverDir,
    httpClient: {
      async request(url) {
        requestedUrls.push(String(url));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/private.jpg" },
        });
      },
    },
  });

  const result = await service.ensureCachedCover("9780306406157", [
    "https://cover.openbd.jp/9780306406157.jpg",
  ]);
  assert.equal(result, "");
  assert.equal(requestedUrls.some((url) => url.includes("127.0.0.1")), false);
});
