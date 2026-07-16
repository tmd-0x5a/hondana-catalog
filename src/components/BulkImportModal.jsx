import { Archive, FileUp, Images, List, RefreshCw, ScanText, Smartphone, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import { requestJson } from "../api.js";
import { parseBulkImportText } from "../bulk-import-model.js";
import { showFallbackCover } from "../cover-image.js";
import { PLATFORM_OPTIONS } from "../library-model.js";

function initialSourceMode(format) {
  return format === "electronic" ? "screenshots" : "list";
}

/**
 * スクリーンショットOCRまたは書誌一覧から、同じ所有先へ複数冊を登録する。
 *
 * @param {object} props 表示制御と完了通知。
 * @param {"physical"|"electronic"} [props.initialFormat="physical"] 入口で選択された所有形態。
 * @param {() => void} props.onClose モーダルを閉じる処理。
 * @param {(result: object) => void|Promise<void>} props.onImported 一括登録後の蔵書再読込処理。
 * @returns {import("react").ReactElement} 一括取り込みフォーム。
 */
export function BulkImportModal({ initialFormat = "physical", onClose, onImported }) {
  const [format, setFormat] = useState(initialFormat);
  const [sourceMode, setSourceMode] = useState(() => initialSourceMode(initialFormat));
  const [physicalLocation, setPhysicalLocation] = useState("本棚");
  const [electronicPlatform, setElectronicPlatform] = useState("Amazon Kindle");
  const [rawText, setRawText] = useState("");
  const [scanRows, setScanRows] = useState([]);
  const [unmatchedLines, setUnmatchedLines] = useState([]);
  const [selectedFileCount, setSelectedFileCount] = useState(0);
  const [scanBusy, setScanBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const parsed = useMemo(() => parseBulkImportText(rawText), [rawText]);
  const selectedEntries = useMemo(() => {
    const seenIsbns = new Set();
    return scanRows.flatMap((row) => {
      const suggestion = row.suggestions[row.suggestionIndex];
      if (!row.selected || !suggestion?.isbn || seenIsbns.has(suggestion.isbn)) return [];
      seenIsbns.add(suggestion.isbn);
      return [{
        isbn: suggestion.isbn,
        title: suggestion.title,
        author: suggestion.author,
        publisher: suggestion.publisher,
      }];
    });
  }, [scanRows]);
  const entries = sourceMode === "screenshots" ? selectedEntries : parsed.entries;
  const title = format === "electronic" ? "電子書籍を一括取り込み" : "実本を一括取り込み";

  function chooseFormat(nextFormat) {
    setFormat(nextFormat);
    setSourceMode(initialSourceMode(nextFormat));
    setError("");
    setResult(null);
  }

  async function loadTextFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setRawText(await file.text());
    } catch {
      setError("ファイルを読み取れませんでした。");
    } finally {
      event.target.value = "";
    }
  }

  async function scanScreenshots(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setError("");
    setResult(null);
    setScanRows([]);
    setUnmatchedLines([]);
    setSelectedFileCount(files.length);
    setScanBusy(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("screenshots", file));
      const response = await requestJson("/api/books/bulk/scan", { method: "POST", body: formData });
      const defaultIsbns = new Set();
      setScanRows(response.candidates.map((row, index) => {
        const firstIsbn = row.suggestions[0]?.isbn;
        const selected = Boolean(firstIsbn) && !defaultIsbns.has(firstIsbn);
        if (selected) defaultIsbns.add(firstIsbn);
        return { ...row, id: `${index}-${row.sourceText}`, selected, suggestionIndex: 0 };
      }));
      setUnmatchedLines(response.unmatchedLines || []);
      if (response.warning) setError(response.warning);
      if (!response.candidates.length) {
        setError(response.warning || "書籍候補が見つかりませんでした。表示を大きくしたスクリーンショットを試してください。");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setScanBusy(false);
    }
  }

  function updateScanRow(id, changes) {
    setScanRows((rows) => rows.map((row) => row.id === id ? { ...row, ...changes } : row));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!entries.length || (sourceMode === "list" && parsed.errors.length)) return;
    setBusy(true);
    try {
      const response = await requestJson("/api/books/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, physicalLocation, electronicPlatform, entries }),
      });
      setResult(response);
      await onImported(response);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="edit-modal bulk-import-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <header><div>{format === "electronic" ? <Smartphone size={22} /> : <Archive size={22} />}<strong>{title}</strong></div><button aria-label="閉じる" onClick={onClose} type="button"><X size={20} /></button></header>

        <fieldset className="segmented-field bulk-format"><legend>所有形態</legend><div className="segmented-control"><button className={format === "physical" ? "selected" : ""} onClick={() => chooseFormat("physical")} type="button"><Archive size={17} />実本</button><button className={format === "electronic" ? "selected" : ""} onClick={() => chooseFormat("electronic")} type="button"><Smartphone size={17} />電子書籍</button></div></fieldset>
        <div className="bulk-target">
          {format === "physical" ? <label><span>保管場所</span><input maxLength={300} onChange={(event) => setPhysicalLocation(event.target.value)} value={physicalLocation} /></label> : <label><span>電子書籍ストア</span><select onChange={(event) => setElectronicPlatform(event.target.value)} value={electronicPlatform}>{PLATFORM_OPTIONS.map((platform) => <option key={platform}>{platform}</option>)}</select></label>}
        </div>

        <fieldset className="segmented-field bulk-source"><legend>取り込み方法</legend><div className="segmented-control"><button className={sourceMode === "screenshots" ? "selected" : ""} onClick={() => setSourceMode("screenshots")} type="button"><Images size={17} />スクリーンショット</button><button className={sourceMode === "list" ? "selected" : ""} onClick={() => setSourceMode("list")} type="button"><List size={17} />一覧を貼る</button></div></fieldset>

        {sourceMode === "screenshots" ? (
          <>
            <label className={`screenshot-picker ${scanBusy ? "busy" : ""}`}>
              {scanBusy ? <RefreshCw className="spin" size={28} /> : <ScanText size={28} />}
              <strong>{scanBusy ? "文字と書誌を照合中" : "スクリーンショットを選択"}</strong>
              <span>{selectedFileCount ? `${selectedFileCount}枚を選択済み` : "複数枚選択・最大12枚"}</span>
              <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={scanBusy} multiple onChange={scanScreenshots} type="file" />
            </label>

            {scanRows.length > 0 && <section className="scan-candidates">
              <header><strong>書籍候補</strong><span>{selectedEntries.length}冊を登録</span></header>
              <div className="scan-candidate-list">
                {scanRows.map((row) => {
                  const suggestion = row.suggestions[row.suggestionIndex];
                  return <div className={`scan-candidate ${row.selected ? "selected" : ""}`} key={row.id}>
                    <label className="scan-check"><input checked={row.selected} onChange={(event) => updateScanRow(row.id, { selected: event.target.checked })} type="checkbox" /><span /></label>
                    <img alt="" onError={showFallbackCover} src={suggestion.coverUrl || "/assets/selected-cover.png"} />
                    <div className="scan-book-copy"><strong>{suggestion.title}</strong><span>{[suggestion.author, suggestion.published].filter(Boolean).join(" / ") || "著者情報を取得中"}</span><small>画像内: {row.sourceText}</small></div>
                    {row.suggestions.length > 1 && <label className="scan-alternative"><span>候補</span><select aria-label={`${row.sourceText}の候補`} onChange={(event) => updateScanRow(row.id, { suggestionIndex: Number(event.target.value) })} value={row.suggestionIndex}>{row.suggestions.map((item, index) => <option key={`${item.isbn}-${index}`} value={index}>{item.title}{item.published ? ` (${item.published})` : ""}</option>)}</select></label>}
                  </div>;
                })}
              </div>
            </section>}
            {unmatchedLines.length > 0 && <details className="unmatched-lines"><summary>候補なし {unmatchedLines.length}件</summary><p>{unmatchedLines.join(" / ")}</p></details>}
          </>
        ) : (
          <>
            <label className="bulk-data-field"><span>ISBN / タイトル・著者</span><textarea autoFocus onChange={(event) => setRawText(event.target.value)} placeholder={"9784088820118\n葬送のフリーレン 1\t山田鐘人\n9784088820125\t書名\t著者名"} spellCheck="false" value={rawText} /></label>
            <div className="bulk-data-meta"><label className="file-picker"><FileUp size={16} /><span>TSV・TXTを選択</span><input accept=".tsv,.txt,text/tab-separated-values,text/plain" onChange={loadTextFile} type="file" /></label><span className={parsed.errors.length ? "invalid" : ""}>{parsed.entries.length} / 200件</span></div>
            {parsed.errors.map((message) => <div className="bulk-error" key={message}>{message}</div>)}
          </>
        )}

        {error && <div className="bulk-error">{error}</div>}
        {result && <section className="bulk-result" role="status"><strong>{result.processedCount}件を処理しました。</strong><span>新規 {result.createdCount}件・更新 {result.duplicateCount}件・失敗 {result.failedCount}件</span>{result.failures?.map((failure) => <small key={`${failure.row}-${failure.message}`}>{failure.row}行目: {failure.message}</small>)}</section>}
        <footer><button onClick={onClose} type="button">閉じる</button><button className="modal-submit" disabled={busy || scanBusy || !entries.length || (sourceMode === "list" && parsed.errors.length > 0)} type="submit">{busy ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}{entries.length ? `${entries.length}冊を取り込む` : "取り込む本を選択"}</button></footer>
      </form>
    </div>
  );
}
