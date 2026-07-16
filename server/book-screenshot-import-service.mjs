import { normalizeIsbn } from "./isbn.mjs";

const MAX_SEARCH_LINES = 10;
const IGNORED_UI_TEXT = /(電子書籍|ライブラリ|本棚|蔵書|ホーム|検索|メニュー|おすすめ|ランキング|購入|ダウンロード|並び替え|絞り込み|取り込み|登録|スクリーンショット|ISBN|未読|読了|新刊|リマインダ|所有形態|出版社|出版年|カテゴリ|実本|Amazon Kindle|DMMブックス|楽天Kobo|BOOK.WALKER|BookLive|ebookjapan)/iu;
const JAPANESE_OR_DIGIT = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー0-9\\-";
const SPACED_JAPANESE_PATTERN = new RegExp(`(?<=[${JAPANESE_OR_DIGIT}])\\s+(?=[${JAPANESE_OR_DIGIT}])`, "gu");

/**
 * Windows OCRが日本語の字間へ挿入した空白を除き、検索用の一行へ正規化する。
 *
 * @param {unknown} value OCR行。
 * @returns {string} 最大120文字の検索語候補。
 */
export function normalizeOcrLine(value) {
  let normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  normalized = normalized.replace(SPACED_JAPANESE_PATTERN, "");
  return normalized.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "").slice(0, 120);
}

function isbnFromLine(line) {
  const compact = line.replace(/[^0-9Xx]/g, "");
  if (![10, 13].includes(compact.length)) return "";
  try {
    return normalizeIsbn(compact);
  } catch {
    return "";
  }
}

function isPlausibleTitle(line) {
  if (line.length < 2 || line.length > 100) return false;
  if (IGNORED_UI_TEXT.test(line)) return false;
  if (/^[0-9.,%¥￥$\-]+$/.test(line)) return false;
  return /[\p{L}\p{N}]/u.test(line);
}

function titleLikelihood(line) {
  let score = line.length >= 4 && line.length <= 40 ? 4 : 0;
  if (/[0-9]+\s*巻|[0-9]+$/u.test(line)) score += 3;
  if (/[\p{Script=Katakana}ー]{3,}/u.test(line)) score += 3;
  if (/\p{Script=Han}.*\p{Script=Han}/u.test(line)) score += 2;
  if (/[A-Za-z]{3,}/.test(line)) score += 1;
  if ((line.match(/[・/|]/g) || []).length >= 2) score -= 5;
  return score;
}

function fallbackTitleQuery(line) {
  const corrected = line.replace(/(?<=\p{Script=Katakana})-(?=\p{Script=Katakana})/gu, "ー");
  if (corrected === line) return "";
  const katakanaParts = corrected.match(/[\p{Script=Katakana}ー]{3,}/gu) || [];
  return katakanaParts.sort((left, right) => right.length - left.length)[0] || "";
}

/** OCR行からNDL書誌候補を作る。登録判断は行わず、確認可能な候補だけを返す。 */
export class BookScreenshotImportService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./windows-ocr-service.mjs").WindowsOcrService} dependencies.ocrService ローカルOCR。
   * @param {import("./ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL候補検索。
   * @param {(milliseconds: number) => Promise<void>} [dependencies.pause] 外部APIへの連続要求を避ける待機処理。
   */
  constructor({ ocrService, catalogService, pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
    this.ocrService = ocrService;
    this.catalogService = catalogService;
    this.pause = pause;
  }

  /**
   * @param {Express.Multer.File[]} files 電子書店のスクリーンショット。
   * @returns {Promise<{documents: number, candidates: object[], unmatchedLines: string[], source: string}>} 確認画面用候補。
   */
  async scanScreenshots(files) {
    const documents = await this.ocrService.recognize(files);
    const uniqueLines = [...new Set(documents.flatMap((document) => document.lines).map(normalizeOcrLine).filter(Boolean))];
    const directIsbns = uniqueLines.map((line) => ({ line, isbn: isbnFromLine(line) })).filter((entry) => entry.isbn);
    const searchLines = uniqueLines
      .map((line, index) => ({ index, line, score: titleLikelihood(line) }))
      .filter(({ line }) => !isbnFromLine(line) && isPlausibleTitle(line))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ line }) => line)
      .slice(0, MAX_SEARCH_LINES);

    const searched = [];
    let catalogErrorCount = 0;
    for (let index = 0; index < searchLines.length; index += 1) {
      const sourceText = searchLines[index];
      if (index > 0) await this.pause(1_100);
      try {
        let suggestions = await this.catalogService.suggestBooks(sourceText);
        const fallbackQuery = fallbackTitleQuery(sourceText);
        if (!suggestions.length && fallbackQuery && fallbackQuery !== sourceText) {
          await this.pause(1_100);
          suggestions = await this.catalogService.suggestBooks(fallbackQuery);
        }
        searched.push({
          sourceText,
          suggestions: suggestions.slice(0, 5).map((suggestion) => ({
            ...suggestion,
            coverUrl: `/api/covers/preview/${encodeURIComponent(suggestion.isbn)}`,
          })),
        });
      } catch {
        catalogErrorCount += 1;
        searched.push({ sourceText, suggestions: [] });
        break;
      }
    }

    const candidates = [
      ...directIsbns.map(({ line, isbn }) => ({
        sourceText: line,
        suggestions: [{ title: `ISBN ${isbn}`, author: "", publisher: "", published: "", isbn, url: "", coverUrl: `/api/covers/preview/${isbn}` }],
      })),
      ...searched.filter((entry) => entry.suggestions.length > 0),
    ];
    const matchedLines = new Set(candidates.map((entry) => entry.sourceText));
    return {
      documents: documents.length,
      candidates,
      unmatchedLines: uniqueLines.filter((line) => isPlausibleTitle(line) && !matchedLines.has(line)).slice(0, 50),
      source: "Windows OCR / NDLサーチAPI",
      warning: catalogErrorCount > 0 ? "書誌APIが混み合っているため、一部の候補を取得できませんでした。時間を置いて再度お試しください。" : "",
    };
  }
}
