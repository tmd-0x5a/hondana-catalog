import { ExternalLink, Plus, RefreshCw, Sparkles } from "lucide-react";

import { showFallbackCover } from "../cover-image.js";

/**
 * 読了・評価から取得した未所持候補を表示する。
 *
 * @param {object} props 推薦結果と更新・追加操作。
 * @param {object[]} props.recommendations 未所持候補。
 * @param {(book: object) => void} props.onAdd ISBN追加操作。
 * @returns {import("react").ReactElement} おすすめ画面。
 */
export function RecommendationView({ busy, error, onAdd, onRefresh, recommendations, seedCount }) {
  return (
    <section className="recommendation-view">
      <header className="recommendation-header">
        <div><span><Sparkles size={16} />読書傾向から選出</span><h2>あなたへのおすすめ</h2><p>{seedCount ? `${seedCount}人の著者を手がかりに、所蔵済みを除外しました。` : "読了または評価した本が増えると候補を表示します。"}</p></div>
        <button disabled={busy} onClick={onRefresh} type="button">{busy ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}更新</button>
      </header>
      {error && <div className="recommendation-message">{error}</div>}
      {!busy && recommendations.length === 0 ? (
        <div className="recommendation-empty"><Sparkles size={34} /><strong>おすすめの準備中です</strong><span>本を読了にするか、星で評価してください。</span></div>
      ) : (
        <div className="recommendation-grid">
          {recommendations.map((book) => (
            <article className="recommendation-card" key={book.isbn}>
              <img alt={`${book.title}の表紙`} onError={showFallbackCover} src={book.coverUrl || "/assets/selected-cover.png"} />
              <div><small>{book.reason}</small><h3>{book.title}</h3><p>{book.author || "著者情報なし"}</p><span>{book.publisher}{book.published ? ` / ${book.published}` : ""}</span></div>
              <footer>{book.url && <a href={book.url} rel="noreferrer" target="_blank"><ExternalLink size={15} />NDL</a>}<button onClick={() => onAdd(book)} type="button"><Plus size={16} />追加</button></footer>
            </article>
          ))}
        </div>
      )}
      <small className="recommendation-credit">候補: NDLサーチAPI</small>
    </section>
  );
}
