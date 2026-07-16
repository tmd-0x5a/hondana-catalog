/** @type {readonly string[]} APIと保存データで許可するカテゴリ。 */
export const BOOK_CATEGORIES = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];

const CATEGORY_INFERENCE_RULES = [
  { category: "技術", keywords: /Deep Learning|プログラミング|コンピュータ|AI|科学|技術|工学|情報処理/i },
  { category: "小説", keywords: /小説|文学|文芸|物語|novel/i },
  { category: "ビジネス", keywords: /ビジネス|経済|経営|仕事|自己啓発/i },
  { category: "思想・社会", keywords: /思想|社会|政治|哲学|歴史/i },
  { category: "実用", keywords: /実用|料理|健康|旅行|趣味|暮らし/i },
];

/**
 * @param {unknown} value 電子媒体名。
 * @returns {string} 既知の表記ゆれを統一した媒体名。
 */
export function normalizeElectronicPlatform(value = "") {
  const platform = String(value).trim();
  if (/^kindle$|amazon.*kindle/i.test(platform)) return "Amazon Kindle";
  if (/^dmm|dmm.*books?/i.test(platform)) return "DMMブックス";
  return platform;
}

/** @param {unknown} category カテゴリ候補。 @returns {boolean} 許可カテゴリならtrue。 */
export function isSupportedCategory(category) {
  return BOOK_CATEGORIES.includes(String(category || "").trim());
}

function hasLegacyMangaClassification(book) {
  return book.bookType === "manga";
}

function categorySearchText(book) {
  const tags = Array.isArray(book.tags) ? book.tags : [];
  return [book.title, book.shelf, ...tags].filter(Boolean).join(" ");
}

/**
 * カテゴリの決定順を一か所に固定する。
 * ユーザーが保存した値を最優先し、旧形式の互換情報、最後に補助的な語句推定を使う。
 *
 * @param {Partial<import("../src/types.js").Book>} book 正規化前の蔵書。
 * @returns {string} BOOK_CATEGORIESに含まれるカテゴリ。
 */
export function inferCategory(book = {}) {
  const savedCategory = String(book.category || "").trim();
  if (isSupportedCategory(savedCategory)) return savedCategory;
  if (hasLegacyMangaClassification(book)) return "マンガ";

  const searchableText = categorySearchText(book);
  const matchedRule = CATEGORY_INFERENCE_RULES.find((rule) => rule.keywords.test(searchableText));
  return matchedRule?.category || "その他";
}

/**
 * 古いbooks.jsonを含む保存データを、現在のUIが扱う一つの形へ正規化する。
 *
 * @param {Partial<import("../src/types.js").Book>} book 正規化前の蔵書。
 * @param {number} [index=0] sortOrderがない場合の既定順。
 * @returns {import("../src/types.js").Book} 現行形式の蔵書。
 */
export function applyBookDefaults(book, index = 0) {
  const format = book.format === "electronic" ? "electronic" : "physical";
  const category = inferCategory(book);
  return {
    ...book,
    titleReading: book.titleReading || "",
    authorReading: book.authorReading || "",
    category,
    bookType: category === "マンガ" ? "manga" : "book",
    format,
    physicalLocation: book.physicalLocation || (format === "physical" ? book.shelf || "未設定" : ""),
    electronicPlatform: normalizeElectronicPlatform(book.electronicPlatform) || (format === "electronic" ? "その他" : ""),
    electronicUrl: book.electronicUrl || "",
    seriesName: book.seriesName || "",
    volumeNumber: Number(book.volumeNumber) || null,
    reminderDate: book.reminderDate || "",
    reminderNote: book.reminderNote || "",
    seriesCheckedAt: book.seriesCheckedAt || "",
    seriesLatestVolume: Number(book.seriesLatestVolume) || null,
    seriesLatestIsbn: book.seriesLatestIsbn || "",
    seriesLatestPublished: book.seriesLatestPublished || "",
    seriesLatestTitle: book.seriesLatestTitle || "",
    seriesLatestUrl: book.seriesLatestUrl || "",
    nextVolumeNumber: Number(book.nextVolumeNumber) || null,
    nextVolumeIsbn: book.nextVolumeIsbn || "",
    nextVolumePublished: book.nextVolumePublished || "",
    nextVolumeTitle: book.nextVolumeTitle || "",
    nextVolumeUrl: book.nextVolumeUrl || "",
    sortOrder: Number.isFinite(Number(book.sortOrder)) ? Number(book.sortOrder) : index,
  };
}

/** @param {unknown} value 書名または巻表示。 @returns {number|null} 抽出できた巻数。 */
export function parseVolumeNumber(value = "") {
  const normalized = String(value).normalize("NFKC");
  const patterns = [
    /(?:VOL(?:UME)?\.?|第)\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*巻/i,
    /(?:^|[\s.:：-])(\d+(?:\.\d+)?)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * 書誌APIに分類情報がないときだけ使う補助推定で、利用者編集を最終判断とする。
 *
 * @param {Record<string, string>} summary openBD summary。
 * @returns {{category: string, bookType: "book"|"manga", seriesName: string, volumeNumber: number|null}} 推定分類。
 */
export function inferBookClassification(summary) {
  const title = summary.title || "";
  const label = `${summary.series || ""} ${title}`;
  const volumeNumber = parseVolumeNumber(summary.volume || title);
  const manga = /コミックス|コミック|漫画|ジャンプ|サンデー|マガジン|花とゆめ|ちゃお|りぼん/i.test(label)
    || Boolean(volumeNumber && /(?:VOL(?:UME)?\.?\s*\d+|\s\d+)\s*$/i.test(title));
  if (!manga) return { category: "その他", bookType: "book", seriesName: "", volumeNumber: null };

  let seriesName = title
    .replace(/\s*=.*?(?:VOL(?:UME)?\.?)\s*\d+(?:\.\d+)?\s*$/i, "")
    .replace(/\s*=.*?\s+\d+(?:\.\d+)?\s*$/i, "")
    .replace(/\s*(?:VOL(?:UME)?\.?|第)\s*\d+(?:\.\d+)?\s*(?:巻)?\s*$/i, "")
    .replace(/\s+\d+(?:\.\d+)?\s*$/, "")
    .trim();
  if (!seriesName) seriesName = title;
  return { category: "マンガ", bookType: "manga", seriesName, volumeNumber };
}

/**
 * @param {unknown} value シリーズ名。
 * @returns {string} 表記ゆれを除いた比較キー。
 */
export function normalizedSeriesName(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s・:：=＝「」『』〈〉《》～〜~\-—_]/g, "");
}
