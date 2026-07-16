import assert from "node:assert/strict";
import test from "node:test";

import { HttpClient } from "../server/http-client.mjs";

test("外部HTTP本文を宣言サイズと実受信サイズの両方で制限する", async () => {
  const client = new HttpClient();
  const declaredLarge = new Response("small", { headers: { "content-length": "100" } });
  await assert.rejects(() => client.readBuffer(declaredLarge, 10), /大きすぎます/);

  const actualLarge = new Response("x".repeat(20));
  await assert.rejects(() => client.readBuffer(actualLarge, 10), /大きすぎます/);
});
