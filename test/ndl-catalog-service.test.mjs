import assert from "node:assert/strict";
import test from "node:test";

import { NdlCatalogService } from "../server/ndl-catalog-service.mjs";

const ndlXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <channel>
    <item>
      <title>作品名</title>
      <dc:creator>著者名</dc:creator>
      <dc:publisher>出版社</dc:publisher>
      <dcterms:issued>2026</dcterms:issued>
      <dc:identifier type="ISBN">9780306406157</dc:identifier>
      <category>図書</category>
      <link>https://example.test/book</link>
    </item>
  </channel>
</rss>`;

test("NDL候補を共通モデルへ変換し、同じ検索語を短期キャッシュする", async () => {
  let requestCount = 0;
  const service = new NdlCatalogService({
    httpClient: {
      async request() {
        requestCount += 1;
        return new Response(ndlXml, { status: 200, headers: { "content-type": "application/xml" } });
      },
    },
    now: () => 1000,
  });

  const first = await service.suggestBooks("作品名");
  const second = await service.suggestBooks("作品名");

  assert.equal(first[0].title, "作品名");
  assert.equal(first[0].isbn, "9780306406157");
  assert.deepEqual(second, first);
  assert.equal(requestCount, 1);
});
