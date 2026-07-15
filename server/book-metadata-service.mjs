import { inferBookClassification } from "./book-model.mjs";

function formatOpenBdDate(value = "") {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}年${Number(value.slice(4, 6))}月${Number(value.slice(6, 8))}日`;
}

function secureImageUrl(value = "") {
  return value.replace(/^http:\/\//, "https://").replace("&zoom=1", "&zoom=2");
}

function plainText(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** openBDとGoogle Booksを統合し、アプリ共通の書誌モデルを返す。 */
export class BookMetadataService {
  constructor({ httpClient, coverService }) {
    this.httpClient = httpClient;
    this.coverService = coverService;
  }

  async findByIsbn(isbn) {
    const [openBdResult, googleResult] = await Promise.allSettled([
      this.#lookupOpenBd(isbn),
      this.#lookupGoogleBooks(isbn),
    ]);
    const openBd = openBdResult.status === "fulfilled" ? openBdResult.value : null;
    const google = googleResult.status === "fulfilled" ? googleResult.value : null;
    const sources = [openBd?.source, google?.source].filter(Boolean);
    const remoteCoverUrl = openBd?.coverUrl || google?.coverUrl || "";
    const cachedCoverUrl = await this.coverService.ensureCachedCover(isbn, [remoteCoverUrl]);

    return {
      title: openBd?.title || google?.title || `ISBN ${isbn}`,
      author: openBd?.author || google?.author || "著者情報なし",
      publisher: openBd?.publisher || google?.publisher || "",
      published: openBd?.published || google?.published || "",
      pages: google?.pages || "",
      coverUrl: cachedCoverUrl || remoteCoverUrl,
      coverSource: cachedCoverUrl ? "国立国会図書館・書影API等" : "",
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
    const summary = data?.[0]?.summary;
    if (!summary) return null;
    return {
      title: summary.title || "",
      author: summary.author || "",
      publisher: summary.publisher || "",
      published: formatOpenBdDate(summary.pubdate || ""),
      coverUrl: secureImageUrl(summary.cover || ""),
      ...inferBookClassification(summary),
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
      title: info.title || "",
      author: Array.isArray(info.authors) ? info.authors.join("、") : "",
      publisher: info.publisher || "",
      published: info.publishedDate || "",
      pages: info.pageCount ? `${info.pageCount}ページ` : "",
      coverUrl: secureImageUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
      category: "その他",
      bookType: "book",
      seriesName: "",
      volumeNumber: null,
      tags: Array.isArray(info.categories) ? info.categories.slice(0, 3) : [],
      note: plainText(info.description || ""),
      source: "Google Books",
    };
  }
}
