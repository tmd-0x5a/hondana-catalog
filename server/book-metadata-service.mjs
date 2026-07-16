import { inferBookClassification } from "./book-model.mjs";
import { isAllowedCoverUrl } from "./cover-service.mjs";

function formatOpenBdDate(value = "") {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}年${Number(value.slice(4, 6))}月${Number(value.slice(6, 8))}日`;
}

function secureImageUrl(value = "") {
  return String(value || "").replace(/^http:\/\//, "https://").replace("&zoom=1", "&zoom=2");
}

function plainText(value = "") {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function limitedText(value, maxLength) {
  return plainText(value).slice(0, maxLength);
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** openBDのONIX照合キーから、書名と著者の読みを安全に取り出す。 */
function openBdReadings(record) {
  const detail = record?.onix?.DescriptiveDetail;
  const titleElement = firstValue(detail?.TitleDetail?.TitleElement);
  const contributors = Array.isArray(detail?.Contributor) ? detail.Contributor : [];
  return {
    titleReading: limitedText(titleElement?.TitleText?.collationkey, 300),
    authorReading: limitedText(contributors.map((contributor) => contributor?.PersonName?.collationkey).filter(Boolean).join("、"), 300),
  };
}

/** openBDとGoogle Booksを統合し、アプリ共通の書誌モデルを返す。 */
export class BookMetadataService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./http-client.mjs").HttpClient} dependencies.httpClient 外部HTTPクライアント。
   * @param {import("./cover-service.mjs").CoverService} dependencies.coverService 表紙キャッシュ。
   */
  constructor({ httpClient, coverService }) {
    this.httpClient = httpClient;
    this.coverService = coverService;
  }

  /**
   * openBDとGoogle Booksを並行照会し、片方が失敗しても利用可能な情報を統合する。
   *
   * @param {string} isbn 正規化済みISBN-13。
   * @returns {Promise<import("../src/types.js").BookMetadata>} アプリ共通書誌。
   */
  async findByIsbn(isbn) {
    const [openBdResult, googleResult] = await Promise.allSettled([
      this.#lookupOpenBd(isbn),
      this.#lookupGoogleBooks(isbn),
    ]);
    const openBd = openBdResult.status === "fulfilled" ? openBdResult.value : null;
    const google = googleResult.status === "fulfilled" ? googleResult.value : null;
    const sources = [openBd?.source, google?.source].filter(Boolean);
    // 一つ目の候補が壊れていても次へ進めるよう、APIごとの書影URLをすべて渡す。
    const remoteCoverUrls = [openBd?.coverUrl, google?.coverUrl].filter(isAllowedCoverUrl);
    const cachedCoverUrl = await this.coverService.ensureCachedCover(isbn, remoteCoverUrls);

    return {
      title: openBd?.title || google?.title || `ISBN ${isbn}`,
      titleReading: openBd?.titleReading || "",
      author: openBd?.author || google?.author || "著者情報なし",
      authorReading: openBd?.authorReading || "",
      publisher: openBd?.publisher || google?.publisher || "",
      published: openBd?.published || google?.published || "",
      pages: google?.pages || "",
      coverUrl: cachedCoverUrl,
      coverSource: cachedCoverUrl ? "openBD・Google Books・Open Library等" : "",
      category: openBd?.category || google?.category || "その他",
      bookType: openBd?.bookType || google?.bookType || "book",
      seriesName: openBd?.seriesName || google?.seriesName || "",
      volumeNumber: openBd?.volumeNumber || google?.volumeNumber || null,
      tags: google?.tags || [],
      note: google?.note || this.#fallbackNote(sources),
      metadataSource: sources.join(" + ") || "ISBNのみ",
    };
  }

  #fallbackNote(sources) {
    return sources.length
      ? "ISBNから自動登録しました。"
      : "書籍情報を取得できなかったため、ISBNのみ登録しました。後から編集できます。";
  }

  async #lookupOpenBd(isbn) {
    const data = await this.httpClient.getJson(
      `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`,
      { errorLabel: "openBD" },
    );
    const record = data?.[0];
    const summary = record?.summary;
    if (!summary) return null;
    return {
      title: limitedText(summary.title, 300),
      ...openBdReadings(record),
      author: limitedText(summary.author, 300),
      publisher: limitedText(summary.publisher, 200),
      published: limitedText(formatOpenBdDate(summary.pubdate || ""), 50),
      coverUrl: secureImageUrl(summary.cover || ""),
      ...inferBookClassification({
        title: limitedText(summary.title, 300),
        series: limitedText(summary.series, 300),
        volume: limitedText(summary.volume, 50),
      }),
      source: "openBD",
    };
  }

  async #lookupGoogleBooks(isbn) {
    const query = encodeURIComponent(`isbn:${isbn}`);
    const data = await this.httpClient.getJson(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&projection=full`,
      { errorLabel: "Google Books" },
    );
    const info = data?.items?.[0]?.volumeInfo;
    if (!info) return null;
    return {
      title: limitedText(info.title, 300),
      author: limitedText(Array.isArray(info.authors) ? info.authors.join("、") : "", 300),
      publisher: limitedText(info.publisher, 200),
      published: limitedText(info.publishedDate, 50),
      pages: info.pageCount ? `${info.pageCount}ページ` : "",
      coverUrl: secureImageUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
      category: "その他",
      bookType: "book",
      seriesName: "",
      volumeNumber: null,
      tags: Array.isArray(info.categories)
        ? info.categories.slice(0, 3).map((category) => limitedText(category, 50)).filter(Boolean)
        : [],
      note: limitedText(info.description, 5000),
      source: "Google Books",
    };
  }
}
