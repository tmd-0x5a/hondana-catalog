import assert from "node:assert/strict";
import test from "node:test";

import { NdlCatalogService } from "../server/ndl-catalog-service.mjs";

const ndlXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <channel>
    <item>
      <title>作品名</title>
      <dc:volume>1</dc:volume>
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
      async getText() {
        requestCount += 1;
        return ndlXml;
      },
    },
    now: () => 1000,
  });

  const first = await service.suggestBooks("作品名");
  const second = await service.suggestBooks("作品名");

  assert.equal(first[0].title, "作品名 1");
  assert.equal(first[0].isbn, "9780306406157");
  assert.deepEqual(second, first);
  assert.equal(requestCount, 1);
});

test("著者別推薦はcreatorパラメータを使い図書候補を返す", async () => {
  let requestedUrl = "";
  const service = new NdlCatalogService({
    httpClient: {
      async getText(url) {
        requestedUrl = url.href;
        return ndlXml;
      },
    },
  });

  const recommendations = await service.findBooksByCreator("著者名");

  assert.equal(new URL(requestedUrl).searchParams.get("creator"), "著者名");
  assert.equal(recommendations[0].isbn, "9780306406157");
});

test("スクリーンショット候補は複数書名を1回のSRU検索へまとめる", async () => {
  let requestedUrl = "";
  const service = new NdlCatalogService({
    httpClient: {
      async getText(url) {
        requestedUrl = url.href;
        return `<?xml version="1.0" encoding="UTF-8"?>
          <searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
            <records><record><recordData>
              <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/">
                <dcndl:BibResource>
                  <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">978-0-306-40615-7</dcterms:identifier>
                  <dcterms:title>つくりながら学ぶ!LLM自作入門</dcterms:title>
                  <dc:creator>Sebastian Raschka 他</dc:creator>
                  <dcterms:publisher><foaf:Agent><foaf:name>マイナビ出版</foaf:name></foaf:Agent></dcterms:publisher>
                  <dcterms:issued>2025</dcterms:issued>
                  <rdfs:seeAlso xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" rdf:resource="https://ndlsearch.ndl.go.jp/books/example" />
                </dcndl:BibResource>
              </rdf:RDF>
            </recordData></record></records>
          </searchRetrieveResponse>`;
      },
    },
  });

  const suggestions = await service.suggestBooksBatch([
    "つくりながら学ぶ! LLM自作入門",
    "世界一流エンジニアの思考法",
    "体系的に学ぶ安全な Webアプリケーションの作り方第2版脆弱性の実践",
  ]);

  const requested = new URL(requestedUrl);
  assert.equal(requested.pathname, "/api/sru");
  assert.match(requested.searchParams.get("query"), /title = "つくりながら学ぶ!LLM自作入門"/);
  assert.match(requested.searchParams.get("query"), /title = "世界一流エンジニアの思考法"/);
  assert.match(requested.searchParams.get("query"), /title = "安全なWebアプリケーションの作り方"/);
  assert.equal(suggestions[0].isbn, "9780306406157");
  assert.equal(suggestions[0].author, "Sebastian Raschka 他");
  assert.equal(suggestions[0].publisher, "マイナビ出版");
});
