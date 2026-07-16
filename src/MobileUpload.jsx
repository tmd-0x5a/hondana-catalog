import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Barcode,
  BookOpen,
  Camera,
  Check,
  CloudDownload,
  Download,
  ImagePlus,
  LibraryBig,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Upload,
  Wifi,
  X,
} from "lucide-react";

import { requestJson } from "./api.js";

const OFFLINE_LIBRARY_KEY = "hondana-offline-library-v1";

function compactIsbn(value = "") {
  return String(value).replace(/[^0-9X]/gi, "").toUpperCase();
}

function loadOfflineLibrary() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_LIBRARY_KEY)) || { books: [], syncedAt: "" };
  } catch {
    return { books: [], syncedAt: "" };
  }
}

/** EXIFの向きを反映できるImageBitmapを優先し、未対応形式だけHTMLImageElementへ戻す。 */
async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall back to an HTML image for formats handled only by the browser.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 大きな写真を端末内で扱いやすい寸法へ縮小し、バーコード候補の帯だけをCanvasへ切り出す。 */
function canvasFromRegion(source, topRatio, heightRatio) {
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  const sourceTop = Math.floor(sourceHeight * topRatio);
  const cropHeight = Math.max(1, Math.floor(sourceHeight * heightRatio));
  const scale = Math.min(1, 1600 / sourceWidth, 1600 / cropHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(sourceWidth * scale));
  canvas.height = Math.max(1, Math.floor(cropHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, sourceTop, sourceWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * ZXingは撮影時だけ遅延ロードし、よく使われる下半分から順に走査する。
 * ここで読めない写真は破棄せず、PC側の高精度解析へ送る。
 */
async function decodeIsbnLocally(file) {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const source = await loadImageSource(file);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  try {
    for (const [top, height] of [[0.45, 0.55], [0, 1], [0.2, 0.6], [0, 0.55]]) {
      try {
        const value = compactIsbn(reader.decodeFromCanvas(canvasFromRegion(source, top, height)).getText());
        if (/^97[89]\d{10}$/.test(value)) return value;
      } catch {
        // Try the next likely barcode area.
      }
    }
  } finally {
    if (typeof source.close === "function") source.close();
  }
  throw new Error("端末内ではISBNを判定できませんでした。");
}

function formatSyncedAt(value) {
  if (!value) return "未同期";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/**
 * @param {{initialMode?: "add"|"check"}} props 初期表示モード。
 * @returns {import("react").ReactElement} LAN登録・重複確認画面。
 */
export function MobileUpload({ initialMode = "add" }) {
  const [mode, setMode] = useState(initialMode);
  const [file, setFile] = useState(null);
  const [isbn, setIsbn] = useState("");
  const [preview, setPreview] = useState("");
  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("");
  const [book, setBook] = useState(null);
  const [pendingUploadId, setPendingUploadId] = useState("");
  const [offlineLibrary, setOfflineLibrary] = useState(loadOfflineLibrary);
  const [checkQuery, setCheckQuery] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (phase !== "success" || !message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message, phase]);

  const localMatches = useMemo(() => {
    const query = checkQuery.trim().toLocaleLowerCase("ja");
    if (!query) return [];
    const isbnQuery = compactIsbn(query);
    return offlineLibrary.books.filter((item) => {
      const text = `${item.title} ${item.author} ${item.seriesName || ""}`.toLocaleLowerCase("ja");
      return text.includes(query) || (isbnQuery.length >= 4 && compactIsbn(item.isbn).includes(isbnQuery));
    }).slice(0, 12);
  }, [checkQuery, offlineLibrary]);

  function resetCapture() {
    setFile(null);
    setIsbn("");
    setPreview("");
    setPhase("idle");
    setMessage("");
    setBook(null);
    setPendingUploadId("");
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    resetCapture();
    setCheckQuery("");
    setCheckResult(null);
    window.history.replaceState({}, "", nextMode === "check" ? "/check" : "/upload");
  }

  function checkOwnedIsbn(value) {
    const normalized = compactIsbn(value);
    const owned = offlineLibrary.books.find((item) => compactIsbn(item.isbn) === normalized);
    setCheckQuery(normalized);
    setCheckResult(owned
      ? { type: "owned", book: owned, message: "この本は登録済みです" }
      : { type: "clear", message: "同じISBNは見つかりませんでした" });
  }

  /** 撮影直後に端末内判定を行い、追加モードと店頭チェックで結果の扱いを分ける。 */
  async function handleFile(fileValue) {
    if (!fileValue) return;
    setFile(fileValue);
    setPendingUploadId("");
    setBook(null);
    setPhase("scanning");
    setMessage("iPhone内でバーコードを高速解析しています...");
    try {
      const detected = await decodeIsbnLocally(fileValue);
      setIsbn(detected);
      if (mode === "check") {
        checkOwnedIsbn(detected);
        setPhase("checked");
        setMessage("端末内の蔵書データと照合しました。");
      } else {
        setPhase("detected");
        setMessage(`ISBN ${detected} を読み取りました。`);
      }
    } catch (error) {
      if (mode === "check") {
        setPhase("error");
        setMessage("読み取れませんでした。タイトルまたはISBNで検索してください。");
      } else {
        setPhase("idle");
        setMessage("端末内では判定できなかったため、送信後にPCで詳しく解析します。");
      }
    }
  }

  /** 店頭検索に必要な最小項目だけを保存し、iPhone単体でも重複確認できるようにする。 */
  async function syncLibrary() {
    setSyncing(true);
    setMessage("");
    try {
      const result = await requestJson("/api/books");
      const snapshot = {
        syncedAt: new Date().toISOString(),
        books: result.books.map((item) => ({
          id: item.id,
          title: item.title,
          author: item.author,
          isbn: item.isbn,
          category: item.category,
          seriesName: item.seriesName,
          volumeNumber: item.volumeNumber,
          format: item.format,
          electronicPlatform: item.electronicPlatform,
        })),
      };
      localStorage.setItem(OFFLINE_LIBRARY_KEY, JSON.stringify(snapshot));
      setOfflineLibrary(snapshot);
      setMessage(`${snapshot.books.length}冊をこのiPhoneに保存しました。`);
    } catch {
      setMessage("PCと同じLANに接続してから同期してください。");
    } finally {
      setSyncing(false);
    }
  }

  /**
   * 未解析画像、端末で判定済みの画像、ISBN手入力、PC解析後の追加入力を同じ完了処理へ集約する。
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (!file && !isbn.trim() && !pendingUploadId) {
      setPhase("error");
      setMessage("写真を選ぶか、ISBNを入力してください。");
      return;
    }

    setPhase("working");
    setMessage(file && !isbn ? "PCでバーコードを詳しく解析しています..." : "書籍情報と表紙を取得しています...");

    try {
      let result;
      if (pendingUploadId) {
        result = await requestJson(`/api/uploads/${pendingUploadId}/isbn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isbn }),
        });
      } else if (file) {
        const body = new FormData();
        body.append("image", file);
        if (isbn.trim()) body.append("isbn", isbn.trim());
        result = await requestJson("/api/upload", { method: "POST", body });
      } else {
        result = await requestJson("/api/isbn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isbn }),
        });
      }

      setBook(result.book);
      setPhase("success");
      setMessage(result.duplicate ? "登録済みの本を更新しました。" : "PCの本棚へ登録しました。");
      setPendingUploadId("");
    } catch (error) {
      if (error.status === 422 && error.payload?.upload?.id) {
        setPendingUploadId(error.payload.upload.id);
        setPhase("needs-isbn");
        setMessage(error.message);
      } else {
        setPhase("error");
        setMessage(error.message);
      }
    }
  }

  return (
    <main className="mobile-upload-page">
      <header className="mobile-header">
        <div className="mobile-brand-mark"><BookOpen size={24} /></div>
        <div><strong>本棚カタログ</strong><span>{mode === "check" ? "買う前の重複チェック" : "iPhoneから本を追加"}</span></div>
        <div className="lan-status" title="LAN接続"><Wifi size={18} /></div>
      </header>

      <section className="mobile-upload-content">
        <div className="mobile-mode-tabs">
          <button className={mode === "add" ? "active" : ""} onClick={() => switchMode("add")}><Upload size={17} />本を追加</button>
          <button className={mode === "check" ? "active" : ""} onClick={() => switchMode("check")}><ShieldCheck size={17} />買う前チェック</button>
        </div>

        <div className="mobile-title">
          <p>{mode === "check" ? "店頭用" : "新しい本"}</p>
          <h1>{mode === "check" ? "持っているか確認" : "バーコードを撮影"}</h1>
          <span>{mode === "check" ? "出発前に同期し、持ち出し本棚をファイルへ保存しておくと、店内でも蔵書を検索できます。" : "撮影後にiPhone内で先に読み取り、難しい写真だけPCで詳しく解析します。"}</span>
        </div>

        {mode === "check" ? (
          <section className="mobile-check-panel">
            <div className="offline-sync-card">
              <div className="offline-sync-info"><CloudDownload size={20} /><span><strong>{offlineLibrary.books.length}冊を保存済み</strong><small>最終同期 {formatSyncedAt(offlineLibrary.syncedAt)}</small></span></div>
              <div className="offline-sync-actions">
                <button disabled={syncing} onClick={syncLibrary}>{syncing ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}同期</button>
                <a download="hondana-pocket.html" href="/api/offline-library"><Download size={16} />持ち出し保存</a>
              </div>
            </div>

            <label className={`camera-field compact-camera ${preview ? "has-preview" : ""}`}>
              {preview ? <img src={preview} alt="選択したバーコード写真" /> : <><Camera size={34} /><strong>バーコードを撮影</strong><span>同じISBNがあるか端末内で照合</span></>}
              <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => handleFile(event.target.files?.[0] || null)} type="file" />
            </label>

            <div className="manual-divider"><span>タイトルでも確認</span></div>
            <label className="mobile-library-search"><Search size={20} /><input autoComplete="off" onChange={(event) => { setCheckQuery(event.target.value); setCheckResult(null); }} placeholder="タイトル・著者・ISBN" value={checkQuery} />{checkQuery && <button aria-label="検索を消す" onClick={() => { setCheckQuery(""); setCheckResult(null); }} type="button"><X size={17} /></button>}</label>

            {checkResult && <div className={`ownership-result ${checkResult.type}`}>
              {checkResult.type === "owned" ? <AlertCircle size={24} /> : <Check size={24} />}
              <div><strong>{checkResult.message}</strong>{checkResult.book ? <><span>{checkResult.book.title}</span><small>{checkResult.book.author} {checkResult.book.volumeNumber ? `・${checkResult.book.volumeNumber}巻` : ""}</small></> : <small>別巻の可能性があるため、タイトルでも確認してください。</small>}</div>
            </div>}

            {!checkResult && checkQuery && <div className="offline-match-list">
              {localMatches.length ? localMatches.map((item) => <button key={item.id} onClick={() => setCheckResult({ type: "owned", book: item, message: "関連する所蔵本があります" })}><LibraryBig size={18} /><span><strong>{item.title}</strong><small>{item.author}{item.electronicPlatform ? `・${item.electronicPlatform}` : ""}</small></span><Check size={17} /></button>) : <div className="no-local-match"><Check size={20} /><span>一致する所蔵本はありません</span></div>}
            </div>}

            {message && <div className={`mobile-message ${phase}`}><AlertCircle size={18} /><span>{message}</span></div>}
          </section>
        ) : phase === "success" && book ? (
          <section className="mobile-result" aria-live="polite">
            <div className="result-check"><Check size={28} /></div>
            {message && <p>{message}</p>}
            <div className="result-book">
              <img src={book.coverUrl || "/assets/selected-cover.png"} alt="" />
              <div><strong>{book.title}</strong><span>{book.author}</span><code>{book.isbn}</code>{book.bookType === "manga" && <small>{book.seriesName} {book.volumeNumber ? `${book.volumeNumber}巻` : ""}</small>}</div>
            </div>
            <button className="mobile-primary" onClick={resetCapture} type="button"><ImagePlus size={20} />続けて追加</button>
          </section>
        ) : (
          <form className="mobile-upload-form" onSubmit={handleSubmit}>
            <label className={`camera-field ${preview ? "has-preview" : ""}`}>
              {preview ? <img src={preview} alt="選択したバーコード写真" /> : <><Camera size={38} /><strong>カメラで撮影</strong><span>バーコードを枠いっぱいに写す</span></>}
              <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => handleFile(event.target.files?.[0] || null)} type="file" />
            </label>

            {preview && <button className="replace-photo" onClick={() => { setFile(null); setIsbn(""); setPhase("idle"); }} type="button"><RefreshCw size={17} />写真を選び直す</button>}
            <div className="manual-divider"><span>または</span></div>
            <label className="mobile-isbn-field">
              <span>{pendingUploadId ? "読み取れない場合はISBNを入力" : "ISBNを手動入力"}</span>
              <div><Barcode size={21} /><input inputMode="numeric" onChange={(event) => setIsbn(event.target.value)} placeholder="978から始まる13桁" value={isbn} /></div>
            </label>
            {message && phase !== "working" && <div className={`mobile-message ${phase}`} role="alert">{phase === "detected" ? <Check size={18} /> : <AlertCircle size={18} />}<span>{message}</span></div>}
            <button className="mobile-primary" disabled={phase === "working" || phase === "scanning"} type="submit">
              {phase === "working" || phase === "scanning" ? <RefreshCw className="spin" size={20} /> : <Upload size={20} />}
              {phase === "scanning" ? "端末内で解析中..." : phase === "working" ? message : pendingUploadId ? "ISBNで登録" : "本棚へ送る"}
            </button>
          </form>
        )}
      </section>

      <footer className="mobile-footer"><Smartphone size={16} />保存したhondana-pocket.htmlはLANなしで開けます</footer>
    </main>
  );
}
