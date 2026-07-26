import { BOOK_CATEGORIES } from "./book-model.mjs";
import { normalizeIsbn, stripIsbn } from "./isbn.mjs";

const RECOMMENDED_SLOTS = 4;
const PACK_SIZE = RECOMMENDED_SLOTS + 1;
const CATALOG_INTERVAL_MS = 1_300;
const CANDIDATES_PER_SLOT = 30;
/** NDL OpenSearchが辿れる範囲に収めた開始位置の上限。 */
const MAX_SEARCH_OFFSET = 400;
/** 候補が見つからない枠を埋め直す上限。外部APIの呼び出し回数を抑えるために制限する。 */
const MAX_REFILL_ATTEMPTS = 2;
/**
 * 1枠あたりに試す検索位置の数。
 * NDLは書名順で並び、位置によってはISBNのない資料が続くため、数回だけ位置を変えて探す。
 */
const MAX_SLOT_ATTEMPTS = 3;

/**
 * 蔵書にないジャンルを開拓するための検索キーワード。
 * NDLは件名（subject）指定を無視するため、ジャンルごとに代表的な語を用意する。
 */
/**
 * 出版社検索に添える書名の語。
 * NDLは書名順の先頭約500件しか返さないため、位置ではなく語を変えて結果の窓を動かす。
 */
const TITLE_HINTS = [
  "", "入門", "実践", "基本", "教科書", "ガイド", "しくみ", "はじめて", "大全",
  "世界", "物語", "こころ", "仕事", "生活", "図鑑", "事典", "レシピ", "旅",
];

const GENRE_KEYWORDS = {
  "マンガ": "コミックス",
  "小説": "長編小説",
  "技術": "プログラミング 入門",
  "ビジネス": "ビジネス 入門",
  "思想・社会": "哲学 入門",
  "実用": "料理 レシピ",
  "その他": "教養 入門",
};

function normalizedTitle(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** @param {Date} date 基準日。 @returns {string} ローカル日付のYYYY-MM-DD。 */
export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 蔵書の冊数比率でジャンルを重み付き抽選する。同じジャンルが複数回選ばれてよい。
 *
 * @param {import("../src/types.js").Book[]} books 全蔵書。
 * @param {number} slots 抽選する枠数。
 * @param {() => number} random 乱数生成関数。ゼロ以上、一未満の値を返す。
 * @returns {string[]} 抽選されたジャンル。
 */
export function drawGenres(books, slots, random) {
  const counts = new Map();
  for (const book of books) {
    const genre = BOOK_CATEGORIES.includes(book.category) ? book.category : "その他";
    counts.set(genre, (counts.get(genre) || 0) + 1);
  }
  const weighted = [...counts.entries()].filter(([, count]) => count > 0);
  if (!weighted.length) return Array.from({ length: slots }, () => "その他");

  const total = weighted.reduce((sum, [, count]) => sum + count, 0);
  return Array.from({ length: slots }, () => {
    let threshold = random() * total;
    for (const [genre, count] of weighted) {
      threshold -= count;
      if (threshold < 0) return genre;
    }
    return weighted[weighted.length - 1][0];
  });
}

/**
 * レア枠のジャンルを選ぶ。未所蔵のジャンルを優先し、なければ最も冊数が少ないジャンルを使う。
 *
 * @param {import("../src/types.js").Book[]} books 全蔵書。
 * @param {() => number} random 乱数生成関数。ゼロ以上、一未満の値を返す。
 * @returns {string} レア枠のジャンル。
 */
export function drawRareGenre(books, random) {
  const counts = new Map(BOOK_CATEGORIES.map((genre) => [genre, 0]));
  for (const book of books) {
    const genre = BOOK_CATEGORIES.includes(book.category) ? book.category : "その他";
    counts.set(genre, counts.get(genre) + 1);
  }
  const unowned = [...counts].filter(([, count]) => count === 0).map(([genre]) => genre);
  if (unowned.length) return unowned[Math.floor(random() * unowned.length) % unowned.length];

  const fewest = [...counts].sort((left, right) => left[1] - right[1])[0];
  return fewest[0];
}

/**
 * 候補のISBNを13桁へ正規化する。
 * openBDはISBN-10を受け付けないため、書誌照会の前に必ず13桁へ揃える。
 *
 * @param {unknown} value 候補のISBN。
 * @returns {string} ISBN-13。正規化できない場合は空文字。
 */
function normalizedCandidateIsbn(value) {
  try {
    return normalizeIsbn(value);
  } catch {
    return "";
  }
}

/** 蔵書の登録に使える最小条件を満たす候補か。 */
function isUsableCandidate(candidate, excludedIsbns, excludedTitles) {
  const isbn = normalizedCandidateIsbn(candidate.isbn);
  if (!isbn || excludedIsbns.has(isbn)) return false;
  const titleKey = normalizedTitle(candidate.title);
  return Boolean(titleKey) && !excludedTitles.has(titleKey);
}

/** 蔵書のジャンル比率と未開拓ジャンルから、1日1回分のカードパックを組み立てる。 */
export class BookPackService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./library-repository.mjs").LibraryRepository} dependencies.repository 蔵書とパックの保存境界。
   * @param {import("./ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL候補検索。
   * @param {import("./book-metadata-service.mjs").BookMetadataService} dependencies.metadataService 紹介文と表紙の取得。
   * @param {() => Date} [dependencies.now] 現在日時を返す関数。
   * @param {() => number} [dependencies.random] 乱数生成関数。ゼロ以上、一未満の値を返す。
   * @param {(milliseconds: number) => Promise<void>} [dependencies.pause] 外部APIへの連続要求を抑える待機処理。
   */
  constructor({
    repository,
    catalogService,
    metadataService,
    now = () => new Date(),
    random = Math.random,
    pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }) {
    this.repository = repository;
    this.catalogService = catalogService;
    this.metadataService = metadataService;
    this.now = now;
    this.random = random;
    this.pause = pause;
    /** 生成中のPromise。同時要求で二重に外部APIを呼ばないために保持する。 */
    this.preparation = null;
    /** 生成の進み具合。画面へ「何冊目を探しているか」を伝えるために使う。 */
    this.progress = { completed: 0, total: PACK_SIZE };
  }

  /**
   * 今日のパックの状態を返す。生成には外部APIの照会が伴うため、待たせずに現在の状態だけを返す。
   * 未生成ならバックグラウンドで生成を始め、`preparing`として進捗を返す。
   *
   * @returns {Promise<{status: "ready"|"preparing", date: string, cards: object[], openedAt: string|null, progress: {completed: number, total: number}}>} 今日のパックの状態。
   */
  async getTodaysPack() {
    const today = localDateKey(this.now());
    const stored = await this.repository.readPack();
    if (stored?.date === today) {
      return { status: "ready", ...stored, progress: { completed: stored.cards.length, total: stored.cards.length } };
    }

    void this.prepareTodaysPack().catch(() => {});
    return { status: "preparing", date: today, cards: [], openedAt: null, progress: { ...this.progress } };
  }

  /**
   * 今日のパックを生成する。すでに生成中なら同じ処理を待つ。
   * サーバー起動直後に呼び出しておくことで、画面を開いたときには出来上がっている状態にする。
   *
   * @returns {Promise<{date: string, cards: object[], openedAt: string|null}>} 生成または保存済みのパック。
   */
  prepareTodaysPack() {
    if (this.preparation) return this.preparation;
    this.preparation = this.#preparePack().finally(() => { this.preparation = null; });
    return this.preparation;
  }

  async #preparePack() {
    const today = localDateKey(this.now());
    const stored = await this.repository.readPack();
    if (stored?.date === today) return stored;

    this.progress = { completed: 0, total: PACK_SIZE };
    const pack = { date: today, cards: await this.#buildCards(), openedAt: null };
    await this.repository.savePack(pack);
    return pack;
  }

  /**
   * 今日のパックを開封済みにする。開封日時は再訪時に演出を繰り返さないために使う。
   * 生成が終わっていない場合は完了を待ってから開封する。
   *
   * @returns {Promise<{status: "ready", date: string, cards: object[], openedAt: string|null, progress: {completed: number, total: number}}>} 開封済みパック。
   */
  async openTodaysPack() {
    const pack = await this.prepareTodaysPack();
    const openedPack = pack.openedAt ? pack : { ...pack, openedAt: this.now().toISOString() };
    if (!pack.openedAt) await this.repository.savePack(openedPack);
    return {
      status: "ready",
      ...openedPack,
      progress: { completed: openedPack.cards.length, total: openedPack.cards.length },
    };
  }

  async #buildCards() {
    const books = await this.repository.readBooks();
    const slots = [
      ...drawGenres(books, RECOMMENDED_SLOTS, this.random).map((genre) => ({ genre, rare: false })),
      { genre: drawRareGenre(books, this.random), rare: true },
    ];

    // 蔵書のISBNはISBN-13で保存されるが、旧データの表記ゆれに備えて素の桁も除外対象へ入れる。
    const excludedIsbns = new Set(books.flatMap((book) => [
      normalizedCandidateIsbn(book.isbn),
      stripIsbn(book.isbn),
    ]).filter(Boolean));
    const excludedTitles = new Set(books.map((book) => normalizedTitle(book.title)).filter(Boolean));

    const picked = [];
    const pendingSlots = [...slots];
    let refills = 0;
    let searchCount = 0;
    while (pendingSlots.length) {
      const slot = pendingSlots.shift();
      if (searchCount > 0) await this.pause(CATALOG_INTERVAL_MS);
      searchCount += 1;
      const candidate = await this.#pickCandidate(slot, books, excludedIsbns, excludedTitles);
      if (!candidate) {
        // 候補ゼロの枠は、別のランダム位置で数回だけ引き直してパックの枚数を保つ。
        if (refills < MAX_REFILL_ATTEMPTS) {
          refills += 1;
          pendingSlots.push(slot);
        }
        continue;
      }
      excludedIsbns.add(candidate.isbn);
      excludedTitles.add(normalizedTitle(candidate.title));
      picked.push(candidate);
      // 候補が決まった時点で進捗を進める。書誌の肉付けは後続でまとめて行う。
      this.progress = { completed: picked.length, total: PACK_SIZE };
    }

    const cards = [];
    for (const candidate of picked) {
      cards.push(await this.#toCard(candidate));
    }
    return cards;
  }

  /** ジャンル枠ごとに候補を探し、所蔵済みと既出を除いて1冊を選ぶ。紹介文のある本を優先する。 */
  async #pickCandidate({ genre, rare }, books, excludedIsbns, excludedTitles) {
    for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await this.pause(CATALOG_INTERVAL_MS);
      // 回を追うごとに条件を緩め、最後は必ず結果が返る素朴な検索へ落とす。
      const offset = attempt === MAX_SLOT_ATTEMPTS - 1
        ? 1
        : 1 + Math.floor(this.random() * (MAX_SEARCH_OFFSET >> attempt));
      let found;
      try {
        found = rare
          ? {
            candidates: await this.catalogService.findBooksByKeyword(GENRE_KEYWORDS[genre] || genre, { offset }),
            reason: `未開拓の${genre}`,
          }
          : await this.#searchOwnedGenre(genre, books, offset, attempt);
      } catch {
        // 一枠の検索が失敗しても、残りの枠でパックを作れるようにする。
        return null;
      }

      const usable = found.candidates
        .slice(0, CANDIDATES_PER_SLOT)
        .filter((candidate) => isUsableCandidate(candidate, excludedIsbns, excludedTitles))
        .map((candidate) => ({ ...candidate, isbn: normalizedCandidateIsbn(candidate.isbn) }));
      if (!usable.length) continue;

      const chosen = await this.#chooseWithDescription(usable);
      return { ...chosen, genre, rare, reason: found.reason };
    }
    return null;
  }

  /**
   * 候補の紹介文をopenBDへ一度だけ問い合わせ、紹介文を持つ本から優先的に選ぶ。
   * 紹介文付きが無ければ従来どおり無作為に選ぶ。
   */
  async #chooseWithDescription(candidates) {
    const descriptions = typeof this.metadataService.findDescriptionsByIsbns === "function"
      ? await this.metadataService.findDescriptionsByIsbns(candidates.map((candidate) => candidate.isbn))
      : new Map();
    const described = candidates.filter((candidate) => descriptions.get(candidate.isbn));
    const pool = described.length ? described : candidates;
    const chosen = pool[Math.floor(this.random() * pool.length) % pool.length];
    return { ...chosen, description: descriptions.get(chosen.isbn) || "" };
  }

  /** 蔵書のあるジャンルは、同ジャンルの出版社を手がかりに探す。出版社がなければ著者で探す。 */
  async #searchOwnedGenre(genre, books, offset, attempt = 0) {
    const genreBooks = books.filter((book) => (book.category || "その他") === genre);
    const publishers = [...new Set(genreBooks.map((book) => book.publisher).filter(Boolean))];
    if (publishers.length) {
      const publisher = publishers[Math.floor(this.random() * publishers.length) % publishers.length];
      // 最後の試行では書名の語を外し、その出版社の全体から確実に候補を得る。
      const titleHint = attempt === MAX_SLOT_ATTEMPTS - 1
        ? ""
        : TITLE_HINTS[Math.floor(this.random() * TITLE_HINTS.length) % TITLE_HINTS.length];
      return {
        candidates: await this.catalogService.findBooksByPublisher(publisher, { titleHint, offset }),
        reason: `${publisher}の本`,
      };
    }

    const authors = [...new Set(genreBooks
      .map((book) => book.author)
      .filter((author) => author && author !== "著者情報なし"))];
    if (!authors.length) return { candidates: [], reason: `${genre}の棚から` };
    const author = authors[Math.floor(this.random() * authors.length) % authors.length];
    return {
      candidates: await this.catalogService.findBooksByCreator(author),
      reason: `${author}と同じ著者`,
    };
  }

  /** 選出した1冊にだけ書誌を照会し、紹介文とローカル表紙を補う。取得できなくてもカードにする。 */
  async #toCard(candidate) {
    const isbn = candidate.isbn;
    const card = {
      isbn,
      title: candidate.title,
      author: candidate.author || "",
      publisher: candidate.publisher || "",
      published: candidate.published || "",
      url: candidate.url || "",
      coverUrl: `/api/covers/preview/${isbn}`,
      // 候補選定時にopenBDから得た紹介文を初期値にし、書誌照会が失敗しても残す。
      description: candidate.description || "",
      genre: candidate.genre,
      rare: candidate.rare,
      reason: candidate.reason || "",
    };
    try {
      const metadata = await this.metadataService.findByIsbn(isbn);
      // 書誌が見つからないとtitleは「ISBN 978...」の代替文になるため、NDLの書名を優先して残す。
      const hasRealTitle = metadata.title && !metadata.title.startsWith("ISBN ");
      return {
        ...card,
        title: hasRealTitle ? metadata.title : card.title,
        author: metadata.author && metadata.author !== "著者情報なし" ? metadata.author : card.author,
        publisher: metadata.publisher || card.publisher,
        published: metadata.published || card.published,
        coverUrl: metadata.coverUrl || card.coverUrl,
        description: metadata.description || card.description,
      };
    } catch {
      // 紹介文と表紙を取得できなくても、書誌情報だけのカードとして表示する。
      return card;
    }
  }
}

export { PACK_SIZE };
