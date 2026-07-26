import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Barcode,
  Bell,
  Check,
  ChevronDown,
  Circle,
  Eye,
  EyeOff,
  Images,
  MoveRight,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  Wifi,
  X,
} from "lucide-react";

import { requestJson } from "./api.js";
import { BookDetailPane } from "./components/BookDetailPane.jsx";
import { BookEditModal } from "./components/BookEditModal.jsx";
import { BookPackView } from "./components/BookPackView.jsx";
import { BulkImportModal } from "./components/BulkImportModal.jsx";
import { IsbnAddModal } from "./components/IsbnAddModal.jsx";
import { LibraryFilterPanel } from "./components/LibraryFilterPanel.jsx";
import { LibrarySettings } from "./components/LibrarySettings.jsx";
import { LibraryShelf } from "./components/LibraryShelf.jsx";
import { LibrarySidebar } from "./components/LibrarySidebar.jsx";
import { NewReleaseView } from "./components/NewReleaseView.jsx";
import { SeriesDetailView } from "./components/SeriesDetailView.jsx";
import { useLibraryFilters } from "./hooks/use-library-filters.js";
import {
  buildSeriesGroups,
  buildShelfEntries,
  buildShelfSections,
  CATEGORY_OPTIONS as categoryOptions,
  filterAndSortBooks,
  localDateString,
  PLATFORM_OPTIONS as platformOptions,
} from "./library-model.js";
import { loadLibraryPreferences, saveLibraryPreferences } from "./library-preferences.js";
import { sampleBooks } from "./sampleBooks.js";

/** PC本棚の画面状態とAPI操作を束ねる最上位コンポーネント。表示計算はlibrary-modelへ委譲する。 */
/** @returns {import("react").ReactElement} PC向け蔵書管理画面。 */
export function DesktopLibrary() {
  const [books, setBooks] = useState(sampleBooks);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState("library");
  const { filters, updateFilters, resetFilters, hasActiveFilters } = useLibraryFilters();
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
  const [pack, setPack] = useState(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState("");

  async function refreshLibrary() {
    try {
      const [bookData, uploadData] = await Promise.all([
        requestJson("/api/books"),
        requestJson("/api/uploads?limit=1"),
      ]);
      setBooks(bookData.books);
      setLatestUpload(uploadData.uploads[0] || null);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
    }
  }

  const dismissUpload = useCallback(async (uploadId) => {
    if (!uploadId) return;
    setLatestUpload((current) => current?.id === uploadId ? null : current);
    try {
      await requestJson(`/api/uploads/${uploadId}/dismiss`, { method: "POST" });
    } catch {
      // The next refresh will restore the notice if the server could not save the dismissal.
    }
  }, []);

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
  }, [dismissUpload, latestUpload?.id, latestUpload?.status]);
  useEffect(() => {
    if (!books.some((book) => String(book.id) === String(selectedId)) && books[0]) setSelectedId(books[0].id);
  }, [books, selectedId]);
  useEffect(() => {
    // パックはサーバー側で用意されるため、準備中は進捗を取り直して完成を待つ。
    if (pack?.status !== "preparing") return undefined;
    const timer = window.setTimeout(() => { void loadPack(); }, 2500);
    return () => window.clearTimeout(timer);
  }, [pack]);

  const today = localDateString();
  const selectedBook = books.find((book) => String(book.id) === String(selectedId)) ?? books[0];
  const dueReminders = books.filter((book) => book.reminderDate && book.reminderDate <= today);
  const physicalCount = books.filter((book) => book.format !== "electronic").length;
  const electronicCount = books.filter((book) => book.format === "electronic").length;

  const categoryCounts = useMemo(
    () => Object.fromEntries(categoryOptions.map((category) => [category, books.filter((book) => book.category === category).length])),
    [books],
  );
  const platformCounts = useMemo(
    () => Object.fromEntries(platformOptions.map((platform) => [
      platform,
      books.filter((book) => book.format === "electronic" && book.electronicPlatform === platform).length,
    ])),
    [books],
  );
  const filterOptions = useMemo(() => ({
    authors: [...new Set(books.map((book) => book.author).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja")),
    publishers: [...new Set(books.map((book) => book.publisher).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja")),
  }), [books]);

  const seriesGroups = useMemo(() => buildSeriesGroups(books), [books]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const seriesUpdates = seriesGroups
    .filter((group) => group.nextVolumeNumber)
    .filter((group) => !normalizedQuery
      || `${group.seriesName} ${group.nextVolumeTitle} ${group.nextVolumeIsbn}`.toLocaleLowerCase("ja").includes(normalizedQuery));

  const visibleBooks = useMemo(
    () => filterAndSortBooks(books, { ...filters, query, sortMode, viewMode }),
    [books, filters, query, sortMode, viewMode],
  );

  const shelfEntries = useMemo(() => buildShelfEntries(visibleBooks, {
    groupSeries: preferences.groupSeries && sortMode !== "manual",
  }), [preferences.groupSeries, sortMode, visibleBooks]);
  const shelfSections = useMemo(
    () => buildShelfSections(shelfEntries, sortMode, preferences.showSectionHeaders),
    [preferences.showSectionHeaders, shelfEntries, sortMode],
  );
  const allSeriesEntries = useMemo(
    () => buildShelfEntries(books).filter((entry) => entry.kind === "series"),
    [books],
  );
  const activeSeries = allSeriesEntries.find((entry) => entry.seriesKey === activeSeriesKey);

  const queueState = latestUpload?.status || "ready";
  const uploadCopy = !serverOnline
    ? "サーバーに接続できません"
    : latestUpload?.status === "processing"
      ? "画像を解析中..."
      : latestUpload?.status === "needs_isbn"
        ? "ISBNの入力が必要です"
        : "iPhoneから画像を追加";
  const displaysBookDetail = viewMode === "library" || viewMode === "reminders" || viewMode === "series";
  const showsLibraryControls = viewMode === "library" || viewMode === "reminders";
  const consoleTitle = viewMode === "new-releases"
    ? "新刊リスト"
    : viewMode === "reminders"
      ? "リマインダー"
      : viewMode === "recommendations"
        ? "本のパック"
        : viewMode === "series"
          ? activeSeries?.title || "シリーズ"
          : "本を検索";

  function resetLibraryFilters() {
    setViewMode("library");
    resetFilters();
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
    if (!pack) void loadPack();
  }

  function showReminders() {
    setViewMode("reminders");
    updateFilters({ ownershipFilter: "all", categoryFilter: "all", platformFilter: "all" });
  }

  function chooseOwnership(format) {
    setViewMode("library");
    updateFilters({ ownershipFilter: format });
  }

  function choosePlatform(platform) {
    setViewMode("library");
    updateFilters({ ownershipFilter: "electronic", platformFilter: platform });
  }

  function chooseCategory(category) {
    setViewMode("library");
    updateFilters({ categoryFilter: category });
  }

  function openUploadPage() {
    window.open(config?.authorizedUploadUrl || config?.uploadUrl || "/upload", "_blank", "noopener,noreferrer");
  }

  function openCheckPage() {
    window.open(config?.checkUrl || "/check", "_blank", "noopener,noreferrer");
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
      const result = await requestJson("/api/isbn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isbn: isbnInput }),
      });
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

  async function patchSelectedBook(changes) {
    if (!selectedBook) return;
    try {
      const result = await requestJson(`/api/books/${selectedBook.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      setBooks((current) => current.map((book) => String(book.id) === String(result.book.id) ? result.book : book));
    } catch (error) {
      setActionMessage(error.message);
    }
  }

  function toggleReadStatus() {
    if (!selectedBook) return;
    return patchSelectedBook({ status: selectedBook.status === "読了" ? "未読" : "読了" });
  }

  function updateRating(rating) {
    if (!selectedBook) return;
    const nextRating = Number(selectedBook.rating || 0) === rating ? 0 : rating;
    return patchSelectedBook({ rating: nextRating });
  }

  async function finishBulkImport(result) {
    await refreshLibrary();
    const failureCopy = result.failedCount ? `、${result.failedCount}件失敗` : "";
    setActionMessage(`${result.processedCount}件を一括処理しました${failureCopy}。`);
    const lastBook = result.books?.at(-1);
    if (lastBook) setSelectedId(lastBook.id);
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

  async function loadPack() {
    setPackError("");
    try {
      setPack(await requestJson("/api/recommendations/pack"));
    } catch (error) {
      setPackError(error.message);
    }
  }

  async function openPack() {
    setPackBusy(true);
    setPackError("");
    try {
      setPack(await requestJson("/api/recommendations/pack/open", { method: "POST" }));
    } catch (error) {
      setPackError(error.message);
    } finally {
      setPackBusy(false);
    }
  }

  async function addPackCard(card) {
    setPackBusy(true);
    setPackError("");
    try {
      const result = await requestJson("/api/isbn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isbn: card.isbn }),
      });
      await refreshLibrary();
      setSelectedId(result.book.id);
      setViewMode("library");
      setDetailOpen(true);
    } catch (error) {
      setPackError(error.message);
    } finally {
      setPackBusy(false);
    }
  }

  async function checkSeries() {
    if (!selectedBook?.seriesName) { openEdit(selectedBook); return; }
    setActionBusy(true);
    setActionMessage("シリーズを確認しています...");
    try {
      const result = await requestJson("/api/series/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seriesName: selectedBook.seriesName }),
      });
      setActionMessage(result.message);
      await refreshLibrary();
    } catch (error) {
      setActionMessage(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function checkAllSeries() {
    setActionBusy(true);
    setActionMessage("登録シリーズの刊行情報を確認しています...");
    try {
      const result = await requestJson("/api/series/check-all", { method: "POST" });
      const failures = result.results.filter((item) => item.error).length;
      setActionMessage(`${result.checked}シリーズを更新しました${failures ? `（${failures}件は取得できませんでした）` : ""}。`);
      await refreshLibrary();
    } catch (error) {
      setActionMessage(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function addRelease(update) {
    setActionBusy(true);
    setActionMessage(`${update.seriesName} ${update.nextVolumeNumber}巻を追加しています...`);
    try {
      // ISBNで書誌を作成し、代表巻の所有形態を引き継いでからシリーズ情報を再計算する。
      const added = await requestJson("/api/isbn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isbn: update.nextVolumeIsbn }),
      });
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
      await requestJson("/api/series/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seriesName: update.seriesName }),
      });
      setSelectedId(added.book.id);
      setActionMessage(`${update.seriesName} ${update.nextVolumeNumber}巻を本棚に追加しました。`);
      await refreshLibrary();
    } catch (error) {
      setActionMessage(error.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selectedBook || !window.confirm(`「${selectedBook.title}」を本棚から削除しますか？`)) return;
    try {
      await requestJson(`/api/books/${selectedBook.id}`, { method: "DELETE" });
      await refreshLibrary();
    } catch (error) {
      setActionMessage(error.message);
    }
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
      const result = await requestJson("/api/books/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ordered.map((book) => book.id) }),
      });
      setBooks(result.books);
    } catch (error) {
      setActionMessage(error.message);
      await refreshLibrary();
    }
  }

  return (
    <main className={`app-shell ${viewMode === "new-releases" || viewMode === "recommendations" ? "wide-workspace" : ""}`}>
      <LibrarySidebar
        bookCount={books.length}
        categoryCounts={categoryCounts}
        config={config}
        dueReminderCount={dueReminders.length}
        electronicCount={electronicCount}
        filters={filters}
        hasFilters={hasActiveFilters}
        onChooseCategory={chooseCategory}
        onChooseOwnership={chooseOwnership}
        onChoosePlatform={choosePlatform}
        onOpenBulkImport={setBulkImportFormat}
        onOpenCheckPage={openCheckPage}
        onOpenRecommendations={openRecommendations}
        onOpenUploadPage={openUploadPage}
        onResetFilters={resetLibraryFilters}
        onShowNewReleases={() => { setViewMode("new-releases"); setActionMessage(""); }}
        onShowReminders={showReminders}
        physicalCount={physicalCount}
        platformCounts={platformCounts}
        seriesUpdateCount={seriesUpdates.length}
        serverOnline={serverOnline}
        viewMode={viewMode}
      />

      <section className={`workspace ${showsLibraryControls ? "" : "without-toolbar"}`}>
        <header className="search-console">
          <div className="console-title">
            {consoleTitle}
            <span className={`connection-status ${serverOnline ? "online" : "offline"}`}>
              <Wifi size={14} />{serverOnline ? "サーバー稼働中" : "オフライン"}
            </span>
          </div>
          <div className="top-row">
            <label className="search-field">
              <Search size={24} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={viewMode === "new-releases" ? "シリーズ名・ISBNで検索..." : "タイトル・著者・ISBN・シリーズ・場所で検索..."}
              />
              {query && <button className="clear" onClick={() => setQuery("")} aria-label="検索を消去">×</button>}
            </label>
            <button className="utility-button" onClick={() => openEdit(null)}><Plus size={19} />手動追加</button>
            <button className="primary-button" disabled={!serverOnline} onClick={openUploadPage}>
              <Upload size={21} /><span>アップロード<small>{uploadCopy}</small></span>
            </button>
            <button className="isbn-button" disabled={!serverOnline} onClick={() => setShowIsbnModal(true)}>
              <Barcode size={21} /><span>ISBNを入力<small>書誌情報から追加</small></span>
            </button>
          </div>
          {showsLibraryControls && (
            <div className="filter-row" aria-label="filters">
              <label className="filter-select">
                <span>所有形態</span>
                <select onChange={(event) => updateFilters({ ownershipFilter: event.target.value })} value={filters.ownershipFilter}>
                  <option value="all">すべて</option>
                  <option value="physical">実本</option>
                  <option value="electronic">電子書籍</option>
                </select>
                <ChevronDown size={14} />
              </label>
              {filters.ownershipFilter === "electronic" && (
                <label className="filter-select">
                  <span>電子媒体</span>
                  <select onChange={(event) => updateFilters({ platformFilter: event.target.value })} value={filters.platformFilter}>
                    <option value="all">すべて</option>
                    {platformOptions.map((platform) => <option key={platform}>{platform}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </label>
              )}
              <label className="filter-select">
                <span>カテゴリ</span>
                <select onChange={(event) => updateFilters({ categoryFilter: event.target.value })} value={filters.categoryFilter}>
                  <option value="all">すべて</option>
                  {categoryOptions.map((category) => <option key={category}>{category}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
              {["未読", "読了"].map((label) => (
                <button
                  className={filters.status === label ? "selected" : ""}
                  key={label}
                  onClick={() => updateFilters({ status: filters.status === label ? "すべて" : label })}
                >
                  {label === "読了" ? <Check size={15} /> : <Circle size={15} />}{label}
                </button>
              ))}
              <button className={advancedFiltersOpen ? "selected" : ""} onClick={() => setAdvancedFiltersOpen((open) => !open)} type="button">
                <SlidersHorizontal size={15} />詳細
              </button>
              {hasActiveFilters && <button className="filter-clear" onClick={resetLibraryFilters}><X size={15} />解除</button>}
            </div>
          )}
          {showsLibraryControls && (
            <LibraryFilterPanel
              filters={filters}
              onChange={updateFilters}
              open={advancedFiltersOpen}
              options={filterOptions}
            />
          )}
          {(dueReminders.length > 0 || seriesUpdates.length > 0) && (
            <button className="reminder-strip" onClick={() => setViewMode(seriesUpdates.length > 0 ? "new-releases" : "reminders")}>
              <Bell size={16} />
              <span>
                {dueReminders.length > 0 ? `期限到来 ${dueReminders.length}件` : ""}
                {dueReminders.length > 0 && seriesUpdates.length > 0 ? "・" : ""}
                {seriesUpdates.length > 0 ? `新刊候補 ${seriesUpdates.length}シリーズ` : ""}
              </span>
              <MoveRight size={15} />
            </button>
          )}
        </header>

        {showsLibraryControls && (
          <section className="shelf-toolbar">
            <label className="sort-control">
              <select aria-label="並び替え" onChange={(event) => setSortMode(event.target.value)} value={sortMode}>
                <option value="newest">新着順</option>
                <option value="title">名前順</option>
                <option value="author">作者順</option>
                <option value="publisher">出版社順</option>
                <option value="series">シリーズ・巻数順</option>
                <option value="location">保管場所・媒体順</option>
                <option value="manual">手動（ドラッグ）</option>
              </select>
              <ChevronDown size={15} />
            </label>
            <span>{visibleBooks.length}冊 / {shelfEntries.length}項目</span>
            <div className="shelf-toolbar-actions">
              <button disabled={!serverOnline} onClick={() => setBulkImportFormat("physical")} title="実本をまとめて取り込む" type="button">
                <Archive size={16} /><span>実本を一括</span>
              </button>
              <button disabled={!serverOnline} onClick={() => setBulkImportFormat("electronic")} title="電子書籍のスクリーンショットをまとめて取り込む" type="button">
                <Images size={16} /><span>電子書籍を一括</span>
              </button>
              <button
                className={preferences.showSectionHeaders ? "active" : ""}
                onClick={() => updatePreferences({ showSectionHeaders: !preferences.showSectionHeaders })}
                title={preferences.showSectionHeaders ? "仕切りを非表示" : "仕切りを表示"}
                type="button"
              >
                {preferences.showSectionHeaders ? <Eye size={16} /> : <EyeOff size={16} />}<span>仕切り</span>
              </button>
              <LibrarySettings
                onChange={updatePreferences}
                onClose={() => setSettingsOpen(false)}
                onToggle={() => setSettingsOpen((open) => !open)}
                open={settingsOpen}
                preferences={preferences}
              />
            </div>
          </section>
        )}

        {viewMode === "new-releases" ? (
          <NewReleaseView busy={actionBusy} message={actionMessage} onAdd={addRelease} onRefresh={checkAllSeries} updates={seriesUpdates} />
        ) : viewMode === "recommendations" ? (
          <BookPackView
            busy={packBusy}
            error={packError}
            onAdd={addPackCard}
            onOpen={openPack}
            pack={pack}
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
            onDismissUpload={() => dismissUpload(latestUpload?.id)}
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

      {displaysBookDetail && selectedBook && (
        <BookDetailPane
          actionBusy={actionBusy}
          actionMessage={actionMessage}
          book={selectedBook}
          onCheckSeries={checkSeries}
          onClose={() => setDetailOpen(false)}
          onDelete={deleteSelected}
          onEdit={openEdit}
          onOpenNewReleases={() => setViewMode("new-releases")}
          onRefreshCover={refreshSelectedCover}
          onToggleRead={toggleReadStatus}
          onUpdateRating={updateRating}
          open={detailOpen}
          today={today}
        />
      )}

      {showIsbnModal && (
        <IsbnAddModal
          busy={actionBusy}
          isbn={isbnInput}
          message={actionMessage}
          onChange={setIsbnInput}
          onClose={() => setShowIsbnModal(false)}
          onSubmit={submitManualIsbn}
        />
      )}
      {bulkImportFormat && (
        <BulkImportModal initialFormat={bulkImportFormat} onClose={() => setBulkImportFormat(null)} onImported={finishBulkImport} />
      )}
      {showEditModal && (
        <BookEditModal
          book={editingBook}
          onClose={() => setShowEditModal(false)}
          onSaved={async (book) => { setShowEditModal(false); await refreshLibrary(); setSelectedId(book.id); }}
        />
      )}
    </main>
  );
}
