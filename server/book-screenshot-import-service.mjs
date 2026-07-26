import { normalizeIsbn } from "./isbn.mjs";

const MAX_TITLES_PER_DOCUMENT = 12;
const MAX_SEARCH_TITLES = 60;
const CATALOG_BATCH_SIZE = 10;
const CATALOG_INTERVAL_MS = 1_300;
const CATALOG_RETRY_WAIT_MS = 4_000;
const IGNORED_UI_TEXT = /(電子書籍|ライブラリ|本棚|ホーム|検索|メニュー|おすすめ|ランキング|購入済み|レビューを書く|ダウンロード|並び替え|絞り込み|取り込み|登録|スクリーンショット|ISBN|未読|読了|新刊|リマインダー|所有形態|出版社|出版年|カテゴリ|実本|Amazon Kindle|DMMブックス|楽天Kobo|BOOK\.WALKER|BookLive|ebookjapan)/iu;
const CATEGORY_TEXT = /^(ビジネス|マン[ガカ]|少年マン[ガカ]|青年マン[ガカ]|少女マン[ガカ]|女性マン[ガカ]|小説|文学|雑誌|技術|技術書|実用|コミック|ライトノベル|写真集|その他)$/iu;
// 表紙・一覧に頻出するレーベル・出版社表記。書名として検索すると無関係な本へ誤マッチする。
const IMPRINT_TEXT = /^.{0,12}(コミックス|ノベル[ズス]|文庫|新書|ブックス|BOOKS|COMICS|BUNKO|出版|書店|書房|編集部)$/iu;
const JAPANESE_OR_DIGIT = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー0-9\\-";
const SPACED_JAPANESE_PATTERN = new RegExp(`(?<=[${JAPANESE_OR_DIGIT}])\\s+(?=[${JAPANESE_OR_DIGIT}])`, "gu");

/**
 * Windows OCRが日本語の字間へ挿入した空白を除き、検索可能な一行へ正規化する。
 *
 * @param {unknown} value OCR行または文字列。
 * @returns {string} 最大120文字の検索用文字列。
 */
export function normalizeOcrLine(value) {
  const rawText = value && typeof value === "object" ? /** @type {{text?: unknown}} */ (value).text : value;
  let normalized = String(rawText || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−ｰ]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  normalized = normalized.replace(SPACED_JAPANESE_PATTERN, "");
  normalized = normalized
    .replace(/\s+([!！?？・:：])/gu, "$1")
    .replace(/([・:：])\s+/gu, "$1")
    .replace(/(?<=[A-Za-z0-9])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "");
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
  if (line.length < 4 || line.length > 110) return false;
  if (IGNORED_UI_TEXT.test(line) || CATEGORY_TEXT.test(line) || IMPRINT_TEXT.test(line)) return false;
  if (/^[0-9.,%¥￥$-]+$/.test(line)) return false;
  return /[\p{L}\p{N}]/u.test(line);
}

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function lineRecord(value, documentIndex, lineIndex) {
  const text = normalizeOcrLine(value);
  if (!text) return null;
  const source = value && typeof value === "object" ? value : {};
  return {
    text,
    documentIndex,
    lineIndex,
    x: finiteCoordinate(source.x),
    y: finiteCoordinate(source.y),
    width: finiteCoordinate(source.width),
    height: finiteCoordinate(source.height),
  };
}

function hasGeometry(line) {
  return line.x !== null && line.y !== null && line.width !== null && line.height !== null;
}

/**
 * すぐ上により大きな文字の行がある行を著者・補足行とみなし、そのテキストを収集する。
 * 一覧・グリッドの両レイアウトで、書名ラベルの直下には小さめの著者名が並ぶ構造を利用する。
 * 同じ著者名は表紙アート上にも現れるため、テキスト単位で全出現を除外できるよう文字列で返す。
 */
function collectAuthorLikeTexts(records) {
  const authorTexts = new Set();
  for (const line of records) {
    if (!hasGeometry(line)) continue;
    const hasLargerLineAbove = records.some((other) => other !== line
      && hasGeometry(other)
      && Math.abs(other.x - line.x) <= Math.max(24, line.height * 1.5)
      && other.y < line.y
      && line.y - other.y <= (other.height + line.height) * 2.2
      && other.height >= line.height * 1.1
      && isPlausibleTitle(other.text));
    if (hasLargerLineAbove) authorTexts.add(line.text);
  }
  return authorTexts;
}

/**
 * 他の行に内容ごと含まれる行を除く。
 * 表紙アートのOCRは書名を途中で切った断片行を作るため、完全な書名ラベル行だけを残す。
 */
function mergeFragmentLines(records) {
  const keyed = records
    .map((line) => ({ line, key: comparableTitle(line.text) }))
    .filter((entry) => entry.key);
  return keyed
    .filter(({ line, key }) => !keyed.some((other) => other.line !== line
      && other.key.length > key.length
      && other.key.includes(key)))
    .map((entry) => entry.line);
}

/**
 * OCR文書ごとに書名候補行を選び、外部書誌APIへ送る書名を重複なしで返す。
 * 断片行の統合、著者行・レーベル行の除外を経て、1枚あたり最大12件・全体最大60件へ絞る。
 *
 * @param {Array<{width?: number, height?: number, lines?: unknown[]}>} documents OCR結果。
 * @returns {string[]} 書名候補。
 */
export function extractTitleQueries(documents) {
  const extracted = [];
  for (let documentIndex = 0; documentIndex < documents.length; documentIndex += 1) {
    const document = documents[documentIndex] || {};
    const records = (Array.isArray(document.lines) ? document.lines : [])
      .map((line, lineIndex) => lineRecord(line, documentIndex, lineIndex))
      .filter(Boolean);
    const authorTexts = collectAuthorLikeTexts(records);
    const titleLines = mergeFragmentLines(records
      .filter((line) => !authorTexts.has(line.text))
      .filter((line) => !isbnFromLine(line.text) && isPlausibleTitle(line.text)));
    extracted.push(...titleLines
      .sort((left, right) => ((left.y ?? left.lineIndex) - (right.y ?? right.lineIndex)) || ((left.x ?? 0) - (right.x ?? 0)))
      .map((line) => line.text)
      .slice(0, MAX_TITLES_PER_DOCUMENT));
  }
  return [...new Set(extracted)].slice(0, MAX_SEARCH_TITLES);
}

function correctedCatalogQuery(value) {
  return value
    .replace(/学ふ/g, "学ぶ")
    .replace(/工ンジニア/g, "エンジニア")
    .replace(/ラホ(?=の|を|が|$)/g, "ラボ")
    .replace(/(?<=\p{Script=Katakana})-(?=\p{Script=Katakana})/gu, "ー")
    .replace(/WebAPl/gi, "Web API");
}

function comparableTitle(value) {
  return correctedCatalogQuery(String(value || "").normalize("NFKC"))
    .toLocaleLowerCase("ja")
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .replace(/マンカ/g, "マンガ")
    // 巻数表記のゆれ（VOL.14、第14巻）を数字だけへ寄せる。
    .replace(/vol(?=[0-9])/g, "")
    .replace(/第([0-9]+)巻/g, "$1")
    // OCRが混同しやすい漢字とカタカナを比較用キーの中だけで統一する。両辺へ同じ変換を適用するため照合は破綻しない。
    .replace(/工/g, "エ")
    .replace(/力/g, "カ")
    .replace(/口/g, "ロ")
    .replace(/二/g, "ニ")
    .replace(/夕/g, "タ");
}

function bigramDice(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length === 1 || right.length === 1) return left === right ? 1 : 0;
  const rightCounts = new Map();
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    rightCounts.set(gram, (rightCounts.get(gram) || 0) + 1);
  }
  let matches = 0;
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    const count = rightCounts.get(gram) || 0;
    if (count > 0) {
      matches += 1;
      rightCounts.set(gram, count - 1);
    }
  }
  return (2 * matches) / (left.length + right.length - 2);
}

function trailingVolumeNumber(comparableKey) {
  const match = comparableKey.match(/(?:vol)?([0-9]+(?:\.[0-9]+)?)$/);
  return match ? Number(match[1]) : null;
}

function comparableSimilarity(source, candidate) {
  if (!source || !candidate) return 0;
  if (source === candidate) return 1;
  let score;
  if (source.includes(candidate) || candidate.includes(source)) {
    const lengthRatio = Math.min(source.length, candidate.length) / Math.max(source.length, candidate.length);
    score = 0.82 + 0.18 * lengthRatio;
  } else {
    score = bigramDice(source, candidate);
  }
  // 「シリーズ名 1」と「シリーズ名 14」のような別巻を、正しい巻より上位にしない。
  const sourceVolume = trailingVolumeNumber(source);
  const candidateVolume = trailingVolumeNumber(candidate);
  if (sourceVolume !== null && candidateVolume !== null && sourceVolume !== candidateVolume) {
    score = Math.min(score, 0.6);
  }
  return score;
}

/**
 * 「ダンダダン = DAN DA DAN. 12」のようなNDLの欧文並記書名から、和文書名と巻数だけを残す。
 *
 * @param {unknown} value 書誌APIの書名。
 * @returns {string} 並記がない場合は空文字。
 */
function strippedParallelTitle(value) {
  const text = String(value || "");
  const parallelIndex = text.indexOf(" = ");
  if (parallelIndex < 0) return "";
  const baseTitle = text.slice(0, parallelIndex);
  const trailingVolume = text.match(/([0-9]+(?:\.[0-9]+)?)\s*$/);
  return trailingVolume ? `${baseTitle} ${trailingVolume[1]}` : baseTitle;
}

/**
 * OCR書名と書誌候補の近さを0〜1で返す。空白・記号と既知のOCR誤認は比較から除外し、
 * 欧文並記付きの書誌タイトルは並記を除いた形とも比較する。
 *
 * @param {string} sourceTitle OCRから抽出した書名。
 * @param {string} candidateTitle 書誌APIが返した書名。
 * @returns {number} 0〜1の類似度。
 */
export function titleSimilarity(sourceTitle, candidateTitle) {
  const source = comparableTitle(sourceTitle);
  let score = comparableSimilarity(source, comparableTitle(candidateTitle));
  const stripped = strippedParallelTitle(candidateTitle);
  if (stripped) score = Math.max(score, comparableSimilarity(source, comparableTitle(stripped)));
  return score;
}

function similarityThreshold(sourceTitle) {
  const length = comparableTitle(sourceTitle).length;
  if (length >= 20) return 0.42;
  if (length >= 12) return 0.48;
  if (length >= 7) return 0.56;
  return 0.68;
}

/**
 * 書誌候補をOCR書名との類似度で厳格に選別し、無関係な検索結果を登録画面へ出さない。
 *
 * @template {{title?: string, isbn?: string}} T
 * @param {string} sourceTitle OCR書名。
 * @param {T[]} suggestions 書誌API候補。
 * @returns {T[]} 類似度順の候補。
 */
export function filterMatchingSuggestions(sourceTitle, suggestions) {
  const threshold = similarityThreshold(sourceTitle);
  return suggestions
    .map((suggestion) => ({ suggestion, score: titleSimilarity(sourceTitle, suggestion.title) }))
    .filter(({ score }) => score >= threshold)
    .sort((left, right) => right.score - left.score)
    .map(({ suggestion }) => suggestion);
}

/**
 * 一括検索の共有候補プールを各OCR書名へ割り当てる。
 * 同じ候補は最も類似する書名だけへ渡し、断片的な書名が別の本の候補を奪う誤マッチを防ぐ。
 *
 * @param {string[]} sourceTitles OCR書名。
 * @param {Array<{title?: string, isbn?: string}>} suggestions 一括検索の全候補。
 * @returns {Map<string, object[]>} 書名ごとの類似度順候補。
 */
export function assignSuggestionsToSources(sourceTitles, suggestions) {
  const assigned = new Map(sourceTitles.map((sourceTitle) => [sourceTitle, []]));
  for (const suggestion of suggestions) {
    let bestMatch = null;
    for (const sourceTitle of sourceTitles) {
      const score = titleSimilarity(sourceTitle, suggestion.title);
      if (score < similarityThreshold(sourceTitle)) continue;
      if (!bestMatch || score > bestMatch.score) bestMatch = { sourceTitle, score };
    }
    if (bestMatch) assigned.get(bestMatch.sourceTitle).push({ suggestion, score: bestMatch.score });
  }
  return new Map([...assigned].map(([sourceTitle, scored]) => [
    sourceTitle,
    scored.sort((left, right) => right.score - left.score).map((entry) => entry.suggestion),
  ]));
}

function isRateLimitError(error) {
  return /(?:HTTP\s*)?429|too many requests|rate limit/iu.test(String(error?.message || error || ""));
}

/** OCR書名抽出、NDL照合、候補の採否判定を調停する。 */
export class BookScreenshotImportService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {import("./windows-ocr-service.mjs").WindowsOcrService} dependencies.ocrService ローカルOCR。
   * @param {import("./ndl-catalog-service.mjs").NdlCatalogService} dependencies.catalogService NDL候補検索。
   * @param {(milliseconds: number) => Promise<void>} [dependencies.pause] 外部APIへの連続要求を抑える待機処理。
   */
  constructor({ ocrService, catalogService, pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
    this.ocrService = ocrService;
    this.catalogService = catalogService;
    this.pause = pause;
  }

  async #suggestWithRateLimitRetry(query) {
    try {
      return await this.catalogService.suggestBooks(query);
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      await this.pause(CATALOG_RETRY_WAIT_MS);
      return this.catalogService.suggestBooks(query);
    }
  }

  async #suggestBatchWithRateLimitRetry(queries) {
    try {
      return await this.catalogService.suggestBooksBatch(queries);
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      await this.pause(CATALOG_RETRY_WAIT_MS);
      return this.catalogService.suggestBooksBatch(queries);
    }
  }

  #candidateRow(sourceText, matchedSuggestions) {
    const matched = matchedSuggestions.slice(0, 5).map((suggestion) => ({
      ...suggestion,
      coverUrl: `/api/covers/preview/${encodeURIComponent(suggestion.isbn)}`,
    }));
    return {
      sourceText,
      suggestions: matched.length ? matched : [{
        title: correctedCatalogQuery(sourceText),
        author: "",
        publisher: "",
        published: "",
        isbn: "",
        url: "",
        coverUrl: "",
        metadataPending: true,
      }],
    };
  }

  /**
   * 一括SRU対応環境では10書名ずつのOR検索へ分割し、旧実装・テスト差し替えでは逐次検索する。
   * 一括検索の候補は最良一致の書名だけへ割り当て、別の本への誤マッチを抑える。
   */
  async #searchCatalog(searchTitles) {
    if (typeof this.catalogService.suggestBooksBatch === "function") {
      const pooledSuggestions = [];
      let errorCount = 0;
      for (let offset = 0; offset < searchTitles.length; offset += CATALOG_BATCH_SIZE) {
        if (offset > 0) await this.pause(CATALOG_INTERVAL_MS);
        const queries = searchTitles.slice(offset, offset + CATALOG_BATCH_SIZE).map(correctedCatalogQuery);
        try {
          pooledSuggestions.push(...await this.#suggestBatchWithRateLimitRetry(queries));
        } catch {
          errorCount += 1;
        }
      }
      const assigned = assignSuggestionsToSources(searchTitles, pooledSuggestions);
      return {
        rows: searchTitles.map((sourceText) => this.#candidateRow(sourceText, assigned.get(sourceText) || [])),
        errorCount,
      };
    }

    const rows = [];
    for (let index = 0; index < searchTitles.length; index += 1) {
      const sourceText = searchTitles[index];
      if (index > 0) await this.pause(CATALOG_INTERVAL_MS);
      try {
        const suggestions = await this.#suggestWithRateLimitRetry(correctedCatalogQuery(sourceText));
        rows.push(this.#candidateRow(sourceText, filterMatchingSuggestions(sourceText, suggestions)));
      } catch {
        rows.push(this.#candidateRow(sourceText, []));
        for (let remainingIndex = index + 1; remainingIndex < searchTitles.length; remainingIndex += 1) {
          rows.push(this.#candidateRow(searchTitles[remainingIndex], []));
        }
        return { rows, errorCount: 1 };
      }
    }
    return { rows, errorCount: 0 };
  }

  /**
   * @param {Express.Multer.File[]} files 電子書店のスクリーンショット。
   * @returns {Promise<{documents: number, candidates: object[], unmatchedLines: string[], source: string, warning: string}>} 確認画面用候補。
   */
  async scanScreenshots(files) {
    const documents = await this.ocrService.recognize(files);
    const uniqueLines = [...new Set(documents
      .flatMap((document) => Array.isArray(document.lines) ? document.lines : [])
      .map(normalizeOcrLine)
      .filter(Boolean))];
    const directIsbns = uniqueLines
      .map((line) => ({ line, isbn: isbnFromLine(line) }))
      .filter((entry) => entry.isbn);
    const searchTitles = extractTitleQueries(documents);

    const { rows: searched, errorCount: catalogErrorCount } = await this.#searchCatalog(searchTitles);

    const candidates = [
      ...directIsbns.map(({ line, isbn }) => ({
        sourceText: line,
        suggestions: [{
          title: `ISBN ${isbn}`,
          author: "",
          publisher: "",
          published: "",
          isbn,
          url: "",
          coverUrl: `/api/covers/preview/${isbn}`,
        }],
      })),
      ...searched.filter((entry) => entry.suggestions.length > 0),
    ];
    const matchedTitles = new Set(candidates.map((entry) => entry.sourceText));
    const metadataPendingCount = searched.filter((entry) => entry.suggestions[0]?.metadataPending).length;
    return {
      documents: documents.length,
      candidates,
      unmatchedLines: searchTitles.filter((title) => !matchedTitles.has(title)).slice(0, 50),
      source: "Windows OCR / NDLサーチAPI",
      warning: metadataPendingCount > 0
        ? `${metadataPendingCount}冊はISBNと表紙を取得できなかったため、OCRで抽出した書名のみで表示しています。そのまま登録して後から編集できます。`
        : catalogErrorCount > 0
          ? "書誌情報を取得できませんでした。OCRで抽出した書名のみで登録できます。"
        : "",
    };
  }
}
