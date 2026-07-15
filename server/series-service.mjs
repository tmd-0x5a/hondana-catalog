import { normalizedSeriesName } from "./book-model.mjs";
import { httpError } from "./http-error.mjs";

function seriesStatusMessage(latest, nextAvailable) {
  if (!latest) return "シリーズの巻情報を確認できませんでした。シリーズ名を調整してください。";
  if (nextAvailable) return `${nextAvailable.volumeNumber}巻が登録可能です。`;
  return `確認できた最新${latest.volumeNumber}巻まで登録済みです。`;
}

/** 所持巻とNDLの刊行巻を比較し、シリーズ追跡結果を全所持巻へ反映する。 */
export class SeriesService {
  constructor({ repository, catalogService, now = () => new Date().toISOString() }) {
    this.repository = repository;
    this.catalogService = catalogService;
    this.now = now;
  }

  async checkSeries(value) {
    const seriesName = String(value || "").trim();
    if (!seriesName) throw httpError(400, "シリーズ名を入力してください。");

    const catalog = await this.catalogService.findSeriesVolumes(seriesName);
    const books = await this.repository.readBooks();
    const seriesKey = normalizedSeriesName(seriesName);
    const matchingBooks = books.filter((book) => normalizedSeriesName(book.seriesName) === seriesKey);
    const ownedMax = Math.max(0, ...matchingBooks.map((book) => Number(book.volumeNumber) || 0));
    const latest = catalog.at(-1) || null;
    const nextAvailable = catalog.find((item) => item.volumeNumber > ownedMax) || null;
    const checkedAt = this.now();

    for (const book of matchingBooks) this.#applySeriesResult(book, latest, nextAvailable, checkedAt);
    if (matchingBooks.length) await this.repository.saveBooks(books);

    return {
      seriesName,
      ownedMax,
      latest,
      nextAvailable,
      hasNewVolume: Boolean(nextAvailable),
      checkedAt,
      count: catalog.length,
      message: seriesStatusMessage(latest, nextAvailable),
    };
  }

  async checkAllSeries() {
    const books = await this.repository.readBooks();
    const seriesNames = [...new Set(books
      .filter((book) => (book.category === "マンガ" || book.bookType === "manga") && book.seriesName)
      .map((book) => String(book.seriesName).trim())
      .filter(Boolean))];

    const results = [];
    // NDLへ大量の同時接続を行わず、シリーズ単位で失敗を分離する。
    for (const seriesName of seriesNames) {
      try {
        results.push(await this.checkSeries(seriesName));
      } catch (error) {
        results.push({ seriesName, error: error.message });
      }
    }
    return results;
  }

  #applySeriesResult(book, latest, nextAvailable, checkedAt) {
    book.seriesCheckedAt = checkedAt;
    book.seriesLatestVolume = latest?.volumeNumber || null;
    book.seriesLatestIsbn = latest?.isbn || "";
    book.seriesLatestPublished = latest?.published || "";
    book.seriesLatestTitle = latest?.title || "";
    book.seriesLatestUrl = latest?.url || "";
    book.nextVolumeNumber = nextAvailable?.volumeNumber || null;
    book.nextVolumeIsbn = nextAvailable?.isbn || "";
    book.nextVolumePublished = nextAvailable?.published || "";
    book.nextVolumeTitle = nextAvailable?.title || "";
    book.nextVolumeUrl = nextAvailable?.url || "";
    book.updatedAt = checkedAt;
  }
}
