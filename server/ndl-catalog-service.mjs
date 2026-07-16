import { XMLParser } from "fast-xml-parser";

import { normalizedSeriesName, parseVolumeNumber } from "./book-model.mjs";
import { stripIsbn } from "./isbn.mjs";

const NDL_HEADERS = {
  accept: "application/rss+xml,application/xml,text/xml,*/*",
  referer: "https://ndlsearch.ndl.go.jp/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
};

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
   * @returns {Promise<object[]>} ISBN重複を除いた最大8件の候補。
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
   * 読書傾向からの推薦候補として、同じ著者の図書をISBN単位で返す。
   * 候補の採否と所蔵済み除外はRecommendationServiceが担当する。
   *
   * @param {string} creator 検証済み著者名。
   * @returns {Promise<object[]>} 最大30件の図書候補。
   */
  async findBooksByCreator(creator) {
    const items = await this.#fetchItems({ creator }, 40, 15000, "著者別推薦検索");
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

  #toSuggestion(item) {
    const categories = asArray(item.category).map(firstText);
    const isbn = itemIsbn(item);
    return {
      title: firstText(item.title),
      author: firstText(item.creator),
      publisher: firstText(item.publisher),
      published: firstText(item.issued || item.date),
      isbn,
      url: ndlPageUrl(firstText(item.link)),
      coverUrl: "",
      isBook: categories.includes("図書"),
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
