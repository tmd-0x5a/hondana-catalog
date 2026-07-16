import { normalizedSeriesName } from "./book-model.mjs";
import { validateSearchText } from "./request-validation.mjs";

function seriesStatusMessage(latest, nextAvailable) {
  if (!latest) return "シリーズの巻情報を確認できませんでした。シリーズ名を調整してください。";
  if (nextAvailable) return `${nextAvailable.volumeNumber}巻が登録可能です。`;
  return `確認できた最新${latest.volumeNumber}巻まで登録済みです。`;
}

/** 所持巻とNDLの刊行巻を比較し、シリーズ追跡結果を全所持巻へ反映する。 */
export class SeriesService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./library-repository.mjs").LibraryRepository} dependencies.repository 保存境界。
   * @param {import("./ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL検索。
   * @param {() => string} [dependencies.now] ISO日時関数。
   */
  constructor({ repository, catalogService, now = () => new Date().toISOString() }) {
    this.repository = repository;
    this.catalogService = catalogService;
    this.now = now;
  }

  /**
   * @param {unknown} value シリーズ名。
   * @returns {Promise<object>} 所持最大巻、刊行最新巻、次に登録可能な巻。
   */
  async checkSeries(value) {
    const seriesName = validateSearchText(value, { minLength: 1, maxLength: 300, label: "シリーズ名" });

    const catalog = await this.catalogService.findSeriesVolumes(seriesName);
    const latest = catalog.at(-1) || null;
    const checkedAt = this.now();
    return this.repository.updateBooks((books) => {
      const seriesKey = normalizedSeriesName(seriesName);
      const matchingBooks = books.filter((book) => normalizedSeriesName(book.seriesName) === seriesKey);
      const ownedMax = Math.max(0, ...matchingBooks.map((book) => Number(book.volumeNumber) || 0));
      const nextAvailable = catalog.find((item) => item.volumeNumber > ownedMax) || null;
      for (const book of matchingBooks) this.#applySeriesResult(book, latest, nextAvailable, checkedAt);

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
    });
  }

  /**
   * 登録済みマンガシリーズを順番に確認し、一件の外部API失敗を他シリーズへ波及させない。
   *
   * @returns {Promise<object[]>} シリーズごとの確認結果またはエラー概要。
   */
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
