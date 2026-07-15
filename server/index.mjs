import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ZXing from "@zxing/library";
import express from "express";
import { XMLParser } from "fast-xml-parser";
import multer from "multer";
import QRCode from "qrcode";
import sharp from "sharp";

import { sampleBooks } from "../src/sampleBooks.js";
import {
  applyBookDefaults,
  inferBookClassification,
  normalizedSeriesName,
  parseVolumeNumber,
} from "./book-model.mjs";
import { normalizeIsbn, stripIsbn, validIsbn13 } from "./isbn.mjs";
import { createLibraryStore } from "./library-store.mjs";
import { buildOfflineLibraryHtml } from "./offline-library.mjs";

const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} = ZXing;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = process.env.HONDANA_DIST_DIR || path.join(ROOT_DIR, "dist");
const DATA_DIR = process.env.HONDANA_DATA_DIR || path.join(ROOT_DIR, "data");
const libraryStore = createLibraryStore({ dataDir: DATA_DIR, seedBooks: sampleBooks });
const { uploadDir: UPLOAD_DIR, coverDir: COVER_DIR } = libraryStore.paths;
const PORT = Number(process.env.PORT || 8080);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_request, file, callback) {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    callback(allowed.has(file.mimetype) ? null : new Error("画像ファイルを選択してください。"), allowed.has(file.mimetype));
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1d" }));
app.use("/covers", express.static(COVER_DIR, { maxAge: "30d" }));

await libraryStore.initialize();

/** 起動時に保存済みデータへ不足項目を補い、差分がある場合だけ永続化する。 */
async function migrateBookData() {
  const books = await libraryStore.readBooks();
  const migrated = books.map((book, index) => applyBookDefaults(book, index));
  // 実際に差分がある初回だけ書き戻し、起動のたびにファイル更新日時を変えない。
  if (JSON.stringify(books) !== JSON.stringify(migrated)) await libraryStore.saveBooks(migrated);
}

await migrateBookData();

/** iPhone向けURLが安定するよう、家庭LANで一般的なアドレス帯を優先して選ぶ。 */
function privateLanAddress() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));

  return (
    candidates.find((address) => address.startsWith("192.168.")) ||
    candidates.find((address) => address.startsWith("10.")) ||
    candidates[0] ||
    "127.0.0.1"
  );
}

function formatDate(value = "") {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}年${Number(value.slice(4, 6))}月${Number(value.slice(6, 8))}日`;
  }
  return value;
}

function secureImageUrl(value = "") {
  return value.replace(/^http:\/\//, "https://").replace("&zoom=1", "&zoom=2");
}

function plainText(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "HondanaCatalog/1.0" },
    });
    if (!response.ok) throw new Error(`書籍API HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** リモート表紙を検証・縮小してWebPへ統一し、以後は外部APIなしで表示できるようにする。 */
async function downloadCover(url, isbn, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
        ...headers,
      },
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return "";
    const image = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(image).metadata();
    // 書影APIが返す「画像なし」の小さなプレースホルダーは表紙として保存しない。
    if (!metadata.width || !metadata.height || metadata.width < 120 || metadata.height < 160) return "";

    const filename = `${isbn}.webp`;
    await sharp(image)
      .rotate()
      .resize({ width: 640, height: 960, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toFile(path.join(COVER_DIR, filename));
    return `/covers/${filename}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

/** APIが返した表紙、国会図書館、Open Libraryの順で試し、最初に使えた画像をキャッシュする。 */
async function ensureLocalCover(isbn, preferredUrls = []) {
  const filename = `${isbn}.webp`;
  if (fs.existsSync(path.join(COVER_DIR, filename))) return `/covers/${filename}`;

  const candidates = [
    ...preferredUrls.filter(Boolean).map((url) => ({ url, headers: {} })),
    {
      url: `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg`,
      headers: { referer: "https://ndlsearch.ndl.go.jp/" },
    },
    {
      url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
      headers: {},
    },
  ];

  for (const candidate of candidates) {
    const localUrl = await downloadCover(candidate.url, isbn, candidate.headers);
    if (localUrl) return localUrl;
  }
  return "";
}

async function lookupOpenBd(isbn) {
  const data = await fetchJson(`https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`);
  const item = data?.[0];
  if (!item) return null;
  const summary = item.summary || {};
  const classification = inferBookClassification(summary);
  return {
    title: summary.title || "",
    author: summary.author || "",
    publisher: summary.publisher || "",
    published: formatDate(summary.pubdate || ""),
    coverUrl: secureImageUrl(summary.cover || ""),
    ...classification,
    source: "openBD",
  };
}

async function lookupGoogleBooks(isbn) {
  const data = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&maxResults=1&projection=full`,
  );
  const info = data?.items?.[0]?.volumeInfo;
  if (!info) return null;
  return {
    title: info.title || "",
    author: Array.isArray(info.authors) ? info.authors.join("、") : "",
    publisher: info.publisher || "",
    published: info.publishedDate || "",
    pages: info.pageCount ? `${info.pageCount}ページ` : "",
    coverUrl: secureImageUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
    category: "その他",
    bookType: "book",
    seriesName: "",
    volumeNumber: null,
    tags: Array.isArray(info.categories) ? info.categories.slice(0, 3) : [],
    note: plainText(info.description || ""),
    source: "Google Books",
  };
}

/**
 * 複数の書誌APIを統合する。片方の障害で登録全体を止めないようallSettledを使い、
 * 日本語書誌はopenBD、説明・ページ数はGoogle Booksを優先して補完する。
 */
async function lookupBook(isbn) {
  const [openBdResult, googleResult] = await Promise.allSettled([
    lookupOpenBd(isbn),
    lookupGoogleBooks(isbn),
  ]);
  const openBd = openBdResult.status === "fulfilled" ? openBdResult.value : null;
  const google = googleResult.status === "fulfilled" ? googleResult.value : null;
  const sources = [openBd?.source, google?.source].filter(Boolean);
  const remoteCover = openBd?.coverUrl || google?.coverUrl || "";
  const coverUrl = await ensureLocalCover(isbn, [remoteCover]);

  return {
    title: openBd?.title || google?.title || `ISBN ${isbn}`,
    author: openBd?.author || google?.author || "著者情報なし",
    publisher: openBd?.publisher || google?.publisher || "",
    published: openBd?.published || google?.published || "",
    pages: google?.pages || "",
    coverUrl: coverUrl || remoteCover,
    coverSource: coverUrl ? "国立国会図書館・書影API等" : "",
    category: openBd?.category || google?.category || "その他",
    bookType: openBd?.bookType || google?.bookType || "book",
    seriesName: openBd?.seriesName || google?.seriesName || "",
    volumeNumber: openBd?.volumeNumber || google?.volumeNumber || null,
    tags: google?.tags || [],
    note:
      google?.note ||
      (sources.length
        ? "ISBNから自動登録しました。"
        : "書籍情報を取得できなかったため、ISBNのみ登録しました。後から編集できます。"),
    metadataSource: sources.join(" + ") || "ISBNのみ",
  };
}

/** スマホ写真でバーコードが置かれやすい領域を、全体画像と複数の帯に分けて返す。 */
function barcodeRegions(width, height) {
  const region = (topRatio, heightRatio, name) => ({
    left: 0,
    top: Math.max(0, Math.floor(height * topRatio)),
    width,
    height: Math.min(height - Math.floor(height * topRatio), Math.floor(height * heightRatio)),
    name,
  });

  return [
    region(0, 1, "full"),
    region(0, 0.52, "top-half"),
    region(0.48, 0.52, "bottom-half"),
    region(0.08, 0.38, "upper-band"),
    region(0.31, 0.38, "middle-band"),
    region(0.56, 0.38, "lower-band"),
  ].filter((item) => item.width > 80 && item.height > 80);
}

function decodeBarcodePixels(data, width, height, hints) {
  for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
    try {
      const source = new RGBLuminanceSource(new Uint8ClampedArray(data), width, height);
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      return reader.decodeWithState(new BinaryBitmap(new Binarizer(source))).getText();
    } catch {
      // The second binarizer often helps with unevenly lit phone photos.
    }
  }
  return "";
}

/** 指定領域だけを回転・正規化し、ZXingへ渡す画素数を抑えながらISBNを検証する。 */
async function decodeBarcodeRegion(oriented, region, angle, maxSize, hints, sharpen = false) {
  let pipeline = sharp(oriented)
    .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
    .rotate(angle)
    .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: false })
    .greyscale()
    .normalize();
  if (sharpen) pipeline = pipeline.sharpen({ sigma: 0.8 });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const text = decodeBarcodePixels(data, info.width, info.height, hints);
  const compact = stripIsbn(text);
  return validIsbn13(compact) && (compact.startsWith("978") || compact.startsWith("979")) ? compact : "";
}

/**
 * 典型的な配置を小さめ画像で先に試し、失敗時だけ全領域・全方向・シャープ化へ進む。
 * 読み取り速度と、傾いた暗い写真への耐性を両立するための2段階探索になっている。
 */
async function decodeBarcode(buffer) {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const { data: oriented, info: orientedInfo } = await sharp(buffer)
    .rotate()
    .toBuffer({ resolveWithObject: true });

  const regions = barcodeRegions(orientedInfo.width, orientedInfo.height);
  const fastRegions = ["bottom-half", "middle-band", "full"]
    .map((name) => regions.find((region) => region.name === name))
    .filter(Boolean);

  for (const region of fastRegions) {
    for (const angle of [0, 180]) {
      try {
        const isbn = await decodeBarcodeRegion(oriented, region, angle, 1400, hints);
        if (isbn) return isbn;
      } catch {
        // Fall through to the thorough pass for difficult photos.
      }
    }
  }

  for (const region of regions) {
    for (const angle of [0, 180, 90, 270]) {
      try {
        const isbn = await decodeBarcodeRegion(oriented, region, angle, 2200, hints, true);
        if (isbn) return isbn;
      } catch {
        // Continue through cropped bands and orientations until an ISBN is found.
      }
    }
  }

  throw Object.assign(
    new Error("ISBNバーコードを読み取れませんでした。バーコードを大きく、明るく撮影するかISBNを入力してください。"),
    { status: 422 },
  );
}

/** 過去データの欠けた表紙を補う。失敗しても本棚の起動や編集は妨げない。 */
async function backfillMissingCovers() {
  const books = await libraryStore.readBooks();
  let changed = false;
  for (const book of books) {
    if (book.coverUrl || !book.metadataSource) continue;
    try {
      const isbn = normalizeIsbn(book.isbn);
      const coverUrl = await ensureLocalCover(isbn);
      if (coverUrl) {
        book.coverUrl = coverUrl;
        book.coverSource = "国立国会図書館・書影API等";
        book.updatedAt = new Date().toISOString();
        changed = true;
      }
    } catch {
      // Keep the book usable even when a cover is unavailable.
    }
  }
  if (changed) await libraryStore.saveBooks(books);
}

function extensionFor(file) {
  const byMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  return byMime[file.mimetype] || path.extname(file.originalname).toLowerCase() || ".jpg";
}

async function saveImage(file) {
  const storedFilename = `${Date.now()}-${crypto.randomUUID()}${extensionFor(file)}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, storedFilename), file.buffer);
  return storedFilename;
}

/**
 * ISBNを一意キーとして登録または更新する。
 * 再取得した書誌で補完しつつ、読了状態・保管場所・手動並び順などの所蔵情報は保持する。
 */
async function addOrUpdateBook(isbn, uploadRecord = null) {
  const metadata = await lookupBook(isbn);
  const books = await libraryStore.readBooks();
  const existingIndex = books.findIndex((book) => stripIsbn(book.isbn) === isbn);
  const existing = existingIndex >= 0 ? books[existingIndex] : null;
  const firstSortOrder = books.length ? Math.min(...books.map((item) => Number(item.sortOrder) || 0)) : 0;
  const book = applyBookDefaults({
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    ...metadata,
    isbn,
    shelf: existing?.shelf || "新着 / 未整理",
    tags: metadata.tags.length ? metadata.tags : existing?.tags || ["自動登録"],
    status: existing?.status || "未読",
    rating: existing?.rating || 0,
    category: existing?.category || metadata.category || "その他",
    bookType: existing?.bookType || metadata.bookType || "book",
    format: existing?.format || "physical",
    physicalLocation: existing?.physicalLocation || "未設定",
    electronicPlatform: existing?.electronicPlatform || "",
    seriesName: existing?.seriesName || metadata.seriesName || "",
    volumeNumber: existing?.volumeNumber || metadata.volumeNumber || null,
    sortOrder: existing?.sortOrder ?? firstSortOrder - 1,
    uploadedImageUrl: uploadRecord ? `/uploads/${uploadRecord.storedFilename}` : existing?.uploadedImageUrl || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sprite: null,
  });

  if (existingIndex >= 0) books.splice(existingIndex, 1);
  books.unshift(book);
  await libraryStore.saveBooks(books);
  return { book, duplicate: existingIndex >= 0 };
}

async function saveUploadRecord(record) {
  const history = await libraryStore.readUploads();
  const index = history.findIndex((item) => item.id === record.id);
  if (index >= 0) history[index] = record;
  else history.unshift(record);
  await libraryStore.saveUploads(history.slice(0, 100));
  return record;
}

/** 画像アップロード履歴と蔵書更新を同じISBNで完了状態へ揃える。 */
async function finishUploadWithIsbn(record, value) {
  const isbn = normalizeIsbn(value);
  const { book, duplicate } = await addOrUpdateBook(isbn, record);
  const completed = {
    ...record,
    isbn,
    bookId: book.id,
    status: "success",
    message: duplicate ? "登録済みの本を更新しました。" : "本棚に登録しました。",
    completedAt: new Date().toISOString(),
  };
  await saveUploadRecord(completed);
  return { book, upload: completed, duplicate };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstText(value) {
  const first = asArray(value)[0];
  if (first && typeof first === "object") return String(first["#text"] || "");
  return String(first || "");
}

function itemIsbn(item) {
  const identifier = asArray(item.identifier).find(
    (entry) => entry && typeof entry === "object" && String(entry["@_type"] || "").endsWith("ISBN"),
  );
  return identifier ? stripIsbn(identifier["#text"] || "") : "";
}

const suggestionCache = new Map();

/** NDL候補を重複排除・タイトル一致度順に整え、連続入力によるAPI負荷を短期キャッシュで抑える。 */
async function fetchBookSuggestions(query) {
  const cacheKey = query.normalize("NFKC").toLocaleLowerCase("ja");
  const cached = suggestionCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 10 * 60 * 1000) return cached.items;

  const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
  url.searchParams.set("cnt", "40");
  url.searchParams.set("title", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml,application/xml,text/xml,*/*",
        referer: "https://ndlsearch.ndl.go.jp/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`書籍候補検索 HTTP ${response.status}`);
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
    const parsed = parser.parse(await response.text());
    const seen = new Set();
    const queryTitleKey = normalizedSeriesName(query);
    const items = asArray(parsed?.rss?.channel?.item)
      .map((item) => {
        const categories = asArray(item.category).map(firstText);
        const isbn = itemIsbn(item);
        return {
          title: firstText(item.title),
          author: firstText(item.creator),
          publisher: firstText(item.publisher),
          published: firstText(item.issued || item.date),
          isbn,
          url: firstText(item.link),
          coverUrl: isbn ? `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg` : "",
          isBook: categories.includes("図書"),
        };
      })
      .filter((item) => item.isBook && item.title && item.isbn)
      .filter((item) => {
        if (seen.has(item.isbn)) return false;
        seen.add(item.isbn);
        return true;
      })
      .sort((a, b) => {
        const aTitle = normalizedSeriesName(a.title);
        const bTitle = normalizedSeriesName(b.title);
        const score = (title) => title === queryTitleKey ? 0 : title.startsWith(queryTitleKey) ? 1 : title.includes(queryTitleKey) ? 2 : 3;
        return score(aTitle) - score(bTitle);
      })
      .slice(0, 8)
      .map(({ isBook, ...item }) => item);
    suggestionCache.set(cacheKey, { savedAt: Date.now(), items });
    if (suggestionCache.size > 80) suggestionCache.delete(suggestionCache.keys().next().value);
    return items;
  } finally {
    clearTimeout(timeout);
  }
}

/** 関連書籍の混入を避けるため、正規化後のタイトルがシリーズ名と一致する巻だけを採用する。 */
async function fetchSeriesCatalog(seriesName) {
  const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
  url.searchParams.set("cnt", "100");
  url.searchParams.set("title", seriesName);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml,application/xml,text/xml,*/*",
        referer: "https://ndlsearch.ndl.go.jp/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`シリーズ検索 HTTP ${response.status}`);
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    });
    const parsed = parser.parse(await response.text());
    const queryKey = normalizedSeriesName(seriesName);
    const candidates = asArray(parsed?.rss?.channel?.item)
      .map((item) => {
        const title = firstText(item.title);
        const categories = asArray(item.category).map(firstText);
        const volumeNumber = parseVolumeNumber(item.volume || title);
        return {
          title,
          volumeNumber,
          isbn: itemIsbn(item),
          published: firstText(item.issued || item.date),
          url: firstText(item.link),
          isBook: categories.includes("図書"),
          exactTitle: normalizedSeriesName(title) === queryKey,
        };
      })
      .filter((item) => item.isBook && item.exactTitle && item.volumeNumber && item.isbn)
      .sort((a, b) => a.volumeNumber - b.volumeNumber);

    const byVolume = new Map();
    for (const item of candidates) {
      if (!byVolume.has(item.volumeNumber)) byVolume.set(item.volumeNumber, item);
    }
    return [...byVolume.values()];
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "本棚カタログ", port: PORT });
});

app.get("/api/config", async (_request, response, next) => {
  try {
    const lanIp = privateLanAddress();
    const baseUrl = `http://${lanIp}:${PORT}`;
    const uploadUrl = `${baseUrl}/upload`;
    const checkUrl = `${baseUrl}/check`;
    response.json({
      lanIp,
      port: PORT,
      baseUrl,
      uploadUrl,
      checkUrl,
      qrCode: await QRCode.toDataURL(uploadUrl, { margin: 1, width: 196 }),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/offline-library", async (_request, response, next) => {
  try {
    const books = await libraryStore.readBooks();
    const snapshot = {
      syncedAt: new Date().toISOString(),
      books: books.map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        category: book.category,
        seriesName: book.seriesName,
        volumeNumber: book.volumeNumber,
        format: book.format,
        physicalLocation: book.physicalLocation,
        electronicPlatform: book.electronicPlatform,
      })),
    };
    response.set({
      "content-type": "text/html; charset=utf-8",
      "content-disposition": 'attachment; filename="hondana-pocket.html"',
      "cache-control": "no-store",
    });
    response.send(buildOfflineLibraryHtml(snapshot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/books", async (_request, response, next) => {
  try {
    response.json({ books: await libraryStore.readBooks() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/suggest", async (request, response, next) => {
  try {
    const query = String(request.query.q || "").trim();
    if (query.length < 2) return response.json({ suggestions: [] });
    response.json({ suggestions: await fetchBookSuggestions(query), source: "NDLサーチAPI" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books", async (request, response, next) => {
  try {
    const title = String(request.body.title || "").trim();
    if (!title) return response.status(400).json({ error: "タイトルを入力してください。" });
    const books = await libraryStore.readBooks();
    const firstSortOrder = books.length ? Math.min(...books.map((book) => Number(book.sortOrder) || 0)) : 0;
    const book = applyBookDefaults({
      id: crypto.randomUUID(),
      title,
      author: String(request.body.author || "著者情報なし"),
      isbn: stripIsbn(request.body.isbn || ""),
      publisher: String(request.body.publisher || ""),
      published: String(request.body.published || ""),
      pages: String(request.body.pages || ""),
      shelf: String(request.body.shelf || "未整理"),
      tags: Array.isArray(request.body.tags) ? request.body.tags : ["手動登録"],
      status: request.body.status === "読了" ? "読了" : "未読",
      rating: Number(request.body.rating) || 0,
      note: String(request.body.note || ""),
      category: String(request.body.category || "その他"),
      bookType: request.body.bookType,
      format: request.body.format,
      physicalLocation: String(request.body.physicalLocation || ""),
      electronicPlatform: String(request.body.electronicPlatform || ""),
      electronicUrl: String(request.body.electronicUrl || ""),
      seriesName: String(request.body.seriesName || ""),
      volumeNumber: Number(request.body.volumeNumber) || null,
      reminderDate: String(request.body.reminderDate || ""),
      reminderNote: String(request.body.reminderNote || ""),
      coverUrl: "",
      metadataSource: "手動登録",
      sortOrder: firstSortOrder - 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sprite: null,
    });
    books.unshift(book);
    await libraryStore.saveBooks(books);
    response.status(201).json({ book });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/books/:id", async (request, response, next) => {
  try {
    const books = await libraryStore.readBooks();
    const index = books.findIndex((book) => String(book.id) === request.params.id);
    if (index < 0) return response.status(404).json({ error: "本が見つかりません。" });
    const allowed = [
      "title",
      "author",
      "publisher",
      "published",
      "pages",
      "status",
      "rating",
      "shelf",
      "tags",
      "note",
      "category",
      "bookType",
      "format",
      "physicalLocation",
      "electronicPlatform",
      "electronicUrl",
      "seriesName",
      "volumeNumber",
      "reminderDate",
      "reminderNote",
    ];
    for (const key of allowed) {
      if (request.body[key] !== undefined) books[index][key] = request.body[key];
    }
    if (request.body.category !== undefined) {
      books[index].bookType = request.body.category === "マンガ" ? "manga" : "book";
    }
    books[index].updatedAt = new Date().toISOString();
    books[index] = applyBookDefaults(books[index], index);
    await libraryStore.saveBooks(books);
    response.json({ book: books[index] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/reorder", async (request, response, next) => {
  try {
    const ids = Array.isArray(request.body.ids) ? request.body.ids.map(String) : [];
    if (!ids.length) return response.status(400).json({ error: "並び順が空です。" });
    const order = new Map(ids.map((id, index) => [id, index]));
    const books = await libraryStore.readBooks();
    const trailing = books.length;
    books.forEach((book, index) => {
      book.sortOrder = order.has(String(book.id)) ? order.get(String(book.id)) : trailing + index;
      book.updatedAt = new Date().toISOString();
    });
    books.sort((a, b) => a.sortOrder - b.sortOrder);
    await libraryStore.saveBooks(books);
    response.json({ books });
  } catch (error) {
    next(error);
  }
});

/**
 * 所持巻とNDLのシリーズ一覧を比較し、最初の未所持巻を新刊候補として保存する。
 * 同シリーズの全所蔵本へ同じ確認結果を書き、どの巻を開いても表示が一致するようにする。
 */
async function checkAndPersistSeries(seriesName) {
  const catalog = await fetchSeriesCatalog(seriesName);
  const books = await libraryStore.readBooks();
  const seriesKey = normalizedSeriesName(seriesName);
  const matching = books.filter((book) => normalizedSeriesName(book.seriesName) === seriesKey);
  const ownedMax = Math.max(0, ...matching.map((book) => Number(book.volumeNumber) || 0));
  const latest = catalog.at(-1) || null;
  const nextAvailable = catalog.find((item) => item.volumeNumber > ownedMax) || null;
  const checkedAt = new Date().toISOString();

  for (const book of matching) {
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
  if (matching.length) await libraryStore.saveBooks(books);

  return {
    seriesName,
    ownedMax,
    latest,
    nextAvailable,
    hasNewVolume: Boolean(nextAvailable),
    checkedAt,
    count: catalog.length,
    message: !latest
      ? "シリーズの巻情報を確認できませんでした。シリーズ名を調整してください。"
      : nextAvailable
        ? `${nextAvailable.volumeNumber}巻が登録可能です。`
        : `確認できた最新${latest.volumeNumber}巻まで登録済みです。`,
  };
}

app.post("/api/series/check", async (request, response, next) => {
  try {
    const seriesName = String(request.body.seriesName || "").trim();
    if (!seriesName) return response.status(400).json({ error: "シリーズ名を入力してください。" });
    response.json(await checkAndPersistSeries(seriesName));
  } catch (error) {
    next(error);
  }
});

app.post("/api/series/check-all", async (_request, response, next) => {
  try {
    const books = await libraryStore.readBooks();
    const seriesNames = [...new Set(
      books
        .filter((book) => (book.category === "マンガ" || book.bookType === "manga") && book.seriesName)
        .map((book) => String(book.seriesName).trim())
        .filter(Boolean),
    )];
    const results = [];
    // 外部APIへ一度に大量接続しないよう、シリーズ単位で順番に確認する。
    for (const seriesName of seriesNames) {
      try {
        results.push(await checkAndPersistSeries(seriesName));
      } catch (error) {
        results.push({ seriesName, error: error.message });
      }
    }
    response.json({ checked: results.length, results });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/:id/refresh-cover", async (request, response, next) => {
  try {
    const books = await libraryStore.readBooks();
    const index = books.findIndex((book) => String(book.id) === request.params.id);
    if (index < 0) return response.status(404).json({ error: "本が見つかりません。" });
    const isbn = normalizeIsbn(books[index].isbn);
    const preferred = books[index].coverUrl?.startsWith("http") ? [books[index].coverUrl] : [];
    const coverUrl = await ensureLocalCover(isbn, preferred);
    if (!coverUrl) return response.status(404).json({ error: "利用できる表紙画像が見つかりませんでした。" });
    books[index].coverUrl = coverUrl;
    books[index].coverSource = "国立国会図書館・書影API等";
    books[index].updatedAt = new Date().toISOString();
    await libraryStore.saveBooks(books);
    response.json({ book: books[index] });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/books/:id", async (request, response, next) => {
  try {
    const books = await libraryStore.readBooks();
    const nextBooks = books.filter((book) => String(book.id) !== request.params.id);
    if (nextBooks.length === books.length) return response.status(404).json({ error: "本が見つかりません。" });
    await libraryStore.saveBooks(nextBooks);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 100);
    const uploads = await libraryStore.readUploads();
    const recentSuccessCutoff = Date.now() - 60 * 1000;
    const visibleUploads = uploads.filter((item) => {
      if (item.dismissedAt) return false;
      if (item.status !== "success") return true;
      return Date.parse(item.completedAt || item.createdAt || 0) >= recentSuccessCutoff;
    });
    response.json({ uploads: visibleUploads.slice(0, limit) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads/:id/dismiss", async (request, response, next) => {
  try {
    const history = await libraryStore.readUploads();
    const index = history.findIndex((item) => item.id === request.params.id);
    if (index < 0) return response.status(404).json({ error: "アップロード履歴が見つかりません。" });
    history[index] = { ...history[index], dismissedAt: new Date().toISOString() };
    await libraryStore.saveUploads(history);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/isbn", async (request, response, next) => {
  try {
    const isbn = normalizeIsbn(request.body.isbn);
    const result = await addOrUpdateBook(isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.single("image"), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: "画像を選択してください。" });
  let record;
  try {
    const storedFilename = await saveImage(request.file);
    record = await saveUploadRecord({
      id: crypto.randomUUID(),
      originalName: request.file.originalname || "iPhoneの写真",
      storedFilename,
      imageUrl: `/uploads/${storedFilename}`,
      status: "processing",
      message: "ISBNバーコードを解析しています。",
      createdAt: new Date().toISOString(),
    });

    const isbn = request.body.isbn ? normalizeIsbn(request.body.isbn) : await decodeBarcode(request.file.buffer);
    const result = await finishUploadWithIsbn(record, isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    if (record && error.status === 422) {
      const pending = await saveUploadRecord({
        ...record,
        status: "needs_isbn",
        message: error.message,
      });
      return response.status(422).json({ error: error.message, upload: pending });
    }
    next(error);
  }
});

app.post("/api/uploads/:id/isbn", async (request, response, next) => {
  try {
    const history = await libraryStore.readUploads();
    const record = history.find((item) => item.id === request.params.id);
    if (!record) return response.status(404).json({ error: "アップロード画像が見つかりません。" });
    const result = await finishUploadWithIsbn(record, request.body.isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/uploads/:id/retry", async (request, response, next) => {
  try {
    const history = await libraryStore.readUploads();
    const record = history.find((item) => item.id === request.params.id);
    if (!record) return response.status(404).json({ error: "アップロード画像が見つかりません。" });
    const image = await fsp.readFile(path.join(UPLOAD_DIR, record.storedFilename));
    const isbn = await decodeBarcode(image);
    const result = await finishUploadWithIsbn(record, isbn);
    response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      return response.sendFile(path.join(DIST_DIR, "index.html"));
    }
    next();
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  response.status(status).json({
    error: status >= 500 ? "処理中にエラーが発生しました。PC側のログを確認してください。" : error.message,
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const lanUrl = `http://${privateLanAddress()}:${PORT}`;
  console.log(`本棚カタログ: http://127.0.0.1:${PORT}`);
  console.log(`iPhoneアップロード: ${lanUrl}/upload`);
  void backfillMissingCovers().catch((error) => console.error("表紙の自動取得に失敗しました。", error));
});

export { app, server };
