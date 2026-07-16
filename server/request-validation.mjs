import { BOOK_CATEGORIES } from "./book-model.mjs";
import { httpError } from "./http-error.mjs";
import { normalizeIsbn } from "./isbn.mjs";

const BOOK_FIELDS = new Set([
  "title",
  "titleReading",
  "author",
  "authorReading",
  "isbn",
  "publisher",
  "published",
  "pages",
  "status",
  "rating",
  "shelf",
  "tags",
  "note",
  "category",
  "format",
  "physicalLocation",
  "electronicPlatform",
  "electronicUrl",
  "seriesName",
  "volumeNumber",
  "reminderDate",
  "reminderNote",
]);
const UPDATE_FIELDS = new Set([...BOOK_FIELDS].filter((field) => field !== "isbn"));
const BULK_IMPORT_FIELDS = new Set(["format", "physicalLocation", "electronicPlatform", "entries"]);
const BULK_IMPORT_ENTRY_FIELDS = new Set(["isbn", "title", "author", "publisher"]);

const STRING_LIMITS = {
  title: 300,
  titleReading: 300,
  author: 300,
  authorReading: 300,
  publisher: 200,
  published: 50,
  pages: 50,
  shelf: 200,
  note: 5000,
  physicalLocation: 300,
  electronicPlatform: 100,
  seriesName: 300,
  reminderNote: 500,
};

function requirePlainObject(value, label) {
  const isPlainObject = value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  if (!isPlainObject) throw httpError(400, `${label}はJSONオブジェクトで指定してください。`);
  return value;
}

function rejectUnknownFields(input, allowedFields) {
  const unknownField = Object.keys(input).find((field) => !allowedFields.has(field));
  if (unknownField) throw httpError(400, `未対応の項目「${unknownField}」が含まれています。`);
}

function optionalString(input, field, maxLength) {
  if (input[field] === undefined) return undefined;
  if (typeof input[field] !== "string") throw httpError(400, `${field}は文字列で指定してください。`);
  const value = input[field].trim();
  if (value.length > maxLength) throw httpError(400, `${field}は${maxLength}文字以内で指定してください。`);
  return value;
}

function optionalEnum(input, field, allowedValues) {
  if (input[field] === undefined) return undefined;
  if (!allowedValues.includes(input[field])) {
    throw httpError(400, `${field}の値が正しくありません。`);
  }
  return input[field];
}

function optionalNumber(input, field, { min, max, integer = false }) {
  if (input[field] === undefined || input[field] === "" || input[field] === null) return input[field] === undefined ? undefined : null;
  const value = Number(input[field]);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw httpError(400, `${field}は${min}から${max}の範囲で指定してください。`);
  }
  return value;
}

function optionalTags(input) {
  if (input.tags === undefined) return undefined;
  if (!Array.isArray(input.tags) || input.tags.length > 30) {
    throw httpError(400, "tagsは30件以内の配列で指定してください。");
  }
  return input.tags.map((tag) => {
    if (typeof tag !== "string") throw httpError(400, "タグは文字列で指定してください。");
    const normalized = tag.trim();
    if (!normalized || normalized.length > 50) throw httpError(400, "タグは1文字以上50文字以内で指定してください。");
    return normalized;
  });
}

function optionalReminderDate(input) {
  if (input.reminderDate === undefined) return undefined;
  if (input.reminderDate === "") return "";
  if (typeof input.reminderDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.reminderDate)) {
    throw httpError(400, "reminderDateはYYYY-MM-DD形式で指定してください。");
  }
  const [year, month, day] = input.reminderDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isCalendarDate = date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
  if (!isCalendarDate) throw httpError(400, "reminderDateに存在する日付を指定してください。");
  return input.reminderDate;
}

function optionalHttpsUrl(input) {
  if (input.electronicUrl === undefined) return undefined;
  const value = optionalString(input, "electronicUrl", 2048);
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe URL");
    return url.href;
  } catch {
    throw httpError(400, "electronicUrlは認証情報を含まないHTTPS URLで指定してください。");
  }
}

function sanitizeBookFields(input) {
  const result = {};
  for (const [field, maxLength] of Object.entries(STRING_LIMITS)) {
    const value = optionalString(input, field, maxLength);
    if (value !== undefined) result[field] = value;
  }

  const category = optionalEnum(input, "category", BOOK_CATEGORIES);
  const format = optionalEnum(input, "format", ["physical", "electronic"]);
  const status = optionalEnum(input, "status", ["未読", "読了"]);
  const rating = optionalNumber(input, "rating", { min: 0, max: 5 });
  const volumeNumber = optionalNumber(input, "volumeNumber", { min: 0.1, max: 10000 });
  const tags = optionalTags(input);
  const reminderDate = optionalReminderDate(input);
  const electronicUrl = optionalHttpsUrl(input);

  for (const [field, value] of Object.entries({ category, format, status, rating, volumeNumber, tags, reminderDate, electronicUrl })) {
    if (value !== undefined) result[field] = value;
  }
  return result;
}

/**
 * 手動登録APIの本文を許可項目だけに絞り、型・長さ・列挙値を検証する。
 *
 * @param {unknown} value 信頼できないHTTPリクエスト本文。
 * @returns {Record<string, unknown>} 正規化済みの新規登録入力。
 * @throws {Error & {status: number}} 入力が仕様外の場合にstatus 400で例外を投げる。
 */
export function validateBookCreateInput(value) {
  const input = requirePlainObject(value, "登録内容");
  rejectUnknownFields(input, BOOK_FIELDS);
  const result = sanitizeBookFields(input);
  if (!result.title) throw httpError(400, "タイトルを入力してください。");
  if (input.isbn !== undefined) {
    if (typeof input.isbn !== "string" || input.isbn.length > 32) throw httpError(400, "isbnの形式が正しくありません。");
    result.isbn = input.isbn.trim() ? normalizeIsbn(input.isbn) : "";
  }
  return result;
}

/**
 * 蔵書更新APIの本文を編集可能項目だけに限定する。
 *
 * @param {unknown} value 信頼できないHTTPリクエスト本文。
 * @returns {Record<string, unknown>} 正規化済みの差分。
 * @throws {Error & {status: number}} 未対応項目、空の差分、型・長さ違反を検出した場合。
 */
export function validateBookUpdateInput(value) {
  const input = requirePlainObject(value, "更新内容");
  rejectUnknownFields(input, UPDATE_FIELDS);
  const result = sanitizeBookFields(input);
  if (!Object.keys(result).length) throw httpError(400, "更新する項目を指定してください。");
  if (result.title !== undefined && !result.title) throw httpError(400, "タイトルを空にできません。");
  return result;
}

/**
 * 一括取り込み本文を最大200件へ制限し、各行を書誌登録に必要な最小項目へ正規化する。
 *
 * @param {unknown} value 信頼できないHTTPリクエスト本文。
 * @returns {{format: "physical"|"electronic", physicalLocation: string, electronicPlatform: string, entries: Array<{isbn: string, title: string, author: string, publisher: string}>}} 検証済み入力。
 */
export function validateBulkImportInput(value) {
  const input = requirePlainObject(value, "一括取り込み内容");
  rejectUnknownFields(input, BULK_IMPORT_FIELDS);
  const format = optionalEnum(input, "format", ["physical", "electronic"]);
  if (!format) throw httpError(400, "所有形態を指定してください。");
  const physicalLocation = optionalString(input, "physicalLocation", 300) || "";
  const electronicPlatform = optionalString(input, "electronicPlatform", 100) || "";
  if (format === "electronic" && !electronicPlatform) throw httpError(400, "電子書籍媒体を指定してください。");
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 200) {
    throw httpError(400, "取り込みデータは1件以上200件以内で指定してください。");
  }

  const entries = input.entries.map((candidate, index) => {
    const entry = requirePlainObject(candidate, `${index + 1}行目`);
    rejectUnknownFields(entry, BULK_IMPORT_ENTRY_FIELDS);
    const title = optionalString(entry, "title", 300) || "";
    const author = optionalString(entry, "author", 300) || "";
    const publisher = optionalString(entry, "publisher", 200) || "";
    let isbn = "";
    if (entry.isbn !== undefined && entry.isbn !== "") {
      if (typeof entry.isbn !== "string" || entry.isbn.length > 32) throw httpError(400, `${index + 1}行目のISBN形式が正しくありません。`);
      try {
        isbn = normalizeIsbn(entry.isbn);
      } catch {
        throw httpError(400, `${index + 1}行目のISBN形式が正しくありません。`);
      }
    }
    if (!isbn && !title) throw httpError(400, `${index + 1}行目にISBNまたはタイトルを指定してください。`);
    return { isbn, title, author, publisher };
  });

  return {
    format,
    physicalLocation: format === "physical" ? physicalLocation || "未設定" : "",
    electronicPlatform: format === "electronic" ? electronicPlatform : "",
    entries,
  };
}

/**
 * URLパラメータで受け取る蔵書・アップロードIDを検証する。
 *
 * @param {unknown} value ID候補。
 * @param {string} [label="id"] エラーメッセージ用の項目名。
 * @returns {string} 検証済みID。
 */
export function validateResourceId(value, label = "id") {
  const id = String(value || "");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw httpError(400, `${label}の形式が正しくありません。`);
  return id;
}

/**
 * 手動並び替え用ID配列を検証し、文字列IDへ統一する。
 *
 * @param {unknown} value ID配列候補。
 * @returns {string[]} 重複のない検証済みID配列。
 */
export function validateReorderIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 10000) {
    throw httpError(400, "並び順は1件以上10000件以内の配列で指定してください。");
  }
  const ids = value.map((id) => validateResourceId(id, "蔵書ID"));
  if (new Set(ids).size !== ids.length) throw httpError(400, "並び順に同じ蔵書IDを重複して指定できません。");
  return ids;
}

/**
 * 外部書誌検索へ送る文字列を長さ制限付きで正規化する。
 *
 * @param {unknown} value 検索語候補。
 * @param {object} [options] 長さ条件。
 * @param {number} [options.minLength=1] 最小文字数。
 * @param {number} [options.maxLength=300] 最大文字数。
 * @param {string} [options.label="検索語"] 項目名。
 * @returns {string} 前後空白を除いた検索語。
 */
export function validateSearchText(value, { minLength = 1, maxLength = 300, label = "検索語" } = {}) {
  if (typeof value !== "string") throw httpError(400, `${label}は文字列で指定してください。`);
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw httpError(400, `${label}は${minLength}文字以上${maxLength}文字以内で指定してください。`);
  }
  return text;
}

/**
 * アップロード履歴の取得件数を1から100へ制限する。
 *
 * @param {unknown} value クエリ文字列。未指定時は10件。
 * @returns {number} 検証済み取得件数。
 */
export function validateUploadLimit(value) {
  if (value === undefined) return 10;
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) throw httpError(400, "limitは1から100の整数で指定してください。");
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw httpError(400, "limitは1から100の整数で指定してください。");
  return limit;
}
