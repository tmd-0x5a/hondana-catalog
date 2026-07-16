import { ArrowLeft, BookCopy } from "lucide-react";

import { showFallbackCover } from "../cover-image.js";

/**
 * シリーズ集約カードから遷移し、所持巻を巻数順で表示する。
 *
 * @param {object} props シリーズ表示モデルと遷移操作。
 * @param {{title: string, books: import("../types.js").Book[]}|undefined} props.series 対象シリーズ。
 * @returns {import("react").ReactElement|null} シリーズ詳細。
 */
export function SeriesDetailView({ onBack, onSelectBook, series }) {
  if (!series) return null;
  return (
    <section className="series-detail-view">
      <header className="series-detail-header">
        <button onClick={onBack} type="button"><ArrowLeft size={17} />本棚へ戻る</button>
        <div><span><BookCopy size={15} />シリーズ</span><h2>{series.title}</h2><p>{series.books.length}冊を所持</p></div>
      </header>
      <div className="series-volume-list">
        {series.books.map((book) => (
          <button className="series-volume-row" key={book.id} onClick={() => onSelectBook(book.id)} type="button">
            <img alt={`${book.title}の表紙`} onError={showFallbackCover} src={book.coverUrl || "/assets/selected-cover.png"} />
            <span><small>{book.volumeNumber ? `${book.volumeNumber}巻` : "巻数未設定"}</small><strong>{book.title}</strong><em>{book.author}</em></span>
            <b>{book.status}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
