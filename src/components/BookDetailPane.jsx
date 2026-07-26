import {
  Bell,
  BookCopy,
  CalendarClock,
  Check,
  Circle,
  Edit3,
  ExternalLink,
  FolderOpen,
  MapPin,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { showFallbackCover } from "../cover-image.js";
import { electronicBookUrl, formatLabel, locationLabel } from "../library-model.js";

/**
 * 選択中の一冊の書誌・所蔵情報・操作をまとめた右側詳細パネル。
 *
 * @param {object} props 表示対象と操作。
 * @param {import("../types.js").Book} props.book 選択中の蔵書。
 * @param {string} props.today ローカル日付のYYYY-MM-DD。リマインダー期限判定に使う。
 * @param {boolean} props.open コンパクト画面でパネルを開いているか。
 * @param {boolean} props.actionBusy シリーズ確認・表紙再取得の通信中か。
 * @param {string} props.actionMessage 操作結果メッセージ。
 * @param {() => void} props.onClose パネルを閉じる。
 * @param {(book: import("../types.js").Book) => void} props.onEdit 編集モーダルを開く。
 * @param {() => void} props.onToggleRead 読了状態の切り替え。
 * @param {(rating: number) => void} props.onUpdateRating 評価の更新。
 * @param {() => void} props.onCheckSeries シリーズの新刊確認。
 * @param {() => void} props.onOpenNewReleases 新刊リストへ移動。
 * @param {() => void} props.onDelete 蔵書の削除。
 * @param {() => void} props.onRefreshCover 表紙の再取得。
 * @returns {import("react").ReactElement} 詳細パネル。
 */
export function BookDetailPane({
  book,
  today,
  open,
  actionBusy,
  actionMessage,
  onClose,
  onEdit,
  onToggleRead,
  onUpdateRating,
  onCheckSeries,
  onOpenNewReleases,
  onDelete,
  onRefreshCover,
}) {
  const storeUrl = book.format === "electronic" ? electronicBookUrl(book) : "";
  return (
    <>
      {open && <button aria-label="詳細を閉じる" className="detail-scrim" onClick={onClose} type="button" />}
      <aside className={`detail-pane enhanced-detail ${open ? "compact-open" : ""}`}>
        <button aria-label="詳細を閉じる" className="detail-close" onClick={onClose} title="閉じる" type="button">
          <X size={19} />
        </button>
        <div className="detail-cover">
          <img src={book.coverUrl || "/assets/selected-cover.png"} alt={`${book.title}の表紙`} onError={showFallbackCover} />
          <span>{book.title}</span>
          <small>{book.author}</small>
        </div>
        <div className="book-heading">
          <div className="book-badges">
            <span>{book.category || "その他"}</span>
            <span>{formatLabel(book)}</span>
            {book.format === "electronic" && <span>{book.electronicPlatform}</span>}
          </div>
          <h1>{book.title}</h1>
          <p>{book.author}</p>
          <div className="rating" aria-label={`評価 ${book.rating || 0}`}>
            <div>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  aria-label={`${star}点で評価`}
                  className={star <= (book.rating || 0) ? "filled" : ""}
                  key={star}
                  onClick={() => onUpdateRating(star)}
                  title={`${star}点`}
                  type="button"
                >
                  <Star size={20} />
                </button>
              ))}
            </div>
            <span>{book.rating || 0}.0</span>
          </div>
          <button className={`read-toggle ${book.status === "読了" ? "done" : ""}`} onClick={onToggleRead}>
            {book.status === "読了" ? <Check size={18} /> : <Circle size={18} />}
            {book.status}
          </button>
        </div>
        <div className="form-stack ownership-fields">
          <label>
            <span>{book.format === "electronic" ? "電子媒体" : "保管場所"}</span>
            <button onClick={() => onEdit(book)}>{locationLabel(book)}<MapPin size={16} /></button>
          </label>
          <label><span>分類・棚</span><input readOnly value={book.shelf || "未整理"} /></label>
          <label><span>ISBN</span><input readOnly value={book.isbn || "ISBNなし"} /></label>
          <label>
            <span>出版社・出版年</span>
            <input readOnly value={[book.publisher, book.published].filter(Boolean).join(" / ") || "未取得"} />
          </label>
          {storeUrl && (
            <label className="store-link-field">
              <span>リンク</span>
              <a href={storeUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={15} />
                {book.electronicUrl ? "作品ページ・本棚を開く" : `${book.electronicPlatform}公式サイトを開く`}
              </a>
            </label>
          )}
        </div>
        {(book.category === "マンガ" || book.seriesName) && (
          <section className="series-panel">
            <header>
              <div><BookCopy size={17} /><span>シリーズ</span></div>
              <button disabled={actionBusy} onClick={onCheckSeries}>
                <RefreshCw className={actionBusy ? "spin" : ""} size={15} />新刊確認
              </button>
            </header>
            <strong>{book.seriesName || "シリーズ名未設定"}</strong>
            <p>
              {book.volumeNumber ? `所持巻: ${book.volumeNumber}巻` : "巻数未設定"}
              {book.seriesLatestVolume ? ` / 確認済み最新: ${book.seriesLatestVolume}巻` : ""}
            </p>
            {book.nextVolumeNumber && (
              <button className="series-update" onClick={onOpenNewReleases}>
                <Bell size={16} />
                <span>{book.nextVolumeNumber}巻を登録できます</span>
                <small>{book.nextVolumePublished}</small>
              </button>
            )}
            {actionMessage && <small className="series-message">{actionMessage}</small>}
          </section>
        )}
        {book.reminderDate && (
          <section className={`reminder-panel ${book.reminderDate <= today ? "due" : ""}`}>
            <CalendarClock size={18} />
            <div><span>{book.reminderDate}</span><strong>{book.reminderNote || "リマインダー"}</strong></div>
          </section>
        )}
        <div className="tag-list">
          {(book.tags || []).map((tag) => <button key={tag}>{tag}</button>)}
          <button onClick={() => onEdit(book)}>+ タグを追加</button>
        </div>
        <section className="memo">
          <div><span>メモ</span><button onClick={() => onEdit(book)}>メモを編集</button></div>
          <p>{book.note || "メモはありません。"}</p>
          {book.metadataSource && <small className="metadata-source">書誌情報: {book.metadataSource}</small>}
        </section>
        <footer className="detail-actions">
          <button onClick={() => onEdit(book)}><Edit3 size={19} />編集</button>
          <button onClick={() => onEdit(book)}><FolderOpen size={19} />場所</button>
          <button onClick={onToggleRead}>
            <Check size={19} />{book.status === "読了" ? "未読に戻す" : "読了にする"}
          </button>
          <button onClick={onDelete}><Trash2 size={19} />削除</button>
          <button disabled={actionBusy} onClick={onRefreshCover}>
            <RefreshCw className={actionBusy ? "spin" : ""} size={19} />表紙
          </button>
        </footer>
      </aside>
    </>
  );
}
