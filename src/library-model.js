export const CATEGORY_OPTIONS = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];

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

export const PLATFORM_OPTIONS = PLATFORM_CATALOG.map((platform) => platform.name);

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatLabel(book) {
  return book.format === "electronic" ? "電子" : "実本";
}

export function locationLabel(book) {
  return book.format === "electronic"
    ? book.electronicPlatform || "媒体未設定"
    : book.physicalLocation || "場所未設定";
}

export function platformHomeUrl(name) {
  return PLATFORM_CATALOG.find((platform) => platform.name === name)?.url || "";
}

export function electronicBookUrl(book) {
  return book.electronicUrl || platformHomeUrl(book.electronicPlatform);
}

function normalizedSeriesName(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・:：『』「」【】()（）\-–—]/g, "");
}

/** 巻ごとの蔵書をシリーズ単位にまとめ、新刊リストが扱う代表データを作る。 */
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

/** 絞り込みと並び替えの順序を固定し、Reactの状態配列を変更せず表示用配列を返す。 */
export function filterAndSortBooks(books, filters) {
  const {
    categoryFilter,
    ownershipFilter,
    platformFilter,
    query,
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
    const reminderMatch = viewMode !== "reminders" || Boolean(book.reminderDate);
    const text = `${book.title} ${book.author} ${book.isbn} ${(book.tags || []).join(" ")} ${book.category} ${book.shelf} ${book.physicalLocation} ${book.electronicPlatform} ${book.seriesName}`.toLocaleLowerCase("ja");
    return statusMatch && ownershipMatch && categoryMatch && platformMatch && reminderMatch && (!normalized || text.includes(normalized));
  });

  const sorted = [...filtered];
  if (sortMode === "title") sorted.sort((a, b) => collator.compare(a.title || "", b.title || ""));
  else if (sortMode === "author") sorted.sort((a, b) => collator.compare(a.author || "", b.author || ""));
  else if (sortMode === "series") sorted.sort((a, b) => collator.compare(`${a.seriesName || a.title} ${String(a.volumeNumber || 0).padStart(4, "0")}`, `${b.seriesName || b.title} ${String(b.volumeNumber || 0).padStart(4, "0")}`));
  else if (sortMode === "location") sorted.sort((a, b) => collator.compare(locationLabel(a), locationLabel(b)));
  else if (sortMode === "manual") sorted.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  else sorted.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return sorted;
}
