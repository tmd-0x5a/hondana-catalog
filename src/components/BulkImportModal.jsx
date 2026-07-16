import { Archive, FileUp, RefreshCw, Smartphone, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import { requestJson } from "../api.js";
import { parseBulkImportText } from "../bulk-import-model.js";
import { PLATFORM_OPTIONS } from "../library-model.js";

/**
 * 実本・電子書籍の共通保存先と複数書誌をまとめて登録するモーダル。
 *
 * @param {object} props 表示制御と完了通知。
 * @param {() => void} props.onClose モーダルを閉じる処理。
 * @param {(result: object) => void|Promise<void>} props.onImported API処理後の蔵書再読込処理。
 * @returns {import("react").ReactElement} 一括取り込みフォーム。
 */
export function BulkImportModal({ onClose, onImported }) {
  const [format, setFormat] = useState("physical");
  const [physicalLocation, setPhysicalLocation] = useState("本棚");
  const [electronicPlatform, setElectronicPlatform] = useState("Amazon Kindle");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const parsed = useMemo(() => parseBulkImportText(rawText), [rawText]);

  async function loadFile(event) {
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

  async function submit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!parsed.entries.length || parsed.errors.length) return;
    setBusy(true);
    try {
      const response = await requestJson("/api/books/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, physicalLocation, electronicPlatform, entries: parsed.entries }),
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
        <header><div><Upload size={22} /><strong>一括取り込み</strong></div><button aria-label="閉じる" onClick={onClose} type="button"><X size={20} /></button></header>
        <fieldset className="segmented-field bulk-format"><legend>所有形態</legend><div className="segmented-control"><button className={format === "physical" ? "selected" : ""} onClick={() => setFormat("physical")} type="button"><Archive size={17} />実本</button><button className={format === "electronic" ? "selected" : ""} onClick={() => setFormat("electronic")} type="button"><Smartphone size={17} />電子書籍</button></div></fieldset>

        <div className="bulk-target">
          {format === "physical" ? <label><span>保管場所</span><input maxLength={300} onChange={(event) => setPhysicalLocation(event.target.value)} value={physicalLocation} /></label> : <label><span>電子書籍媒体</span><select onChange={(event) => setElectronicPlatform(event.target.value)} value={electronicPlatform}>{PLATFORM_OPTIONS.map((platform) => <option key={platform}>{platform}</option>)}</select></label>}
        </div>

        <label className="bulk-data-field"><span>ISBN / タイトル・著者</span><textarea autoFocus onChange={(event) => setRawText(event.target.value)} placeholder={"9784088820118\n葬送のフリーレン 1\t山田鐘人\n9784088820125\t書名\t著者名"} spellCheck="false" value={rawText} /></label>
        <div className="bulk-data-meta">
          <label className="file-picker"><FileUp size={16} /><span>TSV・TXTを選択</span><input accept=".tsv,.txt,text/tab-separated-values,text/plain" onChange={loadFile} type="file" /></label>
          <span className={parsed.errors.length ? "invalid" : ""}>{parsed.entries.length} / 200件</span>
        </div>
        {parsed.errors.map((message) => <div className="bulk-error" key={message}>{message}</div>)}
        {error && <div className="bulk-error">{error}</div>}
        {result && <section className="bulk-result" role="status"><strong>{result.processedCount}件を処理しました。</strong><span>新規 {result.createdCount}件・更新 {result.duplicateCount}件・失敗 {result.failedCount}件</span>{result.failures?.map((failure) => <small key={`${failure.row}-${failure.message}`}>{failure.row}行目: {failure.message}</small>)}</section>}

        <footer><button onClick={onClose} type="button">閉じる</button><button className="modal-submit" disabled={busy || !parsed.entries.length || parsed.errors.length > 0} type="submit">{busy ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}取り込む</button></footer>
      </form>
    </div>
  );
}
