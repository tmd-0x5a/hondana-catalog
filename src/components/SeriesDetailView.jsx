import { ArrowLeft, BookCopy } from "lucide-react";

import { buildShelfEntries } from "../library-model.js";
import { LibraryShelf } from "./LibraryShelf.jsx";

/**
 * シリーズ集約カードから遷移し、所持巻を巻数順で表示する。
 *
 * @param {object} props シリーズ表示モデルと遷移操作。
 * @param {number} props.bookWidth 通常の本棚と共有する表紙幅。
 * @param {string|number|null} props.selectedId 選択中の蔵書ID。
 * @param {{title: string, books: import("../types.js").Book[]}|undefined} props.series 対象シリーズ。
 * @returns {import("react").ReactElement|null} シリーズ詳細。
 */
export function SeriesDetailView({ bookWidth, onBack, onSelectBook, selectedId, series }) {
  if (!series) return null;
  const entries = buildShelfEntries(series.books, { groupSeries: false });
  const sections = [{ key: `series:${series.seriesKey}`, label: "", entries }];

  return (
    <section className="series-detail-view">
      <header className="series-detail-header">
        <button onClick={onBack} type="button"><ArrowLeft size={17} />本棚へ戻る</button>
        <div><span><BookCopy size={15} />シリーズ</span><h2>{series.title}</h2><p>{series.books.length}冊を所持</p></div>
      </header>
      <LibraryShelf
        bookWidth={bookWidth}
        onSelectBook={onSelectBook}
        sections={sections}
        selectedId={selectedId}
      />
    </section>
  );
}
