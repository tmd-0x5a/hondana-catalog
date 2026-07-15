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
import { normalizeIsbn, stripIsbn, validIsbn13 } from "./isbn.mjs";

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
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const COVER_DIR = path.join(DATA_DIR, "covers");
const BOOKS_FILE = path.join(DATA_DIR, "books.json");
const HISTORY_FILE = path.join(DATA_DIR, "uploads.json");
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

await initializeData();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function initializeData() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(COVER_DIR, { recursive: true });
  if (!fs.existsSync(BOOKS_FILE)) {
    await writeJson(BOOKS_FILE, sampleBooks);
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    await writeJson(HISTORY_FILE, []);
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

async function writeJson(file, value) {
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 店頭へ持ち出せる自己完結HTMLを生成する。
 * JSONをscript要素へ埋め込むため、タグ終端やJavaScriptの行区切りとして解釈される文字を先に逃がす。
 */
function buildOfflineLibraryHtml(snapshot) {
  const payload = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#151813">
  <title>持ち出し本棚</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #11130f; color: #ece5d6; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #11130f; }
    header { padding: max(18px, env(safe-area-inset-top)) 18px 17px; border-bottom: 1px solid #34372d; background: #181b16; }
    header span, header strong { display: block; }
    header strong { font-size: 17px; }
    header span { margin-top: 4px; color: #9c9587; font-size: 11px; }
    main { width: min(100%, 680px); margin: 0 auto; padding: 20px 16px calc(28px + env(safe-area-inset-bottom)); }
    .summary { display: flex; align-items: end; justify-content: space-between; gap: 14px; margin-bottom: 17px; }
    .summary p { margin: 0; color: #b6ab92; font-size: 11px; }
    .summary strong { display: block; margin-top: 3px; color: #eee3ca; font-size: 28px; }
    .badge { padding: 7px 9px; border: 1px solid #47604a; border-radius: 6px; color: #a9c3a4; font-size: 10px; }
    .search { height: 50px; display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 0 13px; border: 1px solid #5a5548; border-radius: 7px; background: #1c1f19; }
    .search svg { color: #bda76c; }
    input { width: 100%; border: 0; outline: 0; background: transparent; color: #f2ecdf; font: inherit; font-size: 16px; }
    input::placeholder { color: #777266; }
    #clear { min-width: 38px; min-height: 38px; border: 0; background: transparent; color: #aaa294; font-size: 22px; }
    .meta { min-height: 35px; padding: 11px 2px 8px; color: #958d7f; font-size: 11px; }
    .notice { margin-bottom: 10px; padding: 12px; border: 1px solid #925e43; border-radius: 7px; background: #35231a; color: #e6c093; font-weight: 700; font-size: 12px; }
    #results { display: grid; border-top: 1px solid #34372d; }
    article { min-width: 0; padding: 13px 2px; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; border-bottom: 1px solid #34372d; }
    .mark { width: 30px; height: 38px; display: grid; place-items: center; border-radius: 3px 5px 5px 3px; background: #5b6048; color: #f1e6c6; font-size: 14px; font-weight: 700; }
    article strong, article span, article small { display: block; overflow-wrap: anywhere; }
    article strong { color: #eee7da; font-size: 14px; line-height: 1.45; }
    article span { margin-top: 3px; color: #aaa191; font-size: 11px; }
    article small { margin-top: 5px; color: #879c82; font-size: 10px; }
    .empty { padding: 42px 16px; color: #878174; text-align: center; font-size: 12px; line-height: 1.8; }
  </style>
</head>
<body>
  <header><strong>持ち出し本棚</strong><span>このファイルだけで検索できます</span></header>
  <main>
    <div class="summary"><p>保存された蔵書<strong id="count"></strong></p><div class="badge">オフライン</div></div>
    <label class="search" aria-label="蔵書検索">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
      <input id="query" autocomplete="off" inputmode="search" placeholder="タイトル・著者・ISBN">
      <button id="clear" type="button" aria-label="検索を消す">×</button>
    </label>
    <div class="meta" id="meta"></div>
    <div id="notice"></div>
    <section id="results"></section>
  </main>
  <script>
    const snapshot = ${payload};
    const books = Array.isArray(snapshot.books) ? snapshot.books : [];
    const query = document.getElementById("query");
    const results = document.getElementById("results");
    const meta = document.getElementById("meta");
    const notice = document.getElementById("notice");
    document.getElementById("count").textContent = books.length + "冊";
    const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("ja");
    const isbn = (value) => String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
    const synced = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString("ja-JP") : "不明";

    function addBook(book) {
      const item = document.createElement("article");
      const mark = document.createElement("div");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      const author = document.createElement("span");
      const detail = document.createElement("small");
      mark.className = "mark";
      mark.textContent = book.category === "マンガ" ? "漫" : "本";
      title.textContent = book.title || "無題";
      author.textContent = book.author || "著者不明";
      const location = book.format === "electronic" ? (book.electronicPlatform || "電子書籍") : (book.physicalLocation || "実本");
      detail.textContent = [book.isbn, location, book.volumeNumber ? book.volumeNumber + "巻" : ""].filter(Boolean).join(" ・ ");
      body.append(title, author, detail);
      item.append(mark, body);
      results.append(item);
    }

    function render() {
      const raw = query.value.trim();
      const normalized = normalize(raw);
      const isbnQuery = isbn(raw);
      results.replaceChildren();
      notice.replaceChildren();
      if (!raw) {
        meta.textContent = "保存日時 " + synced;
        results.innerHTML = '<div class="empty">店頭でタイトル、著者名、ISBNを入力してください。<br>PCやLANへの接続は不要です。</div>';
        return;
      }
      const matches = books.filter((book) => {
        const text = normalize([book.title, book.author, book.seriesName, book.category].join(" "));
        return text.includes(normalized) || (isbnQuery.length >= 4 && isbn(book.isbn).includes(isbnQuery));
      }).slice(0, 50);
      const exact = isbnQuery.length >= 10 && books.find((book) => isbn(book.isbn) === isbnQuery);
      if (exact) {
        const owned = document.createElement("div");
        owned.className = "notice";
        owned.textContent = "登録済み: " + exact.title;
        notice.append(owned);
      }
      meta.textContent = matches.length ? matches.length + "件見つかりました" : "一致する蔵書はありません";
      matches.forEach(addBook);
      if (!matches.length) results.innerHTML = '<div class="empty">同じ本は見つかりませんでした。<br>表記違いもあるため、著者名でも確認してください。</div>';
    }

    query.addEventListener("input", render);
    document.getElementById("clear").addEventListener("click", () => { query.value = ""; query.focus(); render(); });
    render();
  </script>
</body>
</html>`;
}

const BOOK_CATEGORIES = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];

function normalizeElectronicPlatform(value = "") {
  const platform = String(value).trim();
  if (/^kindle$|amazon.*kindle/i.test(platform)) return "Amazon Kindle";
  if (/^dmm|dmm.*books?/i.test(platform)) return "DMMブックス";
  return platform;
}

function inferCategory(book = {}) {
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

/** 保存形式の差分をここへ集約し、古いbooks.jsonも現在のUIモデルとして読めるようにする。 */
function bookDefaults(book, index = 0) {
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

async function migrateBookData() {
  const books = await readJson(BOOKS_FILE, sampleBooks);
  const migrated = books.map((book, index) => bookDefaults(book, index));
  // 実際に差分がある初回だけ書き戻し、起動のたびにファイル更新日時を変えない。
  if (JSON.stringify(books) !== JSON.stringify(migrated)) await writeJson(BOOKS_FILE, migrated);
}

await migrateBookData();

function parseVolumeNumber(value = "") {
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

function inferBookClassification(summary) {
  const title = summary.title || "";
  const label = `${summary.series || ""} ${title}`;
  const volumeNumber = parseVolumeNumber(summary.volume || title);
  // 外部APIに分類がない場合の補助推定。確定情報ではないため、ユーザーが後から編集できる前提にする。
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
  const books = await readJson(BOOKS_FILE, sampleBooks);
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
  if (changed) await writeJson(BOOKS_FILE, books);
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
  const books = await readJson(BOOKS_FILE, sampleBooks);
  const existingIndex = books.findIndex((book) => stripIsbn(book.isbn) === isbn);
  const existing = existingIndex >= 0 ? books[existingIndex] : null;
  const firstSortOrder = books.length ? Math.min(...books.map((item) => Number(item.sortOrder) || 0)) : 0;
  const book = bookDefaults({
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
  await writeJson(BOOKS_FILE, books);
  return { book, duplicate: existingIndex >= 0 };
}

async function saveUploadRecord(record) {
  const history = await readJson(HISTORY_FILE, []);
  const index = history.findIndex((item) => item.id === record.id);
  if (index >= 0) history[index] = record;
  else history.unshift(record);
  await writeJson(HISTORY_FILE, history.slice(0, 100));
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

function normalizedSeriesName(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s・:：=＝「」『』〈〉《》～〜~\-—_]/g, "");
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
    const books = await readJson(BOOKS_FILE, sampleBooks);
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
    response.json({ books: await readJson(BOOKS_FILE, sampleBooks) });
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
    const books = await readJson(BOOKS_FILE, sampleBooks);
    const firstSortOrder = books.length ? Math.min(...books.map((book) => Number(book.sortOrder) || 0)) : 0;
    const book = bookDefaults({
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
    await writeJson(BOOKS_FILE, books);
    response.status(201).json({ book });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/books/:id", async (request, response, next) => {
  try {
    const books = await readJson(BOOKS_FILE, sampleBooks);
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
    books[index] = bookDefaults(books[index], index);
    await writeJson(BOOKS_FILE, books);
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
    const books = await readJson(BOOKS_FILE, sampleBooks);
    const trailing = books.length;
    books.forEach((book, index) => {
      book.sortOrder = order.has(String(book.id)) ? order.get(String(book.id)) : trailing + index;
      book.updatedAt = new Date().toISOString();
    });
    books.sort((a, b) => a.sortOrder - b.sortOrder);
    await writeJson(BOOKS_FILE, books);
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
  const books = await readJson(BOOKS_FILE, sampleBooks);
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
  if (matching.length) await writeJson(BOOKS_FILE, books);

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
    const books = await readJson(BOOKS_FILE, sampleBooks);
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
    const books = await readJson(BOOKS_FILE, sampleBooks);
    const index = books.findIndex((book) => String(book.id) === request.params.id);
    if (index < 0) return response.status(404).json({ error: "本が見つかりません。" });
    const isbn = normalizeIsbn(books[index].isbn);
    const preferred = books[index].coverUrl?.startsWith("http") ? [books[index].coverUrl] : [];
    const coverUrl = await ensureLocalCover(isbn, preferred);
    if (!coverUrl) return response.status(404).json({ error: "利用できる表紙画像が見つかりませんでした。" });
    books[index].coverUrl = coverUrl;
    books[index].coverSource = "国立国会図書館・書影API等";
    books[index].updatedAt = new Date().toISOString();
    await writeJson(BOOKS_FILE, books);
    response.json({ book: books[index] });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/books/:id", async (request, response, next) => {
  try {
    const books = await readJson(BOOKS_FILE, sampleBooks);
    const nextBooks = books.filter((book) => String(book.id) !== request.params.id);
    if (nextBooks.length === books.length) return response.status(404).json({ error: "本が見つかりません。" });
    await writeJson(BOOKS_FILE, nextBooks);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 100);
    const uploads = await readJson(HISTORY_FILE, []);
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
    const history = await readJson(HISTORY_FILE, []);
    const index = history.findIndex((item) => item.id === request.params.id);
    if (index < 0) return response.status(404).json({ error: "アップロード履歴が見つかりません。" });
    history[index] = { ...history[index], dismissedAt: new Date().toISOString() };
    await writeJson(HISTORY_FILE, history);
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
    const history = await readJson(HISTORY_FILE, []);
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
    const history = await readJson(HISTORY_FILE, []);
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
