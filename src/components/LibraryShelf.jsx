import { BookCopy, GripVertical, Layers3 } from "lucide-react";

import { formatLabel, locationLabel } from "../library-model.js";

function coverStyle(book) {
  if (book.coverUrl) {
    return {
      backgroundImage: `url("${book.coverUrl}"), url('/assets/selected-cover.png')`,
      backgroundPosition: "center, center",
      backgroundSize: "cover, cover",
    };
  }
  if (book.sprite) return { backgroundImage: "url('/assets/cover-grid.png')", backgroundPosition: book.sprite };
  return { backgroundImage: "url('/assets/selected-cover.png')" };
}

/** 一冊分の書影を選択操作へ結び付ける。 */
function BookCover({ book, selected, onSelect }) {
  return (
    <button
      aria-label={`${book.title}を選択`}
      className={`book-cover ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      style={coverStyle(book)}
      type="button"
    >
      <span>{book.title}</span>
    </button>
  );
}

/**
 * 見出し・シリーズ集約済みの表示モデルだけを描画する本棚ビュー。
 * ドラッグ処理は保存責務を持つ親へ通知する。
 *
 * @param {object} props 表示モデルと操作コールバック。
 * @param {ReturnType<import("../library-model.js").buildShelfSections>} props.sections 棚セクション。
 * @param {number} props.bookWidth 表紙幅。
 * @param {boolean} props.manualSort 手動並び替え中か。
 * @returns {import("react").ReactElement} 本棚表示。
 */
export function LibraryShelf({
  bookWidth,
  draggedId,
  latestUpload,
  manualSort,
  onDismissUpload,
  onDragEnd,
  onDragStart,
  onDrop,
  onOpenSeries,
  onSelectBook,
  queueState,
  sections,
  selectedId,
}) {
  return (
    <section className="library-stage" aria-label="本棚" style={{ "--book-width": `${bookWidth}px` }}>
      <div className="shelf-image" />
      <div className="shelf-scroll">
        {sections.map((section) => (
          <section className="shelf-section" key={section.key}>
            {section.label && <h2 className="section-divider"><span>{section.label}</span><small>{section.entries.length}項目</small></h2>}
            <div className={`cover-strip ${manualSort ? "manual-sort" : ""}`}>
              {section.entries.map((entry) => {
                const book = entry.book;
                const isSeries = entry.kind === "series";
                return (
                  <article
                    className={`cover-wrap ${isSeries ? "series-entry" : ""}`}
                    draggable={manualSort}
                    key={entry.key}
                    onDragEnd={manualSort ? onDragEnd : undefined}
                    onDragOver={manualSort ? (event) => event.preventDefault() : undefined}
                    onDragStart={manualSort ? () => onDragStart(book.id) : undefined}
                    onDrop={manualSort ? (event) => { event.preventDefault(); onDrop(book.id); } : undefined}
                  >
                    {manualSort && String(draggedId) === String(book.id) && <GripVertical className="drag-handle" size={18} />}
                    {isSeries ? (
                      <button
                        aria-label={`${entry.title}のシリーズ一覧を開く`}
                        className="series-cover-stack"
                        onClick={() => onOpenSeries(entry.seriesKey)}
                        style={coverStyle(book)}
                        type="button"
                      >
                        <Layers3 size={18} />
                        <b>{entry.books.length}冊</b>
                      </button>
                    ) : (
                      <BookCover
                        book={book}
                        onSelect={() => onSelectBook(book.id)}
                        selected={String(book.id) === String(selectedId)}
                      />
                    )}
                    <span>{isSeries ? entry.title : book.category === "マンガ" && book.volumeNumber ? `${book.seriesName || book.title} ${book.volumeNumber}巻` : book.title}</span>
                    <small>{isSeries ? <><BookCopy size={11} />シリーズ・{entry.books.length}冊</> : `${book.category || "その他"}・${formatLabel(book)}・${locationLabel(book)}`}</small>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {latestUpload && (
        <div className={`upload-queue ${queueState}`} role="status">
          <div className="barcode-thumb">{queueState === "success" ? "完了" : "ISBN"}</div>
          <div className="upload-queue-copy"><strong>{latestUpload.originalName || "iPhoneからの追加"}</strong><span>{latestUpload.message}</span>{latestUpload.isbn && <code>{latestUpload.isbn}</code>}</div>
          <button aria-label="通知を閉じる" className="queue-dismiss" onClick={onDismissUpload} title="閉じる" type="button">×</button>
        </div>
      )}
    </section>
  );
}
