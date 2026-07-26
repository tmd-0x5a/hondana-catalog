import { BookCopy, ExternalLink, Plus, RefreshCw } from "lucide-react";

import { showFallbackCover } from "../cover-image.js";

/**
 * シリーズ集約済みのデータだけを受け取り、新刊確認操作を表示へ結び付ける。
 *
 * @param {object} props 新刊リスト表示。
 * @param {object[]} props.updates シリーズ別の次巻候補。
 * @param {boolean} props.busy 通信中か。
 * @param {string} props.message 操作結果メッセージ。
 * @param {(update: object) => void} props.onAdd 次巻の登録操作。
 * @param {() => void} props.onRefresh 全シリーズ更新操作。
 * @returns {import("react").ReactElement} 新刊・未所持リスト。
 */
export function NewReleaseView({ updates, busy, message, onAdd, onRefresh }) {
  return (
    <section className="new-release-view" aria-label="新刊リスト">
      <header className="release-header">
        <div>
          <span>シリーズ追跡</span>
          <h2>新刊・未所持リスト</h2>
          <p>登録済みの巻より後に刊行された本を、シリーズ単位で表示します。</p>
        </div>
        <button disabled={busy} onClick={onRefresh}>
          {busy ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}すべて更新
        </button>
      </header>
      {message && <div className="release-message">{message}</div>}
      {updates.length === 0 ? (
        <div className="release-empty">
          <BookCopy size={34} />
          <strong>新刊候補はありません</strong>
          <span>マンガにシリーズ名と巻数を登録してから更新してください。</span>
        </div>
      ) : (
        <div className="release-list">
          {updates.map((update) => (
            <article className="release-row" key={update.key}>
              <img src={update.coverUrl || "/assets/selected-cover.png"} alt={`${update.seriesName}の表紙`} onError={showFallbackCover} />
              <div className="release-main">
                <span className="release-kind">マンガ ・ {update.ownershipLabel}</span>
                <h3>{update.seriesName}</h3>
                <p>{update.nextVolumeTitle || `${update.seriesName} ${update.nextVolumeNumber}巻`}</p>
                <div className="release-facts">
                  <span>所持 {update.ownedMax}巻まで</span>
                  <span>確認済み最新 {update.latestVolume}巻</span>
                  <span>ISBN {update.nextVolumeIsbn}</span>
                </div>
              </div>
              <div className="release-volume">
                <span>次に未所持</span>
                <strong>{update.nextVolumeNumber}<small>巻</small></strong>
                <time>{update.nextVolumePublished || "刊行日未取得"}</time>
              </div>
              <div className="release-actions">
                {update.nextVolumeUrl && (
                  <a href={update.nextVolumeUrl} rel="noreferrer" target="_blank"><ExternalLink size={15} />書誌情報</a>
                )}
                <button disabled={busy || !update.nextVolumeIsbn} onClick={() => onAdd(update)}><Plus size={16} />本棚に追加</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
