import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Barcode,
  Bell,
  BookCopy,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  Circle,
  Edit3,
  ExternalLink,
  FolderOpen,
  GripVertical,
  LibraryBig,
  MapPin,
  MoreHorizontal,
  MoveRight,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Smartphone,
  Star,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";

import { requestJson } from "./api.js";
import { sampleBooks } from "./sampleBooks.js";

const categoryOptions = ["マンガ", "小説", "技術", "ビジネス", "思想・社会", "実用", "その他"];
const platformCatalog = [
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
const platformOptions = platformCatalog.map((platform) => platform.name);

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatLabel(book) {
  return book.format === "electronic" ? "電子" : "実本";
}

function locationLabel(book) {
  return book.format === "electronic"
    ? book.electronicPlatform || "媒体未設定"
    : book.physicalLocation || "場所未設定";
}

function platformHomeUrl(name) {
  return platformCatalog.find((platform) => platform.name === name)?.url || "";
}

function electronicBookUrl(book) {
  return book.electronicUrl || platformHomeUrl(book.electronicPlatform);
}

function normalizedSeriesName(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・:：『』「」【】()（）\-–—]/g, "");
}

function Cover({ book, selected, onSelect }) {
  const style = book.coverUrl
    ? { backgroundImage: `url("${book.coverUrl}")`, backgroundPosition: "center", backgroundSize: "cover" }
    : book.sprite
      ? { backgroundImage: "url('/assets/cover-grid.png')", backgroundPosition: book.sprite }
      : { backgroundImage: "url('/assets/selected-cover.png')" };
  return (
    <button aria-label={`${book.title}を選択`} className={`book-cover ${selected ? "is-selected" : ""}`} onClick={onSelect} style={style}>
      <span>{book.title}</span>
    </button>
  );
}

function BookEditModal({ book, onClose, onSaved }) {
  const isNew = !book;
  const [form, setForm] = useState({
    title: book?.title || "",
    author: book?.author || "",
    isbn: book?.isbn || "",
    publisher: book?.publisher || "",
    published: book?.published || "",
    category: book?.category || (book?.bookType === "manga" ? "マンガ" : "その他"),
    format: book?.format || "physical",
    physicalLocation: book?.physicalLocation || "",
    electronicPlatform: book?.electronicPlatform || "Amazon Kindle",
    electronicUrl: book?.electronicUrl || "",
    shelf: book?.shelf || "未整理",
    seriesName: book?.seriesName || "",
    volumeNumber: book?.volumeNumber || "",
    status: book?.status || "未読",
    reminderDate: book?.reminderDate || "",
    reminderNote: book?.reminderNote || "",
    tags: (book?.tags || []).join("、"),
    note: book?.note || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  useEffect(() => {
    if (!isNew || form.title.trim().length < 2 || selectedSuggestion?.title === form.title) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestBusy(true);
      try {
        const result = await requestJson(`/api/books/suggest?q=${encodeURIComponent(form.title.trim())}`, { signal: controller.signal });
        setSuggestions(result.suggestions || []);
      } catch (suggestError) {
        if (suggestError.name !== "AbortError") setSuggestions([]);
      } finally {
        setSuggestBusy(false);
      }
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.title, isNew, selectedSuggestion]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseSuggestion(suggestion) {
    setSelectedSuggestion(suggestion);
    setSuggestions([]);
    setForm((current) => ({
      ...current,
      title: suggestion.title,
      author: suggestion.author || current.author,
      isbn: suggestion.isbn || current.isbn,
      publisher: suggestion.publisher || current.publisher,
      published: suggestion.published || current.published,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        bookType: form.category === "マンガ" ? "manga" : "book",
        volumeNumber: Number(form.volumeNumber) || null,
        tags: form.tags.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean),
      };
      let result;
      if (isNew && String(form.isbn).replace(/[^0-9X]/gi, "").length >= 10) {
        const imported = await requestJson("/api/isbn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isbn: form.isbn }),
        });
        const importedPayload = selectedSuggestion ? {
          ...payload,
          title: imported.book.title || payload.title,
          author: imported.book.author && imported.book.author !== "著者情報なし" ? imported.book.author : payload.author,
          publisher: imported.book.publisher || payload.publisher,
          published: imported.book.published || payload.published,
          category: imported.book.category && imported.book.category !== "その他" ? imported.book.category : payload.category,
          bookType: imported.book.bookType || payload.bookType,
          seriesName: imported.book.seriesName || payload.seriesName,
          volumeNumber: imported.book.volumeNumber || payload.volumeNumber,
        } : payload;
        result = await requestJson(`/api/books/${imported.book.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(importedPayload),
        });
      } else {
        result = await requestJson(isNew ? "/api/books" : `/api/books/${book.id}`, {
          method: isNew ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved(result.book);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="edit-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <header>
          <div><Edit3 size={21} /><strong>{isNew ? "本を手動登録" : "所蔵情報を編集"}</strong></div>
          <button aria-label="閉じる" onClick={onClose} type="button"><X size={20} /></button>
        </header>

        <div className="edit-form-grid">
          <div className="wide-field title-suggestion-field">
            <label><span>タイトル</span><input autoComplete="off" autoFocus onChange={(event) => { setSelectedSuggestion(null); update("title", event.target.value); }} placeholder="2文字以上で書籍候補を検索" value={form.title} /></label>
            {suggestBusy && <RefreshCw className="suggest-spinner spin" size={16} />}
            {selectedSuggestion?.coverUrl && <div className="selected-suggestion"><img src={selectedSuggestion.coverUrl} alt="候補の表紙" /><span><strong>表紙を取得します</strong><small>ISBN {selectedSuggestion.isbn}</small></span></div>}
            {suggestions.length > 0 && <div className="book-suggestions">
              {suggestions.map((suggestion) => <button key={suggestion.isbn} onClick={() => chooseSuggestion(suggestion)} type="button"><img src={suggestion.coverUrl || "/assets/selected-cover.png"} alt="" /><span><strong>{suggestion.title}</strong><small>{suggestion.author || "著者情報なし"}{suggestion.published ? `・${suggestion.published}` : ""}</small><code>{suggestion.isbn}</code></span></button>)}
              <a href="https://ndlsearch.ndl.go.jp/" rel="noreferrer" target="_blank">書誌候補: NDLサーチAPI <ExternalLink size={12} /></a>
            </div>}
          </div>
          <label><span>著者</span><input onChange={(event) => update("author", event.target.value)} value={form.author} /></label>
          <label><span>ISBN</span><input disabled={!isNew} onChange={(event) => update("isbn", event.target.value)} value={form.isbn} /></label>
          <label><span>出版社</span><input onChange={(event) => update("publisher", event.target.value)} value={form.publisher} /></label>
          <label><span>出版日</span><input onChange={(event) => update("published", event.target.value)} value={form.published} /></label>

          <label className="wide-field"><span>カテゴリ</span><select onChange={(event) => update("category", event.target.value)} value={form.category}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>

          <fieldset className="wide-field segmented-field">
            <legend>所有形態</legend>
            <div className="segmented-control">
              <button className={form.format === "physical" ? "selected" : ""} onClick={() => update("format", "physical")} type="button"><Archive size={17} />実本</button>
              <button className={form.format === "electronic" ? "selected" : ""} onClick={() => update("format", "electronic")} type="button"><Smartphone size={17} />電子書籍</button>
            </div>
          </fieldset>

          {form.format === "physical" ? (
            <label className="wide-field"><span>保管場所</span><input onChange={(event) => update("physicalLocation", event.target.value)} placeholder="書斎・本棚A・上段" value={form.physicalLocation} /></label>
          ) : (
            <>
              <label className="wide-field"><span>電子書籍ストア・媒体</span><select onChange={(event) => update("electronicPlatform", event.target.value)} value={form.electronicPlatform}>{platformOptions.map((platform) => <option key={platform}>{platform}</option>)}</select></label>
              <label className="wide-field"><span>作品ページ・本棚リンク</span><input onChange={(event) => update("electronicUrl", event.target.value)} placeholder={platformHomeUrl(form.electronicPlatform) || "https://..."} type="url" value={form.electronicUrl} /></label>
            </>
          )}

          <label><span>分類・棚</span><input onChange={(event) => update("shelf", event.target.value)} value={form.shelf} /></label>
          <label><span>読書状態</span><select onChange={(event) => update("status", event.target.value)} value={form.status}><option>未読</option><option>読了</option></select></label>

          {(form.category === "マンガ" || form.seriesName) && (
            <>
              <label><span>シリーズ名</span><input onChange={(event) => update("seriesName", event.target.value)} value={form.seriesName} /></label>
              <label><span>巻数</span><input inputMode="numeric" min="1" onChange={(event) => update("volumeNumber", event.target.value)} type="number" value={form.volumeNumber} /></label>
            </>
          )}

          <label><span>リマインド日</span><input onChange={(event) => update("reminderDate", event.target.value)} type="date" value={form.reminderDate} /></label>
          <label><span>リマインド内容</span><input onChange={(event) => update("reminderNote", event.target.value)} placeholder="次巻を確認" value={form.reminderNote} /></label>
          <label className="wide-field"><span>タグ</span><input onChange={(event) => update("tags", event.target.value)} placeholder="技術、積読" value={form.tags} /></label>
          <label className="wide-field"><span>メモ</span><textarea onChange={(event) => update("note", event.target.value)} rows="3" value={form.note} /></label>
        </div>

        {error && <div className="modal-message">{error}</div>}
        <footer>
          <button onClick={onClose} type="button">キャンセル</button>
          <button className="modal-submit" disabled={busy} type="submit">{busy ? <RefreshCw className="spin" size={17} /> : <Save size={17} />}{isNew ? "登録" : "保存"}</button>
        </footer>
      </form>
    </div>
  );
}

function NewReleaseView({ updates, busy, message, onAdd, onRefresh }) {
  return (
    <section className="new-release-view" aria-label="新刊リスト">
      <header className="release-header">
        <div><span>シリーズ追跡</span><h2>新刊・未所持リスト</h2><p>登録済みの巻より後に刊行された本を、シリーズ単位で表示します。</p></div>
        <button disabled={busy} onClick={onRefresh}>{busy ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}すべて更新</button>
      </header>
      {message && <div className="release-message">{message}</div>}
      {updates.length === 0 ? (
        <div className="release-empty"><BookCopy size={34} /><strong>新刊候補はありません</strong><span>マンガにシリーズ名と巻数を登録してから更新してください。</span></div>
      ) : (
        <div className="release-list">
          {updates.map((update) => (
            <article className="release-row" key={update.key}>
              <img src={update.coverUrl || "/assets/selected-cover.png"} alt={`${update.seriesName}の表紙`} />
              <div className="release-main">
                <span className="release-kind">マンガ ・ {update.ownershipLabel}</span>
                <h3>{update.seriesName}</h3>
                <p>{update.nextVolumeTitle || `${update.seriesName} ${update.nextVolumeNumber}巻`}</p>
                <div className="release-facts"><span>所持 {update.ownedMax}巻まで</span><span>確認済み最新 {update.latestVolume}巻</span><span>ISBN {update.nextVolumeIsbn}</span></div>
              </div>
              <div className="release-volume"><span>次に未所持</span><strong>{update.nextVolumeNumber}<small>巻</small></strong><time>{update.nextVolumePublished || "刊行日未取得"}</time></div>
              <div className="release-actions">
                {update.nextVolumeUrl && <a href={update.nextVolumeUrl} rel="noreferrer" target="_blank"><ExternalLink size={15} />書誌情報</a>}
                <button disabled={busy || !update.nextVolumeIsbn} onClick={() => onAdd(update)}><Plus size={16} />本棚に追加</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DesktopLibrary() {
  const [books, setBooks] = useState(sampleBooks);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const [viewMode, setViewMode] = useState("library");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortMode, setSortMode] = useState(() => localStorage.getItem("hondana-sort") || "newest");
  const [selectedId, setSelectedId] = useState(sampleBooks[0].id);
  const [config, setConfig] = useState(null);
  const [latestUpload, setLatestUpload] = useState(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [showIsbnModal, setShowIsbnModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [isbnInput, setIsbnInput] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth > 1180);

  async function refreshLibrary() {
    try {
      const [bookData, uploadData] = await Promise.all([requestJson("/api/books"), requestJson("/api/uploads?limit=1")]);
      setBooks(bookData.books);
      setLatestUpload(uploadData.uploads[0] || null);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
    }
  }

  useEffect(() => {
    let active = true;
    requestJson("/api/config").then((data) => active && setConfig(data)).catch(() => active && setServerOnline(false));
    refreshLibrary();
    const timer = window.setInterval(refreshLibrary, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => { localStorage.setItem("hondana-sort", sortMode); }, [sortMode]);
  useEffect(() => {
    const compactWindow = window.matchMedia("(max-width: 1180px)");
    const handleWindowSize = (event) => {
      if (event.matches) setDetailOpen(false);
    };
    compactWindow.addEventListener("change", handleWindowSize);
    return () => compactWindow.removeEventListener("change", handleWindowSize);
  }, []);
  useEffect(() => {
    function closeDetail(event) {
      if (event.key === "Escape") setDetailOpen(false);
    }
    window.addEventListener("keydown", closeDetail);
    return () => window.removeEventListener("keydown", closeDetail);
  }, []);
  useEffect(() => {
    if (latestUpload?.status !== "success") return undefined;
    const uploadId = latestUpload.id;
    const timer = window.setTimeout(() => dismissUpload(uploadId), 8000);
    return () => window.clearTimeout(timer);
  }, [latestUpload?.id, latestUpload?.status]);
  useEffect(() => {
    if (!books.some((book) => String(book.id) === String(selectedId)) && books[0]) setSelectedId(books[0].id);
  }, [books, selectedId]);

  const today = localDateString();
  const selectedBook = books.find((book) => String(book.id) === String(selectedId)) ?? books[0];
  const dueReminders = books.filter((book) => book.reminderDate && book.reminderDate <= today);
  const physicalCount = books.filter((book) => book.format !== "electronic").length;
  const electronicCount = books.filter((book) => book.format === "electronic").length;
  const mangaCount = books.filter((book) => book.category === "マンガ" || book.bookType === "manga").length;

  const categoryCounts = useMemo(() => Object.fromEntries(categoryOptions.map((category) => [category, books.filter((book) => book.category === category).length])), [books]);
  const platformCounts = useMemo(() => Object.fromEntries(platformOptions.map((platform) => [platform, books.filter((book) => book.format === "electronic" && book.electronicPlatform === platform).length])), [books]);

  const seriesGroups = useMemo(() => {
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
      const platforms = [...new Set(group.books.filter((book) => book.format === "electronic").map((book) => book.electronicPlatform).filter(Boolean))];
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
  }, [books]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const seriesUpdates = seriesGroups
    .filter((group) => group.nextVolumeNumber)
    .filter((group) => !normalizedQuery || `${group.seriesName} ${group.nextVolumeTitle} ${group.nextVolumeIsbn}`.toLocaleLowerCase("ja").includes(normalizedQuery));

  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    const filtered = books.filter((book) => {
      const statusMatch = status === "すべて" || book.status === status;
      const ownershipMatch = ownershipFilter === "all" || (ownershipFilter === "physical" ? book.format !== "electronic" : book.format === "electronic");
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
  }, [books, categoryFilter, ownershipFilter, platformFilter, query, sortMode, status, viewMode]);

  const queueState = latestUpload?.status || "ready";
  const uploadCopy = !serverOnline ? "サーバーに接続できません" : latestUpload?.status === "processing" ? "画像を解析中..." : latestUpload?.status === "needs_isbn" ? "ISBNの入力が必要です" : "iPhoneから画像を追加";
  const hasFilters = ownershipFilter !== "all" || categoryFilter !== "all" || platformFilter !== "all" || status !== "すべて";

  function resetLibraryFilters() {
    setViewMode("library");
    setOwnershipFilter("all");
    setCategoryFilter("all");
    setPlatformFilter("all");
    setStatus("すべて");
  }

  function chooseOwnership(format) {
    setViewMode("library");
    setOwnershipFilter(format);
    if (format !== "electronic") setPlatformFilter("all");
  }

  function choosePlatform(platform) {
    setViewMode("library");
    setOwnershipFilter("electronic");
    setPlatformFilter(platform);
  }

  function chooseCategory(category) {
    setViewMode("library");
    setCategoryFilter(category);
  }

  function openUploadPage() {
    window.open(config?.uploadUrl || "/upload", "_blank", "noopener,noreferrer");
  }

  function openCheckPage() {
    window.open(config?.checkUrl || "/check", "_blank", "noopener,noreferrer");
  }

  async function dismissUpload(uploadId = latestUpload?.id) {
    if (!uploadId) return;
    setLatestUpload((current) => current?.id === uploadId ? null : current);
    try {
      await requestJson(`/api/uploads/${uploadId}/dismiss`, { method: "POST" });
    } catch {
      // The next refresh will restore the notice if the server could not save the dismissal.
    }
  }

  function openEdit(book = null) {
    setEditingBook(book);
    setShowEditModal(true);
    setActionMessage("");
  }

  async function submitManualIsbn(event) {
    event.preventDefault();
    setActionBusy(true);
    setActionMessage("書籍情報を取得しています...");
    try {
      const result = await requestJson("/api/isbn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ isbn: isbnInput }) });
      await refreshLibrary();
      setSelectedId(result.book.id);
      setShowIsbnModal(false);
      setIsbnInput("");
      setActionMessage("");
    } catch (error) {
      setActionMessage(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleReadStatus() {
    if (!selectedBook) return;
    try {
      const result = await requestJson(`/api/books/${selectedBook.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: selectedBook.status === "読了" ? "未読" : "読了" }) });
      setBooks((current) => current.map((book) => String(book.id) === String(result.book.id) ? result.book : book));
    } catch (error) { setActionMessage(error.message); }
  }

  async function checkSeries() {
    if (!selectedBook?.seriesName) { openEdit(selectedBook); return; }
    setActionBusy(true);
    setActionMessage("シリーズを確認しています...");
    try {
      const result = await requestJson("/api/series/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seriesName: selectedBook.seriesName }) });
      setActionMessage(result.message);
      await refreshLibrary();
    } catch (error) { setActionMessage(error.message); }
    finally { setActionBusy(false); }
  }

  async function checkAllSeries() {
    setActionBusy(true);
    setActionMessage("登録シリーズの刊行情報を確認しています...");
    try {
      const result = await requestJson("/api/series/check-all", { method: "POST" });
      const failures = result.results.filter((item) => item.error).length;
      setActionMessage(`${result.checked}シリーズを更新しました${failures ? `（${failures}件は取得できませんでした）` : ""}。`);
      await refreshLibrary();
    } catch (error) { setActionMessage(error.message); }
    finally { setActionBusy(false); }
  }

  async function addRelease(update) {
    setActionBusy(true);
    setActionMessage(`${update.seriesName} ${update.nextVolumeNumber}巻を追加しています...`);
    try {
      const added = await requestJson("/api/isbn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ isbn: update.nextVolumeIsbn }) });
      const source = update.representative;
      await requestJson(`/api/books/${added.book.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "マンガ",
          format: source.format,
          physicalLocation: source.physicalLocation,
          electronicPlatform: source.electronicPlatform,
          shelf: source.shelf,
          seriesName: update.seriesName,
          volumeNumber: update.nextVolumeNumber,
        }),
      });
      await requestJson("/api/series/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seriesName: update.seriesName }) });
      setSelectedId(added.book.id);
      setActionMessage(`${update.seriesName} ${update.nextVolumeNumber}巻を本棚に追加しました。`);
      await refreshLibrary();
    } catch (error) { setActionMessage(error.message); }
    finally { setActionBusy(false); }
  }

  async function deleteSelected() {
    if (!selectedBook || !window.confirm(`「${selectedBook.title}」を本棚から削除しますか？`)) return;
    try { await requestJson(`/api/books/${selectedBook.id}`, { method: "DELETE" }); await refreshLibrary(); }
    catch (error) { setActionMessage(error.message); }
  }

  async function handleDrop(targetId) {
    if (sortMode !== "manual" || draggedId === null || String(draggedId) === String(targetId)) return;
    const ordered = [...books].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
    const from = ordered.findIndex((book) => String(book.id) === String(draggedId));
    const target = ordered.findIndex((book) => String(book.id) === String(targetId));
    if (from < 0 || target < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(target, 0, moved);
    setBooks(ordered.map((book, index) => ({ ...book, sortOrder: index })));
    setDraggedId(null);
    try {
      const result = await requestJson("/api/books/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ordered.map((book) => book.id) }) });
      setBooks(result.books);
    } catch (error) { setActionMessage(error.message); await refreshLibrary(); }
  }

  return (
    <main className={`app-shell ${viewMode === "new-releases" ? "wide-workspace" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><BookOpen size={28} /><div><strong>本棚カタログ</strong><span>蔵書管理</span></div></div>
        <nav className="sidebar-nav" aria-label="本棚の絞り込み">
          <span className="nav-section-title">表示</span>
          <button className={viewMode === "library" && !hasFilters ? "active" : ""} onClick={resetLibraryFilters} title="すべての本"><LibraryBig size={19} /><span>すべての本</span><b>{books.length}</b></button>
          <button className={viewMode === "new-releases" ? "active" : ""} onClick={() => { setViewMode("new-releases"); setActionMessage(""); }} title="新刊リスト"><BookCopy size={19} /><span>新刊リスト</span>{seriesUpdates.length > 0 && <b className="attention-count">{seriesUpdates.length}</b>}</button>
          <button className={viewMode === "reminders" ? "active" : ""} onClick={() => { setViewMode("reminders"); setOwnershipFilter("all"); setCategoryFilter("all"); setPlatformFilter("all"); }} title="リマインダー"><Bell size={19} /><span>リマインダー</span>{dueReminders.length > 0 && <b className="attention-count">{dueReminders.length}</b>}</button>

          <span className="nav-section-title">所有形態</span>
          <button className={viewMode === "library" && ownershipFilter === "physical" ? "active" : ""} onClick={() => chooseOwnership("physical")} title="実本"><Archive size={19} /><span>実本</span><b>{physicalCount}</b></button>
          <button className={viewMode === "library" && ownershipFilter === "electronic" && platformFilter === "all" ? "active" : ""} onClick={() => chooseOwnership("electronic")} title="電子書籍"><Smartphone size={19} /><span>電子書籍</span><b>{electronicCount}</b></button>
          {platformCatalog.filter((platform) => platform.featured || platformCounts[platform.name] > 0).map((platform) => (
            <div className="platform-nav-row" key={platform.name}>
              <button className={`subnav-button ${viewMode === "library" && platformFilter === platform.name ? "active" : ""}`} onClick={() => choosePlatform(platform.name)}><span>{platform.name}</span><b>{platformCounts[platform.name] || 0}</b></button>
              {platform.url && <a aria-label={`${platform.name}公式サイトを開く`} href={platform.url} rel="noreferrer" target="_blank"><ExternalLink size={13} /></a>}
            </div>
          ))}

          <span className="nav-section-title">カテゴリ</span>
          {categoryOptions.filter((category) => categoryCounts[category] > 0 || category === "マンガ" || category === "小説").map((category) => (
            <button className={viewMode === "library" && categoryFilter === category ? "active" : ""} key={category} onClick={() => chooseCategory(category)} title={category}><BookOpen size={18} /><span>{category}</span><b>{categoryCounts[category] || 0}</b></button>
          ))}
        </nav>
        <section className="lan-card" aria-label="LAN upload">
          <div><strong>iPhone連携</strong><span>本の追加と、店頭へ持ち出す蔵書データの同期</span></div>
          <div className="qr-tile">{config?.qrCode ? <img src={config.qrCode} alt="iPhoneアップロード用QRコード" /> : <QrCode size={70} />}</div>
          <code>{config?.uploadUrl || "サーバー接続を確認中..."}</code>
          <button disabled={!config} onClick={openUploadPage}>本を追加 <MoveRight size={16} /></button>
          <button disabled={!config} onClick={openCheckPage}><Check size={16} />買う前チェック</button>
        </section>
      </aside>

      <section className="workspace">
        <header className="search-console">
          <div className="console-title">{viewMode === "new-releases" ? "新刊リスト" : viewMode === "reminders" ? "リマインダー" : "本を検索"}<span className={`connection-status ${serverOnline ? "online" : "offline"}`}><Wifi size={14} />{serverOnline ? "サーバー稼働中" : "オフライン"}</span></div>
          <div className="top-row">
            <label className="search-field"><Search size={24} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={viewMode === "new-releases" ? "シリーズ名・ISBNで検索..." : "タイトル・著者・ISBN・シリーズ・場所で検索..."} />{query && <button className="clear" onClick={() => setQuery("")} aria-label="検索を消去">×</button>}</label>
            <button className="utility-button" onClick={() => openEdit(null)}><Plus size={19} />手動追加</button>
            <button className="primary-button" disabled={!serverOnline} onClick={openUploadPage}><Upload size={21} /><span>アップロード<small>{uploadCopy}</small></span></button>
            <button className="isbn-button" disabled={!serverOnline} onClick={() => setShowIsbnModal(true)}><Barcode size={21} /><span>ISBNを入力<small>書誌情報から追加</small></span></button>
          </div>
          {viewMode !== "new-releases" && <div className="filter-row" aria-label="filters">
            <label className="filter-select"><span>所有形態</span><select onChange={(event) => { setOwnershipFilter(event.target.value); if (event.target.value !== "electronic") setPlatformFilter("all"); }} value={ownershipFilter}><option value="all">すべて</option><option value="physical">実本</option><option value="electronic">電子書籍</option></select><ChevronDown size={14} /></label>
            {ownershipFilter === "electronic" && <label className="filter-select"><span>電子媒体</span><select onChange={(event) => setPlatformFilter(event.target.value)} value={platformFilter}><option value="all">すべて</option>{platformOptions.map((platform) => <option key={platform}>{platform}</option>)}</select><ChevronDown size={14} /></label>}
            <label className="filter-select"><span>カテゴリ</span><select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}><option value="all">すべて</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={14} /></label>
            {["未読", "読了"].map((label) => <button className={status === label ? "selected" : ""} key={label} onClick={() => setStatus(status === label ? "すべて" : label)}>{label === "読了" ? <Check size={15} /> : <Circle size={15} />}{label}</button>)}
            {hasFilters && <button className="filter-clear" onClick={resetLibraryFilters}><X size={15} />解除</button>}
          </div>}
          {(dueReminders.length > 0 || seriesUpdates.length > 0) && <button className="reminder-strip" onClick={() => setViewMode(seriesUpdates.length > 0 ? "new-releases" : "reminders")}><Bell size={16} /><span>{dueReminders.length > 0 ? `期限到来 ${dueReminders.length}件` : ""}{dueReminders.length > 0 && seriesUpdates.length > 0 ? "・" : ""}{seriesUpdates.length > 0 ? `新刊候補 ${seriesUpdates.length}シリーズ` : ""}</span><MoveRight size={15} /></button>}
        </header>

        {viewMode !== "new-releases" && <section className="shelf-toolbar">
          <label className="sort-control"><select aria-label="並び替え" onChange={(event) => setSortMode(event.target.value)} value={sortMode}><option value="newest">新着順</option><option value="title">名前順</option><option value="author">作者順</option><option value="series">シリーズ・巻数順</option><option value="location">保管場所・媒体順</option><option value="manual">手動（ドラッグ）</option></select><ChevronDown size={15} /></label>
          <span>{visibleBooks.length}冊</span>
        </section>}

        {viewMode === "new-releases" ? (
          <NewReleaseView busy={actionBusy} message={actionMessage} onAdd={addRelease} onRefresh={checkAllSeries} updates={seriesUpdates} />
        ) : (
          <section className="library-stage" aria-label="book shelf">
            <div className="shelf-image" />
            <div className={`cover-strip ${sortMode === "manual" ? "manual-sort" : ""}`}>
              {visibleBooks.map((book) => (
                <div className="cover-wrap" draggable={sortMode === "manual"} key={book.id} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => sortMode === "manual" && event.preventDefault()} onDragStart={() => setDraggedId(book.id)} onDrop={(event) => { event.preventDefault(); handleDrop(book.id); }}>
                  {sortMode === "manual" && <GripVertical className="drag-handle" size={18} />}
                  <Cover book={book} selected={String(book.id) === String(selectedId)} onSelect={() => { setSelectedId(book.id); setDetailOpen(true); }} />
                  <span>{book.category === "マンガ" && book.volumeNumber ? `${book.seriesName || book.title} ${book.volumeNumber}巻` : book.title}</span>
                  <small>{book.category || "その他"}・{formatLabel(book)}・{locationLabel(book)}</small>
                </div>
              ))}
            </div>
            {latestUpload && <div className={`upload-queue ${queueState}`} role="status"><div className="barcode-thumb">{queueState === "success" ? <Check size={30} /> : <Barcode size={34} />}</div><div className="upload-queue-copy"><strong>{latestUpload.originalName || "iPhoneからの追加"}</strong><span>{latestUpload.message}</span>{latestUpload.isbn && <code>{latestUpload.isbn}</code>}</div><button aria-label="通知を閉じる" className="queue-dismiss" onClick={() => dismissUpload()} title="閉じる" type="button"><X size={17} /></button></div>}
          </section>
        )}
      </section>

      {viewMode !== "new-releases" && selectedBook && detailOpen && <button aria-label="詳細を閉じる" className="detail-scrim" onClick={() => setDetailOpen(false)} type="button" />}
      {viewMode !== "new-releases" && selectedBook && <aside className={`detail-pane enhanced-detail ${detailOpen ? "compact-open" : ""}`}>
        <button aria-label="詳細を閉じる" className="detail-close" onClick={() => setDetailOpen(false)} title="閉じる" type="button"><X size={19} /></button>
        <div className="detail-cover"><img src={selectedBook.coverUrl || "/assets/selected-cover.png"} alt={`${selectedBook.title}の表紙`} /><span>{selectedBook.title}</span><small>{selectedBook.author}</small></div>
        <div className="book-heading"><div className="book-badges"><span>{selectedBook.category || "その他"}</span><span>{formatLabel(selectedBook)}</span>{selectedBook.format === "electronic" && <span>{selectedBook.electronicPlatform}</span>}</div><h1>{selectedBook.title}</h1><p>{selectedBook.author}</p><div className="rating" aria-label={`${selectedBook.rating || 0} star rating`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={20} className={star <= (selectedBook.rating || 0) ? "filled" : ""} />)}<span>{selectedBook.rating || 0}.0</span></div><button className={`read-toggle ${selectedBook.status === "読了" ? "done" : ""}`} onClick={toggleReadStatus}>{selectedBook.status === "読了" ? <Check size={18} /> : <Circle size={18} />}{selectedBook.status}</button></div>
        <div className="form-stack ownership-fields">
          <label><span>{selectedBook.format === "electronic" ? "電子媒体" : "保管場所"}</span><button onClick={() => openEdit(selectedBook)}>{locationLabel(selectedBook)}<MapPin size={16} /></button></label>
          <label><span>分類・棚</span><input readOnly value={selectedBook.shelf || "未整理"} /></label>
          <label><span>ISBN</span><input readOnly value={selectedBook.isbn || "ISBNなし"} /></label>
          <label><span>出版社・出版年</span><input readOnly value={[selectedBook.publisher, selectedBook.published].filter(Boolean).join(" / ") || "未取得"} /></label>
          {selectedBook.format === "electronic" && electronicBookUrl(selectedBook) && <label className="store-link-field"><span>リンク</span><a href={electronicBookUrl(selectedBook)} rel="noreferrer" target="_blank"><ExternalLink size={15} />{selectedBook.electronicUrl ? "作品ページ・本棚を開く" : `${selectedBook.electronicPlatform}公式サイトを開く`}</a></label>}
        </div>
        {(selectedBook.category === "マンガ" || selectedBook.seriesName) && <section className="series-panel"><header><div><BookCopy size={17} /><span>シリーズ</span></div><button disabled={actionBusy} onClick={checkSeries}><RefreshCw className={actionBusy ? "spin" : ""} size={15} />新刊確認</button></header><strong>{selectedBook.seriesName || "シリーズ名未設定"}</strong><p>{selectedBook.volumeNumber ? `所持巻: ${selectedBook.volumeNumber}巻` : "巻数未設定"}{selectedBook.seriesLatestVolume ? ` / 確認済み最新: ${selectedBook.seriesLatestVolume}巻` : ""}</p>{selectedBook.nextVolumeNumber && <button className="series-update" onClick={() => setViewMode("new-releases")}><Bell size={16} /><span>{selectedBook.nextVolumeNumber}巻を登録できます</span><small>{selectedBook.nextVolumePublished}</small></button>}{actionMessage && <small className="series-message">{actionMessage}</small>}</section>}
        {selectedBook.reminderDate && <section className={`reminder-panel ${selectedBook.reminderDate <= today ? "due" : ""}`}><CalendarClock size={18} /><div><span>{selectedBook.reminderDate}</span><strong>{selectedBook.reminderNote || "リマインダー"}</strong></div></section>}
        <div className="tag-list">{(selectedBook.tags || []).map((tag) => <button key={tag}>{tag}</button>)}<button onClick={() => openEdit(selectedBook)}>+ タグを追加</button></div>
        <section className="memo"><div><span>メモ</span><button onClick={() => openEdit(selectedBook)}>メモを編集</button></div><p>{selectedBook.note || "メモはありません。"}</p>{selectedBook.metadataSource && <small className="metadata-source">書誌情報: {selectedBook.metadataSource}</small>}</section>
        <footer className="detail-actions"><button onClick={() => openEdit(selectedBook)}><Edit3 size={19} />編集</button><button onClick={() => openEdit(selectedBook)}><FolderOpen size={19} />場所</button><button onClick={toggleReadStatus}><Check size={19} />{selectedBook.status === "読了" ? "未読に戻す" : "読了にする"}</button><button onClick={deleteSelected}><Trash2 size={19} />削除</button><button><MoreHorizontal size={19} />その他</button></footer>
      </aside>}

      {showIsbnModal && <div className="modal-backdrop" onMouseDown={() => setShowIsbnModal(false)}><form className="isbn-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submitManualIsbn}><header><div><Barcode size={22} /><strong>ISBNから本を追加</strong></div><button aria-label="閉じる" onClick={() => setShowIsbnModal(false)} type="button"><X size={20} /></button></header><p>本の裏表紙にあるISBN-10またはISBN-13を入力します。</p><label><span>ISBN</span><input autoFocus inputMode="numeric" onChange={(event) => setIsbnInput(event.target.value)} placeholder="9784087451224" value={isbnInput} /></label>{actionMessage && <div className="modal-message">{actionMessage}</div>}<footer><button onClick={() => setShowIsbnModal(false)} type="button">キャンセル</button><button className="modal-submit" disabled={actionBusy} type="submit">{actionBusy ? <RefreshCw className="spin" size={17} /> : <ExternalLink size={17} />}書籍情報を取得</button></footer></form></div>}
      {showEditModal && <BookEditModal book={editingBook} onClose={() => setShowEditModal(false)} onSaved={async (book) => { setShowEditModal(false); await refreshLibrary(); setSelectedId(book.id); }} />}
    </main>
  );
}
