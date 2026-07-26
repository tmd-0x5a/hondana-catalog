import { XMLParser } from "fast-xml-parser";

import { normalizedSeriesName, parseVolumeNumber } from "./book-model.mjs";
import { normalizeIsbn, stripIsbn } from "./isbn.mjs";

const NDL_HEADERS = {
  accept: "application/rss+xml,application/xml,text/xml,*/*",
  referer: "https://ndlsearch.ndl.go.jp/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
};

const SEARCH_PAGE_SIZE = 40;
/**
 * OpenSearchは全件数に関わらず先頭約500件までしか辿れないため、開始位置をその範囲へ収める。
 * 結果の偏りは開始位置ではなく検索語を変えて散らす。
 */
const MAX_SEARCH_OFFSET = 460 - SEARCH_PAGE_SIZE;

function clampedSearchOffset(offset) {
  return Math.min(Math.max(1, Math.floor(Number(offset) || 1)), MAX_SEARCH_OFFSET);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstText(value) {
  const first = asArray(value)[0];
  if (first && typeof first === "object") return String(first["#text"] || "").slice(0, 1000);
  return String(first || "").slice(0, 1000);
}

function itemIsbn(item) {
  const isbnIdentifier = asArray(item.identifier).find(
    (entry) => entry && typeof entry === "object" && String(entry["@_type"] || "").endsWith("ISBN"),
  );
  return isbnIdentifier ? stripIsbn(isbnIdentifier["#text"] || "") : "";
}

function titleMatchRank(titleKey, queryKey) {
  if (titleKey === queryKey) return 0;
  if (titleKey.startsWith(queryKey)) return 1;
  if (titleKey.includes(queryKey)) return 2;
  return 3;
}

function ndlPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "ndlsearch.ndl.go.jp" ? url.href : "";
  } catch {
    return "";
  }
}

function cqlTitleVariants(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const compact = normalized.replace(/\s+/g, "");
  const variants = [compact];
  // 「ダンダダン12」のような巻数付き書名は、NDLでは書名と巻数が別項目のため巻数なしでも検索する。
  const volumeSuffix = compact.match(/^(.{2,}?)[\s.:：·・]*([0-9]{1,3})$/);
  if (volumeSuffix && !/^[0-9]+$/.test(volumeSuffix[1])) variants.push(volumeSuffix[1]);
  const words = normalized.split(" ").filter(Boolean);
  if (/^[A-Za-z0-9._+-]+$/.test(words[0] || "") && words.length > 1) {
    variants.push(words.slice(1).join(""));
  }
  for (const marker of ["完全版", "第2版"]) {
    const markerIndex = compact.indexOf(marker);
    if (markerIndex >= 0) {
      const baseTitle = compact.slice(0, markerIndex);
      variants.push(baseTitle, compact.slice(0, markerIndex + marker.length));
      variants.push(baseTitle.replace(/^体系的に学ぶ/u, ""));
    }
  }
  return [...new Set(variants.filter((title) => title.length >= 2))];
}

function directText(value) {
  const direct = asArray(value).find((entry) => typeof entry === "string");
  return direct ? String(direct).slice(0, 1000) : "";
}

function agentName(value) {
  return asArray(value)
    .map((entry) => entry?.Agent?.name || entry?.name || "")
    .map(firstText)
    .find(Boolean) || "";
}

function sruResourceIsbn(resource) {
  const identifier = asArray(resource?.identifier).find(
    (entry) => entry && typeof entry === "object" && String(entry["@_datatype"] || "").endsWith("/ISBN"),
  );
  if (!identifier) return "";
  try {
    return normalizeIsbn(identifier["#text"] || "");
  } catch {
    return "";
  }
}

function sruResourceUrl(resource) {
  const link = asArray(resource?.seeAlso)
    .map((entry) => entry?.["@_resource"] || "")
    .find((value) => String(value).startsWith("https://ndlsearch.ndl.go.jp/books/"));
  return ndlPageUrl(link);
}

/** NDLサーチのXML変換、候補順位、シリーズ巻の重複排除、短期キャッシュを担当する。 */
export class NdlCatalogService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./http-client.mjs").HttpClient} dependencies.httpClient 外部HTTPクライアント。
   * @param {number} [dependencies.cacheTtlMs] 候補キャッシュ時間。
   * @param {() => number} [dependencies.now] ミリ秒時刻関数。
   */
  constructor({ httpClient, cacheTtlMs = 10 * 60 * 1000, now = Date.now }) {
    this.httpClient = httpClient;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.suggestionCache = new Map();
    this.parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      processEntities: false,
      trimValues: true,
    });
  }

  /**
   * @param {string} query 2文字以上200文字以内の検証済み検索語。
   * @returns {Promise<Array<Record<string, any>>>} ISBN重複を除いた最大8件の候補。
   */
  async suggestBooks(query) {
    const cacheKey = query.normalize("NFKC").toLocaleLowerCase("ja");
    const cached = this.suggestionCache.get(cacheKey);
    if (cached && this.now() - cached.savedAt < this.cacheTtlMs) return cached.items;

    const items = await this.#fetchItems({ title: query }, 40, 12000, "書籍候補検索");
    const queryTitleKey = normalizedSeriesName(query);
    const seenIsbns = new Set();
    const suggestions = items
      .map((item) => this.#toSuggestion(item))
      .filter((item) => item.isBook && item.title && item.isbn)
      .filter((item) => {
        if (seenIsbns.has(item.isbn)) return false;
        seenIsbns.add(item.isbn);
        return true;
      })
      .sort((left, right) => (
        titleMatchRank(normalizedSeriesName(left.title), queryTitleKey)
        - titleMatchRank(normalizedSeriesName(right.title), queryTitleKey)
      ))
      .slice(0, 8)
      .map(({ isBook, ...item }) => item);

    this.suggestionCache.set(cacheKey, { savedAt: this.now(), items: suggestions });
    this.#trimSuggestionCache();
    return suggestions;
  }

  /**
   * 複数のOCR書名をSRUのOR条件へまとめ、NDLへのアクセスを1回に抑える。
   * 候補の採否は呼び出し側が書名類似度で判断する。
   *
   * @param {string[]} queries OCR補正済みの書名。最大10件。
   * @returns {Promise<Array<Record<string, any>>>} ISBN重複を除いた書誌候補。
   */
  async suggestBooksBatch(queries) {
    const titles = [...new Set(asArray(queries).flatMap(cqlTitleVariants))].slice(0, 30);
    if (!titles.length) return [];
    const cacheKey = `batch:${titles.join("\u001f").toLocaleLowerCase("ja")}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached && this.now() - cached.savedAt < this.cacheTtlMs) return cached.items;

    const records = await this.#fetchBatchRecords(titles);
    const seenIsbns = new Set();
    const suggestions = records
      .map((record) => this.#toSruSuggestion(record))
      .filter((item) => item.title && item.isbn)
      .filter((item) => {
        if (seenIsbns.has(item.isbn)) return false;
        seenIsbns.add(item.isbn);
        return true;
      });
    this.suggestionCache.set(cacheKey, { savedAt: this.now(), items: suggestions });
    this.#trimSuggestionCache();
    return suggestions;
  }

  /**
   * @param {string} seriesName 検証済みシリーズ名。
   * @returns {Promise<import("../src/types.js").SeriesVolume[]>} 巻数ごとの初版候補。
   */
  async findSeriesVolumes(seriesName) {
    const items = await this.#fetchItems({ title: seriesName }, 100, 25000, "シリーズ検索");
    const seriesKey = normalizedSeriesName(seriesName);
    const candidates = items
      .map((item) => this.#toSeriesVolume(item, seriesKey))
      .filter((item) => item.isBook && item.matchesSeries && item.volumeNumber && item.isbn)
      .sort((left, right) => left.volumeNumber - right.volumeNumber);

    const firstEditionByVolume = new Map();
    for (const item of candidates) {
      if (!firstEditionByVolume.has(item.volumeNumber)) firstEditionByVolume.set(item.volumeNumber, item);
    }
    return [...firstEditionByVolume.values()].map(({ isBook, matchesSeries, ...item }) => item);
  }

  /**
   * 同じ著者の図書をISBN単位で返す。
   * 候補の採否と所蔵済み除外は呼び出し側が担当する。
   *
   * @param {string} creator 検証済み著者名。
   * @returns {Promise<Array<Record<string, any>>>} 最大30件の図書候補。
   */
  async findBooksByCreator(creator) {
    const items = await this.#fetchItems({ creator }, 40, 15000, "著者別推薦検索");
    return this.#uniqueBookSuggestions(items);
  }

  /**
   * 同じ出版社の図書を返す。蔵書のジャンルに近い本を探す用途で使う。
   * NDLはsubject（件名）指定を無視するため、ジャンル一致の代理として出版社を使う。
   *
   * @param {string} publisher 出版社名。
   * @param {object} [options] 検索条件。
   * @param {string} [options.titleHint] 書名に含まれる語。結果の偏りをなくすために使う。
   * @param {number} [options.offset=1] 検索結果の開始位置。
   * @returns {Promise<Array<Record<string, any>>>} 最大30件の図書候補。
   */
  async findBooksByPublisher(publisher, { titleHint = "", offset = 1 } = {}) {
    const parameters = { publisher, idx: String(clampedSearchOffset(offset)) };
    if (titleHint) parameters.title = titleHint;
    return this.#uniqueBookSuggestions(
      await this.#fetchItems(parameters, SEARCH_PAGE_SIZE, 15000, "出版社別候補検索"),
    );
  }

  /**
   * キーワードに一致する図書を返す。蔵書にないジャンルを開拓する用途で使う。
   *
   * @param {string} keyword 検索キーワード。
   * @param {object} [options] 検索条件。
   * @param {number} [options.offset=1] 検索結果の開始位置。
   * @returns {Promise<Array<Record<string, any>>>} 最大30件の図書候補。
   */
  async findBooksByKeyword(keyword, { offset = 1 } = {}) {
    return this.#uniqueBookSuggestions(
      await this.#fetchItems(
        { any: keyword, idx: String(clampedSearchOffset(offset)) },
        SEARCH_PAGE_SIZE,
        15000,
        "キーワード別候補検索",
      ),
    );
  }

  /** 図書かつISBNを持つ候補だけを、ISBN重複なしで最大30件返す。 */
  #uniqueBookSuggestions(items) {
    const seenIsbns = new Set();
    return items
      .map((item) => this.#toSuggestion(item))
      .filter((item) => item.isBook && item.title && item.isbn)
      .filter((item) => {
        if (seenIsbns.has(item.isbn)) return false;
        seenIsbns.add(item.isbn);
        return true;
      })
      .slice(0, 30)
      .map(({ isBook, coverUrl, ...item }) => item);
  }

  async #fetchItems(parameters, count, timeoutMs, errorLabel) {
    const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
    url.searchParams.set("cnt", String(count));
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    const xml = await this.httpClient.getText(url, {
      timeoutMs,
      headers: NDL_HEADERS,
      errorLabel,
      maxBytes: 4 * 1024 * 1024,
    });
    const parsed = this.parser.parse(xml);
    return asArray(parsed?.rss?.channel?.item);
  }

  async #fetchBatchRecords(titles) {
    const url = new URL("https://ndlsearch.ndl.go.jp/api/sru");
    url.searchParams.set("operation", "searchRetrieve");
    url.searchParams.set("maximumRecords", "500");
    url.searchParams.set("recordSchema", "dcndl");
    url.searchParams.set("recordPacking", "xml");
    url.searchParams.set("onlyBib", "true");
    // 空白付きの「 = 」は、書名中のAND/ORを演算子と誤認させないためのNDL推奨形式。
    url.searchParams.set("query", titles.map((title) => `title = "${title}"`).join(" OR "));
    const xml = await this.httpClient.getText(url, {
      timeoutMs: 30000,
      headers: NDL_HEADERS,
      errorLabel: "書籍一括候補検索",
      maxBytes: 4 * 1024 * 1024,
    });
    const parsed = this.parser.parse(xml);
    const response = parsed?.searchRetrieveResponse;
    const diagnostic = firstText(response?.diagnostics?.diagnostic?.message);
    if (diagnostic) throw new Error(`書籍一括候補検索: ${diagnostic}`);
    return asArray(response?.records?.record);
  }

  #toSuggestion(item) {
    const categories = asArray(item.category).map(firstText);
    const isbn = itemIsbn(item);
    const baseTitle = firstText(item.title);
    const volume = firstText(item.volume);
    const title = volume && !normalizedSeriesName(baseTitle).endsWith(normalizedSeriesName(volume))
      ? `${baseTitle} ${volume}`
      : baseTitle;
    return {
      title,
      author: firstText(item.creator),
      publisher: firstText(item.publisher),
      published: firstText(item.issued || item.date),
      isbn,
      url: ndlPageUrl(firstText(item.link)),
      coverUrl: "",
      isBook: categories.includes("図書"),
    };
  }

  #toSruSuggestion(record) {
    const resources = asArray(record?.recordData?.RDF?.BibResource);
    const resource = resources.find((entry) => entry?.title && sruResourceIsbn(entry));
    if (!resource) return { title: "", author: "", publisher: "", published: "", isbn: "", url: "", coverUrl: "" };
    const baseTitle = firstText(resource.title);
    const volume = firstText(resource.volume);
    // OpenSearch側と同様に巻数を書名へ含め、巻数付きOCR書名との照合を可能にする。
    const title = volume && !normalizedSeriesName(baseTitle).endsWith(normalizedSeriesName(volume))
      ? `${baseTitle} ${volume}`
      : baseTitle;
    return {
      title,
      author: directText(resource.creator) || agentName(resource.creator),
      publisher: directText(resource.publisher) || agentName(resource.publisher),
      published: firstText(resource.issued || resource.date),
      isbn: sruResourceIsbn(resource),
      url: sruResourceUrl(resource),
      coverUrl: "",
    };
  }

  #toSeriesVolume(item, seriesKey) {
    const title = firstText(item.title);
    const categories = asArray(item.category).map(firstText);
    return {
      title,
      volumeNumber: parseVolumeNumber(item.volume || title),
      isbn: itemIsbn(item),
      published: firstText(item.issued || item.date),
      url: ndlPageUrl(firstText(item.link)),
      isBook: categories.includes("図書"),
      matchesSeries: normalizedSeriesName(title) === seriesKey,
    };
  }

  #trimSuggestionCache() {
    if (this.suggestionCache.size <= 80) return;
    const oldestKey = this.suggestionCache.keys().next().value;
    this.suggestionCache.delete(oldestKey);
  }
}
