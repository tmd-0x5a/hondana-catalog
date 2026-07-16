/** @type {readonly string[]} 画面で選択できるカテゴリ。 */
export const CATEGORY_OPTIONS = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];

/** @type {readonly {name: string, url: string, featured?: boolean}[]} 電子書籍媒体と公式ホームURL。 */
export const PLATFORM_CATALOG = [
  { name: "Amazon Kindle", url: "https://www.amazon.co.jp/kindle-dbs/storefront", featured: true },
  { name: "DMMブックス", url: "https://book.dmm.com/", featured: true },
  { name: "楽天Kobo", url: "https://books.rakuten.co.jp/e-book/", featured: true },
  { name: "BOOK☆WALKER", url: "https://bookwalker.jp/", featured: true },
  { name: "BookLive", url: "https://booklive.jp/", featured: true },
  { name: "ebookjapan", url: "https://ebookjapan.yahoo.co.jp/", featured: true },
  { name: "コミックシーモア", url: "https://www.cmoa.jp/" },
  { name: "honto", url: "https://honto.jp/ebook.html" },
  { name: "Kinoppy", url: "https://k-kinoppy.jp/" },
  { name: "Reader Store", url: "https://ebookstore.sony.jp/" },
  { name: "Renta!", url: "https://renta.papy.co.jp/" },
  { name: "まんが王国", url: "https://comic.k-manga.jp/" },
  { name: "Apple Books", url: "https://books.apple.com/jp/" },
  { name: "Google Play Books", url: "https://play.google.com/store/books" },
  { name: "PDF / EPUB（ローカル）", url: "" },
  { name: "自炊PDF", url: "" },
  { name: "その他", url: "" },
];

/** @type {string[]} 電子書籍媒体の選択肢。 */
export const PLATFORM_OPTIONS = PLATFORM_CATALOG.map((platform) => platform.name);

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

const KANA_ROWS = [
  { label: "あ行", characters: "あいうえおぁぃぅぇぉゔ" },
  { label: "か行", characters: "かきくけこがぎぐげご" },
  { label: "さ行", characters: "さしすせそざじずぜぞ" },
  { label: "た行", characters: "たちつてとだぢづでどっ" },
  { label: "な行", characters: "なにぬねの" },
  { label: "は行", characters: "はひふへほばびぶべぼぱぴぷぺぽ" },
  { label: "ま行", characters: "まみむめも" },
  { label: "や行", characters: "やゆよゃゅょ" },
  { label: "ら行", characters: "らりるれろ" },
  { label: "わ行", characters: "わをんゎ" },
];

/** @param {Date} [date=new Date()] 対象日。 @returns {string} ローカル日付のYYYY-MM-DD。 */
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** @param {import("./types.js").Book} book 蔵書。 @returns {"実本"|"電子"} 所有形態ラベル。 */
export function formatLabel(book) {
  return book.format === "electronic" ? "電子" : "実本";
}

/** @param {import("./types.js").Book} book 蔵書。 @returns {string} 所有形態に応じた場所・媒体。 */
export function locationLabel(book) {
  return book.format === "electronic"
    ? book.electronicPlatform || "媒体未設定"
    : book.physicalLocation || "場所未設定";
}

/** @param {string} name 電子媒体名。 @returns {string} 公式ホームURLまたは空文字。 */
export function platformHomeUrl(name) {
  return PLATFORM_CATALOG.find((platform) => platform.name === name)?.url || "";
}

/** @param {import("./types.js").Book} book 電子書籍。 @returns {string} 個別URLを優先した遷移先。 */
export function electronicBookUrl(book) {
  if (book.electronicUrl) {
    try {
      const url = new URL(book.electronicUrl);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
      // 古い保存データの不正URLは表示せず、既知媒体の公式URLへ戻す。
    }
  }
  return platformHomeUrl(book.electronicPlatform);
}

function normalizedSeriesName(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・:：『』「」【】()（）\-–—]/g, "");
}

/**
 * かなを行見出しへ、英数字を補助見出しへ、読みのない漢字を先頭文字へ変換する。
 *
 * @param {unknown} value 見出しに使う書名・著者名。
 * @returns {string} 「あ行」「A-Z」「山」などの棚見出し。
 */
export function initialSectionLabel(value) {
  const normalized = String(value || "").normalize("NFKC").trim().replace(/^[\s\p{P}\p{S}]+/u, "");
  if (!normalized) return "未設定";
  let first = normalized[0];
  const codePoint = first.codePointAt(0);
  if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
    first = String.fromCodePoint(codePoint - 0x60);
  }
  const kanaRow = KANA_ROWS.find((row) => row.characters.includes(first));
  if (kanaRow) return kanaRow.label;
  if (/[A-Za-z]/.test(first)) return "A-Z";
  if (/[0-9]/.test(first)) return "0-9";
  // 読みが取得できない漢字名も「漢字」に集約せず、先頭文字で探せる粒度を保つ。
  if (/\p{Script=Han}/u.test(first)) return first;
  return "その他";
}

/**
 * 巻ごとの蔵書をシリーズ単位にまとめ、新刊リストが扱う代表データを作る。
 *
 * @param {import("./types.js").Book[]} books 全蔵書。
 * @returns {object[]} シリーズ別の所持巻・最新巻・次巻情報。
 */
export function buildSeriesGroups(books) {
  const groups = new Map();
  for (const book of books) {
    if (!(book.category === "マンガ" || book.bookType === "manga") || !book.seriesName) continue;
    const key = normalizedSeriesName(book.seriesName);
    const current = groups.get(key) || { key, seriesName: book.seriesName, books: [] };
    current.books.push(book);
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group.books].sort((a, b) => Number(b.volumeNumber || 0) - Number(a.volumeNumber || 0));
    const source = ordered.find((book) => book.nextVolumeNumber) || ordered[0];
    const formats = [...new Set(group.books.map(formatLabel))];
    const platforms = [...new Set(group.books
      .filter((book) => book.format === "electronic")
      .map((book) => book.electronicPlatform)
      .filter(Boolean))];

    return {
      ...group,
      representative: source,
      coverUrl: source.coverUrl,
      ownedMax: Math.max(0, ...group.books.map((book) => Number(book.volumeNumber) || 0)),
      latestVolume: Number(source.seriesLatestVolume) || null,
      nextVolumeNumber: Number(source.nextVolumeNumber) || null,
      nextVolumeIsbn: source.nextVolumeIsbn || "",
      nextVolumePublished: source.nextVolumePublished || "",
      nextVolumeTitle: source.nextVolumeTitle || "",
      nextVolumeUrl: source.nextVolumeUrl || "",
      ownershipLabel: platforms.length ? `${formats.join("・")} / ${platforms.join("・")}` : formats.join("・"),
    };
  });
}

/**
 * 並び替え済み蔵書を本棚カードへ変換し、同一シリーズを一つの項目に集約する。
 * 手動並び替え時は呼出側でgroupSeriesをfalseにし、各巻を直接操作できるようにする。
 *
 * @param {import("./types.js").Book[]} books 表示順が確定した蔵書。
 * @param {{groupSeries?: boolean}} [options] シリーズ集約設定。
 * @returns {Array<{kind: "book"|"series", key: string, book: import("./types.js").Book, books: import("./types.js").Book[], title: string}>} 本棚項目。
 */
export function buildShelfEntries(books, { groupSeries = true } = {}) {
  if (!groupSeries) {
    return books.map((book) => ({ kind: "book", key: `book:${book.id}`, book, books: [book], title: book.title }));
  }

  const entries = [];
  const seriesEntries = new Map();
  for (const book of books) {
    if (!book.seriesName) {
      entries.push({ kind: "book", key: `book:${book.id}`, book, books: [book], title: book.title });
      continue;
    }

    const seriesKey = normalizedSeriesName(book.seriesName);
    let entry = seriesEntries.get(seriesKey);
    if (!entry) {
      entry = {
        kind: "series",
        key: `series:${seriesKey}`,
        seriesKey,
        book,
        sectionBook: book,
        books: [],
        title: book.seriesName,
      };
      seriesEntries.set(seriesKey, entry);
      entries.push(entry);
    }
    entry.books.push(book);
  }

  return entries.map((entry) => {
    if (entry.kind === "book") return entry;
    const orderedVolumes = [...entry.books].sort((left, right) => Number(left.volumeNumber || 0) - Number(right.volumeNumber || 0));
    const representative = orderedVolumes.at(-1) || entry.book;
    return { ...entry, book: representative, books: orderedVolumes };
  });
}

function sectionValue(entry, sortMode) {
  // 集約後に代表書影を最新巻へ替えても、元の並び順を決めた先頭巻の見出しを維持する。
  const book = entry.sectionBook || entry.book;
  if (sortMode === "publisher") return book.publisher || "出版社不明";
  if (sortMode === "author") return initialSectionLabel(book.authorReading || book.author);
  if (sortMode === "title") return initialSectionLabel(book.titleReading || entry.title);
  if (sortMode === "series") return initialSectionLabel(book.titleReading || entry.title);
  if (sortMode === "location") return locationLabel(book);
  return "";
}

/**
 * 本棚項目を現在の並び順に対応する見出し単位へ分ける。
 * 見出し非表示時と新着・手動順では一つの無題セクションを返す。
 *
 * @param {ReturnType<typeof buildShelfEntries>} entries 本棚項目。
 * @param {string} sortMode 並び順。
 * @param {boolean} showHeaders 見出しを表示するか。
 * @returns {Array<{key: string, label: string, entries: ReturnType<typeof buildShelfEntries>}>} 棚セクション。
 */
export function buildShelfSections(entries, sortMode, showHeaders) {
  const groupedSortModes = new Set(["title", "author", "publisher", "series", "location"]);
  if (!showHeaders || !groupedSortModes.has(sortMode)) {
    return [{ key: "all", label: "", entries }];
  }

  const sections = new Map();
  for (const entry of entries) {
    const label = sectionValue(entry, sortMode);
    const section = sections.get(label) || { key: `${sortMode}:${label}`, label, entries: [] };
    section.entries.push(entry);
    sections.set(label, section);
  }
  return [...sections.values()];
}

/**
 * 絞り込みと並び替えの順序を固定し、Reactの状態配列を変更せず表示用配列を返す。
 *
 * @param {import("./types.js").Book[]} books 全蔵書。
 * @param {import("./types.js").BookFilters} filters 表示条件。
 * @returns {import("./types.js").Book[]} 新しい表示用配列。
 */
export function filterAndSortBooks(books, filters) {
  const {
    authorFilter = "all",
    categoryFilter,
    minimumRating = 0,
    ownershipFilter,
    platformFilter,
    publisherFilter = "all",
    query,
    seriesFilter = "all",
    sortMode,
    status,
    viewMode,
  } = filters;
  const normalized = query.trim().toLocaleLowerCase("ja");
  const filtered = books.filter((book) => {
    const statusMatch = status === "すべて" || book.status === status;
    const ownershipMatch = ownershipFilter === "all"
      || (ownershipFilter === "physical" ? book.format !== "electronic" : book.format === "electronic");
    const categoryMatch = categoryFilter === "all" || book.category === categoryFilter;
    const platformMatch = platformFilter === "all" || book.electronicPlatform === platformFilter;
    const publisherMatch = publisherFilter === "all" || book.publisher === publisherFilter;
    const authorMatch = authorFilter === "all" || book.author === authorFilter;
    const ratingMatch = Number(book.rating || 0) >= Number(minimumRating || 0);
    const seriesMatch = seriesFilter === "all"
      || (seriesFilter === "series" ? Boolean(book.seriesName) : !book.seriesName);
    const reminderMatch = viewMode !== "reminders" || Boolean(book.reminderDate);
    const text = `${book.title} ${book.titleReading} ${book.author} ${book.authorReading} ${book.publisher} ${book.isbn} ${(book.tags || []).join(" ")} ${book.category} ${book.shelf} ${book.physicalLocation} ${book.electronicPlatform} ${book.seriesName}`.toLocaleLowerCase("ja");
    return statusMatch && ownershipMatch && categoryMatch && platformMatch && publisherMatch
      && authorMatch && ratingMatch && seriesMatch && reminderMatch && (!normalized || text.includes(normalized));
  });

  const sorted = [...filtered];
  if (sortMode === "title") sorted.sort((a, b) => collator.compare(a.titleReading || a.title || "", b.titleReading || b.title || ""));
  else if (sortMode === "author") sorted.sort((a, b) => collator.compare(a.authorReading || a.author || "", b.authorReading || b.author || ""));
  else if (sortMode === "publisher") sorted.sort((a, b) => collator.compare(a.publisher || "出版社不明", b.publisher || "出版社不明"));
  else if (sortMode === "series") sorted.sort((a, b) => collator.compare(`${a.seriesName || a.title} ${String(a.volumeNumber || 0).padStart(4, "0")}`, `${b.seriesName || b.title} ${String(b.volumeNumber || 0).padStart(4, "0")}`));
  else if (sortMode === "location") sorted.sort((a, b) => collator.compare(locationLabel(a), locationLabel(b)));
  else if (sortMode === "manual") sorted.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  else sorted.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return sorted;
}
