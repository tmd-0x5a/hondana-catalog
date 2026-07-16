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
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  LibraryBig,
  MapPin,
  MoveRight,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  Star,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";

import { requestJson } from "./api.js";
import { BulkImportModal } from "./components/BulkImportModal.jsx";
import { LibraryFilterPanel } from "./components/LibraryFilterPanel.jsx";
import { LibrarySettings } from "./components/LibrarySettings.jsx";
import { LibraryShelf } from "./components/LibraryShelf.jsx";
import { RecommendationView } from "./components/RecommendationView.jsx";
import { SeriesDetailView } from "./components/SeriesDetailView.jsx";
import { showFallbackCover } from "./cover-image.js";
import {
  buildSeriesGroups,
  buildShelfEntries,
  buildShelfSections,
  CATEGORY_OPTIONS as categoryOptions,
  electronicBookUrl,
  filterAndSortBooks,
  formatLabel,
  localDateString,
  locationLabel,
  PLATFORM_CATALOG as platformCatalog,
  platformHomeUrl,
  PLATFORM_OPTIONS as platformOptions,
} from "./library-model.js";
import { loadLibraryPreferences, saveLibraryPreferences } from "./library-preferences.js";
import { sampleBooks } from "./sampleBooks.js";

/** 新規登録と編集を共用し、ISBN候補がある場合は書誌取得後に所蔵情報を確定する。 */
function BookEditModal({ book, onClose, onSaved }) {
  const isNew = !book;
  const [form, setForm] = useState({
    title: book?.title || "",
    titleReading: book?.titleReading || "",
    author: book?.author || "",
    authorReading: book?.authorReading || "",
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
    rating: book?.rating || 0,
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
    // 入力途中の検索を送らず、次の文字が来たら前回リクエストも中断する。
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
        volumeNumber: Number(form.volumeNumber) || null,
        tags: form.tags.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean),
      };
      const { isbn: _immutableIsbn, ...updatePayload } = payload;
      let result;
      if (isNew && String(form.isbn).replace(/[^0-9X]/gi, "").length >= 10) {
        // ISBN登録で表紙を取得した後、ユーザーがフォームへ入力した所蔵情報を上書きして確定する。
        const imported = await requestJson("/api/isbn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isbn: form.isbn }),
        });
        const importedPayload = selectedSuggestion ? {
          ...updatePayload,
          title: imported.book.title || updatePayload.title,
          titleReading: updatePayload.titleReading || imported.book.titleReading,
          author: imported.book.author && imported.book.author !== "著者情報なし" ? imported.book.author : updatePayload.author,
          authorReading: updatePayload.authorReading || imported.book.authorReading,
          publisher: imported.book.publisher || updatePayload.publisher,
          published: imported.book.published || updatePayload.published,
          category: imported.book.category && imported.book.category !== "その他" ? imported.book.category : updatePayload.category,
          seriesName: imported.book.seriesName || updatePayload.seriesName,
          volumeNumber: imported.book.volumeNumber || updatePayload.volumeNumber,
        } : updatePayload;
        result = await requestJson(`/api/books/${imported.book.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(importedPayload),
        });
      } else {
        result = await requestJson(isNew ? "/api/books" : `/api/books/${book.id}`, {
          method: isNew ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(isNew ? payload : updatePayload),
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
            {selectedSuggestion?.coverUrl && <div className="selected-suggestion"><img src={selectedSuggestion.coverUrl} alt="候補の表紙" onError={showFallbackCover} /><span><strong>表紙を取得します</strong><small>ISBN {selectedSuggestion.isbn}</small></span></div>}
            {suggestions.length > 0 && <div className="book-suggestions">
              {suggestions.map((suggestion) => <button key={suggestion.isbn} onClick={() => chooseSuggestion(suggestion)} type="button"><img src={suggestion.coverUrl || "/assets/selected-cover.png"} alt="" onError={showFallbackCover} /><span><strong>{suggestion.title}</strong><small>{suggestion.author || "著者情報なし"}{suggestion.published ? `・${suggestion.published}` : ""}</small><code>{suggestion.isbn}</code></span></button>)}
              <a href="https://ndlsearch.ndl.go.jp/" rel="noreferrer" target="_blank">書誌候補: NDLサーチAPI <ExternalLink size={12} /></a>
            </div>}
          </div>
          <label><span>著者</span><input onChange={(event) => update("author", event.target.value)} value={form.author} /></label>
          <label><span>ISBN</span><input disabled={!isNew} onChange={(event) => update("isbn", event.target.value)} value={form.isbn} /></label>
          <label><span>タイトルよみ</span><input onChange={(event) => update("titleReading", event.target.value)} placeholder="そうそうのふりーれん" value={form.titleReading} /></label>
          <label><span>著者よみ</span><input onChange={(event) => update("authorReading", event.target.value)} placeholder="やまだ たろう" value={form.authorReading} /></label>
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
          <label className="wide-field"><span>評価</span><select onChange={(event) => update("rating", Number(event.target.value))} value={form.rating}><option value="0">未評価</option><option value="1">★ 1</option><option value="2">★★ 2</option><option value="3">★★★ 3</option><option value="4">★★★★ 4</option><option value="5">★★★★★ 5</option></select></label>

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

/** シリーズ集約済みのデータだけを受け取り、新刊確認操作を表示へ結び付ける。 */
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
              <img src={update.coverUrl || "/assets/selected-cover.png"} alt={`${update.seriesName}の表紙`} onError={showFallbackCover} />
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

/** PC本棚の画面状態とAPI操作を束ねる最上位コンポーネント。表示計算はlibrary-modelへ委譲する。 */
/** @returns {import("react").ReactElement} PC向け蔵書管理画面。 */
export function DesktopLibrary() {
  const [books, setBooks] = useState(sampleBooks);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const [viewMode, setViewMode] = useState("library");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [publisherFilter, setPublisherFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const [minimumRating, setMinimumRating] = useState(0);
  const [seriesFilter, setSeriesFilter] = useState("all");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [sortMode, setSortMode] = useState(() => localStorage.getItem("hondana-sort") || "newest");
  const [preferences, setPreferences] = useState(loadLibraryPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(sampleBooks[0].id);
  const [activeSeriesKey, setActiveSeriesKey] = useState("");
  const [config, setConfig] = useState(null);
  const [latestUpload, setLatestUpload] = useState(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [showIsbnModal, setShowIsbnModal] = useState(false);
  const [bulkImportFormat, setBulkImportFormat] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [isbnInput, setIsbnInput] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth > 1480);
  const [recommendationData, setRecommendationData] = useState({ recommendations: [], seedCount: 0 });
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");

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
    // iPhoneは別端末なので共有状態を持てない。短いポーリングで登録結果と通知をPCへ反映する。
    const timer = window.setInterval(refreshLibrary, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => { localStorage.setItem("hondana-sort", sortMode); }, [sortMode]);
  useEffect(() => { saveLibraryPreferences(preferences); }, [preferences]);
  useEffect(() => {
    const compactWindow = window.matchMedia("(max-width: 1480px)");
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
  const filterOptions = useMemo(() => ({
    authors: [...new Set(books.map((book) => book.author).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja")),
    publishers: [...new Set(books.map((book) => book.publisher).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja")),
  }), [books]);

  const seriesGroups = useMemo(() => buildSeriesGroups(books), [books]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const seriesUpdates = seriesGroups
    .filter((group) => group.nextVolumeNumber)
    .filter((group) => !normalizedQuery || `${group.seriesName} ${group.nextVolumeTitle} ${group.nextVolumeIsbn}`.toLocaleLowerCase("ja").includes(normalizedQuery));

  const visibleBooks = useMemo(() => filterAndSortBooks(books, {
    authorFilter,
    categoryFilter,
    minimumRating,
    ownershipFilter,
    platformFilter,
    publisherFilter,
    query,
    seriesFilter,
    sortMode,
    status,
    viewMode,
  }), [authorFilter, books, categoryFilter, minimumRating, ownershipFilter, platformFilter, publisherFilter, query, seriesFilter, sortMode, status, viewMode]);

  const shelfEntries = useMemo(() => buildShelfEntries(visibleBooks, {
    groupSeries: preferences.groupSeries && sortMode !== "manual",
  }), [preferences.groupSeries, sortMode, visibleBooks]);
  const shelfSections = useMemo(() => buildShelfSections(
    shelfEntries,
    sortMode,
    preferences.showSectionHeaders,
  ), [preferences.showSectionHeaders, shelfEntries, sortMode]);
  const allSeriesEntries = useMemo(() => buildShelfEntries(books).filter((entry) => entry.kind === "series"), [books]);
  const activeSeries = allSeriesEntries.find((entry) => entry.seriesKey === activeSeriesKey);

  const queueState = latestUpload?.status || "ready";
  const uploadCopy = !serverOnline ? "サーバーに接続できません" : latestUpload?.status === "processing" ? "画像を解析中..." : latestUpload?.status === "needs_isbn" ? "ISBNの入力が必要です" : "iPhoneから画像を追加";
  const hasFilters = ownershipFilter !== "all" || categoryFilter !== "all" || platformFilter !== "all"
    || publisherFilter !== "all" || authorFilter !== "all" || minimumRating > 0
    || seriesFilter !== "all" || status !== "すべて";
  const displaysBookDetail = viewMode === "library" || viewMode === "reminders" || viewMode === "series";
  const showsLibraryControls = viewMode === "library" || viewMode === "reminders";

  function resetLibraryFilters() {
    setViewMode("library");
    setOwnershipFilter("all");
    setCategoryFilter("all");
    setPlatformFilter("all");
    setPublisherFilter("all");
    setAuthorFilter("all");
    setMinimumRating(0);
    setSeriesFilter("all");
    setStatus("すべて");
  }

  function updateAdvancedFilters(changes) {
    if (changes.publisherFilter !== undefined) setPublisherFilter(changes.publisherFilter);
    if (changes.authorFilter !== undefined) setAuthorFilter(changes.authorFilter);
    if (changes.minimumRating !== undefined) setMinimumRating(changes.minimumRating);
    if (changes.seriesFilter !== undefined) setSeriesFilter(changes.seriesFilter);
  }

  function updatePreferences(changes) {
    setPreferences((current) => ({ ...current, ...changes }));
  }

  function openSeries(seriesKey) {
    setActiveSeriesKey(seriesKey);
    setViewMode("series");
    setDetailOpen(false);
  }

  function openRecommendations() {
    setViewMode("recommendations");
    if (!recommendationBusy && recommendationData.recommendations.length === 0) void loadRecommendations();
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
    window.open(config?.authorizedUploadUrl || config?.uploadUrl || "/upload", "_blank", "noopener,noreferrer");
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

  async function finishBulkImport(result) {
    await refreshLibrary();
    const failureCopy = result.failedCount ? `、${result.failedCount}件失敗` : "";
    setActionMessage(`${result.processedCount}件を一括処理しました${failureCopy}。`);
    const lastBook = result.books?.at(-1);
    if (lastBook) setSelectedId(lastBook.id);
  }

  async function updateRating(rating) {
    if (!selectedBook) return;
    const nextRating = Number(selectedBook.rating || 0) === rating ? 0 : rating;
    try {
      const result = await requestJson(`/api/books/${selectedBook.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: nextRating }),
      });
      setBooks((current) => current.map((book) => String(book.id) === String(result.book.id) ? result.book : book));
    } catch (error) {
      setActionMessage(error.message);
    }
  }

  async function refreshSelectedCover() {
    if (!selectedBook?.isbn) {
      setActionMessage("ISBNがないため表紙を再取得できません。");
      return;
    }
    setActionBusy(true);
    setActionMessage("表紙画像を再取得しています...");
    try {
      const result = await requestJson(`/api/books/${selectedBook.id}/refresh-cover`, { method: "POST" });
      setBooks((current) => current.map((book) => String(book.id) === String(result.book.id) ? result.book : book));
      setActionMessage("表紙画像を更新しました。");
    } catch (error) {
      setActionMessage(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function loadRecommendations() {
    setRecommendationBusy(true);
    setRecommendationError("");
    try {
      setRecommendationData(await requestJson("/api/recommendations"));
    } catch (error) {
      setRecommendationError(error.message);
    } finally {
      setRecommendationBusy(false);
    }
  }

  async function addRecommendation(recommendation) {
    setRecommendationBusy(true);
    setRecommendationError("");
    try {
      const result = await requestJson("/api/isbn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isbn: recommendation.isbn }),
      });
      await refreshLibrary();
      setSelectedId(result.book.id);
      setViewMode("library");
      setDetailOpen(true);
    } catch (error) {
      setRecommendationError(error.message);
    } finally {
      setRecommendationBusy(false);
    }
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
      // ISBNで書誌を作成し、代表巻の所有形態を引き継いでからシリーズ情報を再計算する。
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
    // 先に画面を更新し、保存失敗時だけサーバーの順序へ戻す楽観的更新。
    setBooks(ordered.map((book, index) => ({ ...book, sortOrder: index })));
    setDraggedId(null);
    try {
      const result = await requestJson("/api/books/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ordered.map((book) => book.id) }) });
      setBooks(result.books);
    } catch (error) { setActionMessage(error.message); await refreshLibrary(); }
  }

  return (
    <main className={`app-shell ${viewMode === "new-releases" || viewMode === "recommendations" ? "wide-workspace" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><BookOpen size={28} /><div><strong>本棚カタログ</strong><span>蔵書管理</span></div></div>
        <nav className="sidebar-nav" aria-label="本棚の絞り込み">
          <span className="nav-section-title">表示</span>
          <button className={viewMode === "library" && !hasFilters ? "active" : ""} onClick={resetLibraryFilters} title="すべての本"><LibraryBig size={19} /><span>すべての本</span><b>{books.length}</b></button>
          <button className={viewMode === "new-releases" ? "active" : ""} onClick={() => { setViewMode("new-releases"); setActionMessage(""); }} title="新刊リスト"><BookCopy size={19} /><span>新刊リスト</span>{seriesUpdates.length > 0 && <b className="attention-count">{seriesUpdates.length}</b>}</button>
          <button className={viewMode === "reminders" ? "active" : ""} onClick={() => { setViewMode("reminders"); setOwnershipFilter("all"); setCategoryFilter("all"); setPlatformFilter("all"); }} title="リマインダー"><Bell size={19} /><span>リマインダー</span>{dueReminders.length > 0 && <b className="attention-count">{dueReminders.length}</b>}</button>
          <button className={viewMode === "recommendations" ? "active" : ""} onClick={openRecommendations} title="おすすめ"><Sparkles size={19} /><span>おすすめ</span></button>

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

      <section className={`workspace ${showsLibraryControls ? "" : "without-toolbar"}`}>
        <header className="search-console">
          <div className="console-title">{viewMode === "new-releases" ? "新刊リスト" : viewMode === "reminders" ? "リマインダー" : viewMode === "recommendations" ? "おすすめ" : viewMode === "series" ? activeSeries?.title || "シリーズ" : "本を検索"}<span className={`connection-status ${serverOnline ? "online" : "offline"}`}><Wifi size={14} />{serverOnline ? "サーバー稼働中" : "オフライン"}</span></div>
          <div className="top-row">
            <label className="search-field"><Search size={24} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={viewMode === "new-releases" ? "シリーズ名・ISBNで検索..." : "タイトル・著者・ISBN・シリーズ・場所で検索..."} />{query && <button className="clear" onClick={() => setQuery("")} aria-label="検索を消去">×</button>}</label>
            <button className="utility-button" onClick={() => openEdit(null)}><Plus size={19} />手動追加</button>
            <button className="primary-button" disabled={!serverOnline} onClick={openUploadPage}><Upload size={21} /><span>アップロード<small>{uploadCopy}</small></span></button>
            <button className="isbn-button" disabled={!serverOnline} onClick={() => setShowIsbnModal(true)}><Barcode size={21} /><span>ISBNを入力<small>書誌情報から追加</small></span></button>
          </div>
          {showsLibraryControls && <div className="filter-row" aria-label="filters">
            <label className="filter-select"><span>所有形態</span><select onChange={(event) => { setOwnershipFilter(event.target.value); if (event.target.value !== "electronic") setPlatformFilter("all"); }} value={ownershipFilter}><option value="all">すべて</option><option value="physical">実本</option><option value="electronic">電子書籍</option></select><ChevronDown size={14} /></label>
            {ownershipFilter === "electronic" && <label className="filter-select"><span>電子媒体</span><select onChange={(event) => setPlatformFilter(event.target.value)} value={platformFilter}><option value="all">すべて</option>{platformOptions.map((platform) => <option key={platform}>{platform}</option>)}</select><ChevronDown size={14} /></label>}
            <label className="filter-select"><span>カテゴリ</span><select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}><option value="all">すべて</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={14} /></label>
            {["未読", "読了"].map((label) => <button className={status === label ? "selected" : ""} key={label} onClick={() => setStatus(status === label ? "すべて" : label)}>{label === "読了" ? <Check size={15} /> : <Circle size={15} />}{label}</button>)}
            <button className={advancedFiltersOpen ? "selected" : ""} onClick={() => setAdvancedFiltersOpen((open) => !open)} type="button"><SlidersHorizontal size={15} />詳細</button>
            {hasFilters && <button className="filter-clear" onClick={resetLibraryFilters}><X size={15} />解除</button>}
          </div>}
          {showsLibraryControls && <LibraryFilterPanel filters={{ authorFilter, minimumRating, publisherFilter, seriesFilter }} onChange={updateAdvancedFilters} open={advancedFiltersOpen} options={filterOptions} />}
          {(dueReminders.length > 0 || seriesUpdates.length > 0) && <button className="reminder-strip" onClick={() => setViewMode(seriesUpdates.length > 0 ? "new-releases" : "reminders")}><Bell size={16} /><span>{dueReminders.length > 0 ? `期限到来 ${dueReminders.length}件` : ""}{dueReminders.length > 0 && seriesUpdates.length > 0 ? "・" : ""}{seriesUpdates.length > 0 ? `新刊候補 ${seriesUpdates.length}シリーズ` : ""}</span><MoveRight size={15} /></button>}
        </header>

        {showsLibraryControls && <section className="shelf-toolbar">
          <label className="sort-control"><select aria-label="並び替え" onChange={(event) => setSortMode(event.target.value)} value={sortMode}><option value="newest">新着順</option><option value="title">名前順</option><option value="author">作者順</option><option value="publisher">出版社順</option><option value="series">シリーズ・巻数順</option><option value="location">保管場所・媒体順</option><option value="manual">手動（ドラッグ）</option></select><ChevronDown size={15} /></label>
          <span>{visibleBooks.length}冊 / {shelfEntries.length}項目</span>
          <div className="shelf-toolbar-actions">
            <button disabled={!serverOnline} onClick={() => setBulkImportFormat("physical")} title="実本をまとめて取り込む" type="button"><Archive size={16} /><span>実本を一括</span></button>
            <button disabled={!serverOnline} onClick={() => setBulkImportFormat("electronic")} title="電子書籍を媒体ごとにまとめて取り込む" type="button"><Smartphone size={16} /><span>電子を一括</span></button>
            <button className={preferences.showSectionHeaders ? "active" : ""} onClick={() => updatePreferences({ showSectionHeaders: !preferences.showSectionHeaders })} title={preferences.showSectionHeaders ? "仕切りを非表示" : "仕切りを表示"} type="button">
              {preferences.showSectionHeaders ? <Eye size={16} /> : <EyeOff size={16} />}<span>仕切り</span>
            </button>
            <LibrarySettings onChange={updatePreferences} onClose={() => setSettingsOpen(false)} onToggle={() => setSettingsOpen((open) => !open)} open={settingsOpen} preferences={preferences} />
          </div>
        </section>}

        {viewMode === "new-releases" ? (
          <NewReleaseView busy={actionBusy} message={actionMessage} onAdd={addRelease} onRefresh={checkAllSeries} updates={seriesUpdates} />
        ) : viewMode === "recommendations" ? (
          <RecommendationView
            busy={recommendationBusy}
            error={recommendationError}
            onAdd={addRecommendation}
            onRefresh={loadRecommendations}
            recommendations={recommendationData.recommendations}
            seedCount={recommendationData.seedCount}
          />
        ) : viewMode === "series" ? (
          <SeriesDetailView
            bookWidth={preferences.bookWidth}
            onBack={() => { setViewMode("library"); setActiveSeriesKey(""); }}
            onSelectBook={(bookId) => { setSelectedId(bookId); setDetailOpen(true); }}
            selectedId={selectedId}
            series={activeSeries}
          />
        ) : (
          <LibraryShelf
            bookWidth={preferences.bookWidth}
            draggedId={draggedId}
            latestUpload={latestUpload}
            manualSort={sortMode === "manual"}
            onDismissUpload={() => dismissUpload()}
            onDragEnd={() => setDraggedId(null)}
            onDragStart={setDraggedId}
            onDrop={handleDrop}
            onOpenSeries={openSeries}
            onSelectBook={(bookId) => { setSelectedId(bookId); setDetailOpen(true); }}
            queueState={queueState}
            sections={shelfSections}
            selectedId={selectedId}
          />
        )}
      </section>

      {displaysBookDetail && selectedBook && detailOpen && <button aria-label="詳細を閉じる" className="detail-scrim" onClick={() => setDetailOpen(false)} type="button" />}
      {displaysBookDetail && selectedBook && <aside className={`detail-pane enhanced-detail ${detailOpen ? "compact-open" : ""}`}>
        <button aria-label="詳細を閉じる" className="detail-close" onClick={() => setDetailOpen(false)} title="閉じる" type="button"><X size={19} /></button>
        <div className="detail-cover"><img src={selectedBook.coverUrl || "/assets/selected-cover.png"} alt={`${selectedBook.title}の表紙`} onError={showFallbackCover} /><span>{selectedBook.title}</span><small>{selectedBook.author}</small></div>
        <div className="book-heading"><div className="book-badges"><span>{selectedBook.category || "その他"}</span><span>{formatLabel(selectedBook)}</span>{selectedBook.format === "electronic" && <span>{selectedBook.electronicPlatform}</span>}</div><h1>{selectedBook.title}</h1><p>{selectedBook.author}</p><div className="rating" aria-label={`評価 ${selectedBook.rating || 0}`}><div>{[1, 2, 3, 4, 5].map((star) => <button aria-label={`${star}点で評価`} className={star <= (selectedBook.rating || 0) ? "filled" : ""} key={star} onClick={() => updateRating(star)} title={`${star}点`} type="button"><Star size={20} /></button>)}</div><span>{selectedBook.rating || 0}.0</span></div><button className={`read-toggle ${selectedBook.status === "読了" ? "done" : ""}`} onClick={toggleReadStatus}>{selectedBook.status === "読了" ? <Check size={18} /> : <Circle size={18} />}{selectedBook.status}</button></div>
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
        <footer className="detail-actions"><button onClick={() => openEdit(selectedBook)}><Edit3 size={19} />編集</button><button onClick={() => openEdit(selectedBook)}><FolderOpen size={19} />場所</button><button onClick={toggleReadStatus}><Check size={19} />{selectedBook.status === "読了" ? "未読に戻す" : "読了にする"}</button><button onClick={deleteSelected}><Trash2 size={19} />削除</button><button disabled={actionBusy} onClick={refreshSelectedCover}><RefreshCw className={actionBusy ? "spin" : ""} size={19} />表紙</button></footer>
      </aside>}

      {showIsbnModal && <div className="modal-backdrop" onMouseDown={() => setShowIsbnModal(false)}><form className="isbn-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submitManualIsbn}><header><div><Barcode size={22} /><strong>ISBNから本を追加</strong></div><button aria-label="閉じる" onClick={() => setShowIsbnModal(false)} type="button"><X size={20} /></button></header><p>本の裏表紙にあるISBN-10またはISBN-13を入力します。</p><label><span>ISBN</span><input autoFocus inputMode="numeric" onChange={(event) => setIsbnInput(event.target.value)} placeholder="9784087451224" value={isbnInput} /></label>{actionMessage && <div className="modal-message">{actionMessage}</div>}<footer><button onClick={() => setShowIsbnModal(false)} type="button">キャンセル</button><button className="modal-submit" disabled={actionBusy} type="submit">{actionBusy ? <RefreshCw className="spin" size={17} /> : <ExternalLink size={17} />}書籍情報を取得</button></footer></form></div>}
      {bulkImportFormat && <BulkImportModal initialFormat={bulkImportFormat} onClose={() => setBulkImportFormat(null)} onImported={finishBulkImport} />}
      {showEditModal && <BookEditModal book={editingBook} onClose={() => setShowEditModal(false)} onSaved={async (book) => { setShowEditModal(false); await refreshLibrary(); setSelectedId(book.id); }} />}
    </main>
  );
}
