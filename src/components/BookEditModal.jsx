import { useEffect, useState } from "react";
import { Archive, Edit3, ExternalLink, RefreshCw, Save, Smartphone, X } from "lucide-react";

import { requestJson } from "../api.js";
import { showFallbackCover } from "../cover-image.js";
import {
  CATEGORY_OPTIONS as categoryOptions,
  platformHomeUrl,
  PLATFORM_OPTIONS as platformOptions,
} from "../library-model.js";

/**
 * 新規登録と編集を共用し、ISBN候補がある場合は書誌取得後に所蔵情報を確定する。
 *
 * @param {object} props モーダル制御。
 * @param {import("../types.js").Book|null} props.book 編集対象。nullなら新規登録。
 * @param {() => void} props.onClose 閉じる操作。
 * @param {(book: import("../types.js").Book) => void} props.onSaved 保存完了通知。
 * @returns {import("react").ReactElement} 蔵書編集モーダル。
 */
export function BookEditModal({ book, onClose, onSaved }) {
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
        const result = await requestJson(
          `/api/books/suggest?q=${encodeURIComponent(form.title.trim())}`,
          { signal: controller.signal },
        );
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
          author: imported.book.author && imported.book.author !== "著者情報なし"
            ? imported.book.author
            : updatePayload.author,
          authorReading: updatePayload.authorReading || imported.book.authorReading,
          publisher: imported.book.publisher || updatePayload.publisher,
          published: imported.book.published || updatePayload.published,
          category: imported.book.category && imported.book.category !== "その他"
            ? imported.book.category
            : updatePayload.category,
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
            <label>
              <span>タイトル</span>
              <input
                autoComplete="off"
                autoFocus
                onChange={(event) => { setSelectedSuggestion(null); update("title", event.target.value); }}
                placeholder="2文字以上で書籍候補を検索"
                value={form.title}
              />
            </label>
            {suggestBusy && <RefreshCw className="suggest-spinner spin" size={16} />}
            {selectedSuggestion?.coverUrl && (
              <div className="selected-suggestion">
                <img src={selectedSuggestion.coverUrl} alt="候補の表紙" onError={showFallbackCover} />
                <span><strong>表紙を取得します</strong><small>ISBN {selectedSuggestion.isbn}</small></span>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="book-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion.isbn} onClick={() => chooseSuggestion(suggestion)} type="button">
                    <img src={suggestion.coverUrl || "/assets/selected-cover.png"} alt="" onError={showFallbackCover} />
                    <span>
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.author || "著者情報なし"}{suggestion.published ? `・${suggestion.published}` : ""}</small>
                      <code>{suggestion.isbn}</code>
                    </span>
                  </button>
                ))}
                <a href="https://ndlsearch.ndl.go.jp/" rel="noreferrer" target="_blank">
                  書誌候補: NDLサーチAPI <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
          <label><span>著者</span><input onChange={(event) => update("author", event.target.value)} value={form.author} /></label>
          <label><span>ISBN</span><input disabled={!isNew} onChange={(event) => update("isbn", event.target.value)} value={form.isbn} /></label>
          <label><span>タイトルよみ</span><input onChange={(event) => update("titleReading", event.target.value)} placeholder="そうそうのふりーれん" value={form.titleReading} /></label>
          <label><span>著者よみ</span><input onChange={(event) => update("authorReading", event.target.value)} placeholder="やまだ たろう" value={form.authorReading} /></label>
          <label><span>出版社</span><input onChange={(event) => update("publisher", event.target.value)} value={form.publisher} /></label>
          <label><span>出版日</span><input onChange={(event) => update("published", event.target.value)} value={form.published} /></label>

          <label className="wide-field">
            <span>カテゴリ</span>
            <select onChange={(event) => update("category", event.target.value)} value={form.category}>
              {categoryOptions.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>

          <fieldset className="wide-field segmented-field">
            <legend>所有形態</legend>
            <div className="segmented-control">
              <button className={form.format === "physical" ? "selected" : ""} onClick={() => update("format", "physical")} type="button"><Archive size={17} />実本</button>
              <button className={form.format === "electronic" ? "selected" : ""} onClick={() => update("format", "electronic")} type="button"><Smartphone size={17} />電子書籍</button>
            </div>
          </fieldset>

          {form.format === "physical" ? (
            <label className="wide-field">
              <span>保管場所</span>
              <input onChange={(event) => update("physicalLocation", event.target.value)} placeholder="書斎・本棚A・上段" value={form.physicalLocation} />
            </label>
          ) : (
            <>
              <label className="wide-field">
                <span>電子書籍ストア・媒体</span>
                <select onChange={(event) => update("electronicPlatform", event.target.value)} value={form.electronicPlatform}>
                  {platformOptions.map((platform) => <option key={platform}>{platform}</option>)}
                </select>
              </label>
              <label className="wide-field">
                <span>作品ページ・本棚リンク</span>
                <input
                  onChange={(event) => update("electronicUrl", event.target.value)}
                  placeholder={platformHomeUrl(form.electronicPlatform) || "https://..."}
                  type="url"
                  value={form.electronicUrl}
                />
              </label>
            </>
          )}

          <label><span>分類・棚</span><input onChange={(event) => update("shelf", event.target.value)} value={form.shelf} /></label>
          <label>
            <span>読書状態</span>
            <select onChange={(event) => update("status", event.target.value)} value={form.status}>
              <option>未読</option><option>読了</option>
            </select>
          </label>
          <label className="wide-field">
            <span>評価</span>
            <select onChange={(event) => update("rating", Number(event.target.value))} value={form.rating}>
              <option value="0">未評価</option>
              <option value="1">★ 1</option>
              <option value="2">★★ 2</option>
              <option value="3">★★★ 3</option>
              <option value="4">★★★★ 4</option>
              <option value="5">★★★★★ 5</option>
            </select>
          </label>

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
          <button className="modal-submit" disabled={busy} type="submit">
            {busy ? <RefreshCw className="spin" size={17} /> : <Save size={17} />}
            {isNew ? "登録" : "保存"}
          </button>
        </footer>
      </form>
    </div>
  );
}
