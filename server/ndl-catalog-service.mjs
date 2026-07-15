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
  if (first && typeof first === "object") return String(first["#text"] || "");
  return String(first || "");
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

/** NDLサーチのXML変換、候補順位、シリーズ巻の重複排除、短期キャッシュを担当する。 */
export class NdlCatalogService {
  constructor({ httpClient, cacheTtlMs = 10 * 60 * 1000, now = Date.now }) {
    this.httpClient = httpClient;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.suggestionCache = new Map();
    this.parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
  }

  async suggestBooks(query) {
    const cacheKey = query.normalize("NFKC").toLocaleLowerCase("ja");
    const cached = this.suggestionCache.get(cacheKey);
    if (cached && this.now() - cached.savedAt < this.cacheTtlMs) return cached.items;

    const items = await this.#fetchItems(query, 40, 12000, "書籍候補検索");
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

  async findSeriesVolumes(seriesName) {
    const items = await this.#fetchItems(seriesName, 100, 25000, "シリーズ検索");
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

  async #fetchItems(title, count, timeoutMs, errorLabel) {
    const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
    url.searchParams.set("cnt", String(count));
    url.searchParams.set("title", title);
    const response = await this.httpClient.request(url, { timeoutMs, headers: NDL_HEADERS });
    if (!response.ok) throw new Error(`${errorLabel} HTTP ${response.status}`);
    const parsed = this.parser.parse(await response.text());
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
      url: firstText(item.link),
      coverUrl: isbn ? `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg` : "",
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
      url: firstText(item.link),
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
