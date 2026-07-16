import { stripIsbn } from "./isbn.mjs";

const MAX_SEEDS = 3;
const MAX_RECOMMENDATIONS = 8;

function normalizedTitle(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isUsableSeed(book) {
  const hasAuthor = book.author && book.author !== "著者情報なし";
  return hasAuthor && (book.status === "読了" || Number(book.rating || 0) > 0);
}

function seedPriority(left, right) {
  const ratingDifference = Number(right.rating || 0) - Number(left.rating || 0);
  if (ratingDifference) return ratingDifference;
  if (left.status !== right.status) return right.status === "読了" ? 1 : -1;
  return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
}

/** 読了・評価済み蔵書を種にNDL候補を選び、所蔵済みを除外する。 */
export class RecommendationService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./library-repository.mjs").LibraryRepository} dependencies.repository 蔵書保存境界。
   * @param {import("./ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL検索。
   */
  constructor({ repository, catalogService }) {
    this.repository = repository;
    this.catalogService = catalogService;
  }

  /**
   * 評価の高い本を優先して最大3著者を検索し、同じ本・同じISBNを除いた候補を返す。
   * NDLへの多重アクセスを避けるため著者検索は直列で行う。
   *
   * @returns {Promise<{recommendations: object[], seedCount: number, source: string}>} 推薦結果。
   */
  async listRecommendations() {
    const books = await this.repository.readBooks();
    const seeds = [...books].filter(isUsableSeed).sort(seedPriority);
    const distinctAuthors = [];
    for (const seed of seeds) {
      if (distinctAuthors.some((item) => item.author === seed.author)) continue;
      distinctAuthors.push(seed);
      if (distinctAuthors.length === MAX_SEEDS) break;
    }

    const ownedIsbns = new Set(books.map((book) => stripIsbn(book.isbn)).filter(Boolean));
    const ownedTitles = new Set(books.map((book) => normalizedTitle(book.title)).filter(Boolean));
    const recommendations = [];
    const candidateIsbns = new Set();
    for (const seed of distinctAuthors) {
      const candidates = await this.catalogService.findBooksByCreator(seed.author);
      for (const candidate of candidates) {
        const isbn = stripIsbn(candidate.isbn);
        if (!isbn || ownedIsbns.has(isbn) || candidateIsbns.has(isbn) || ownedTitles.has(normalizedTitle(candidate.title))) continue;
        candidateIsbns.add(isbn);
        recommendations.push({
          ...candidate,
          isbn,
          coverUrl: `/api/covers/preview/${isbn}`,
          reason: `${seed.title}と同じ著者`,
          seedRating: Number(seed.rating || 0),
        });
        if (recommendations.length === MAX_RECOMMENDATIONS) break;
      }
      if (recommendations.length === MAX_RECOMMENDATIONS) break;
    }

    return { recommendations, seedCount: distinctAuthors.length, source: "NDLサーチAPI" };
  }
}
