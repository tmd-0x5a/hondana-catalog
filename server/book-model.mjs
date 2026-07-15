export const BOOK_CATEGORIES = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];

export function normalizeElectronicPlatform(value = "") {
  const platform = String(value).trim();
  if (/^kindle$|amazon.*kindle/i.test(platform)) return "Amazon Kindle";
  if (/^dmm|dmm.*books?/i.test(platform)) return "DMMブックス";
  return platform;
}

export function inferCategory(book = {}) {
  if (BOOK_CATEGORIES.includes(book.category)) return book.category;
  if (book.bookType === "manga") return "マンガ";

  const text = `${book.title || ""} ${book.shelf || ""} ${(book.tags || []).join(" ")}`;
  if (/Deep Learning|プログラミング|コンピュータ|AI|科学|技術|工学|情報処理/i.test(text)) return "技術";
  if (/小説|文学|文芸|物語|novel/i.test(text)) return "小説";
  if (/ビジネス|経済|経営|仕事|自己啓発/i.test(text)) return "ビジネス";
  if (/思想|社会|政治|哲学|歴史/i.test(text)) return "思想・社会";
  if (/実用|料理|健康|旅行|趣味|暮らし/i.test(text)) return "実用";
  return "その他";
}

/** 古いbooks.jsonを含む保存データを、現在のUIが扱う一つの形へ正規化する。 */
export function applyBookDefaults(book, index = 0) {
  const format = book.format === "electronic" ? "electronic" : "physical";
  const category = inferCategory(book);
  return {
    ...book,
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

/** 書誌APIに分類情報がないときだけ使う補助推定で、ユーザー編集を最終判断とする。 */
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

/** 表記ゆれのあるシリーズ名を、検索・グループ化に使える比較キーへ変換する。 */
export function normalizedSeriesName(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s・:：=＝「」『』〈〉《》～〜~\-—_]/g, "");
}
