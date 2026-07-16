import { ChevronDown, SlidersHorizontal } from "lucide-react";

function FilterSelect({ label, onChange, options, value }) {
  return (
    <label className="filter-select"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}><option value="all">すべて</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={14} /></label>
  );
}

/**
 * 出版社・著者・評価・シリーズ有無の追加条件。
 *
 * @param {object} props 条件、選択肢、更新操作。
 * @param {boolean} props.open パネル表示状態。
 * @param {(changes: object) => void} props.onChange 部分更新。
 * @returns {import("react").ReactElement|null} 詳細フィルター。
 */
export function LibraryFilterPanel({ filters, onChange, open, options }) {
  if (!open) return null;
  return (
    <div className="advanced-filter-panel" aria-label="詳細フィルター">
      <span className="advanced-filter-title"><SlidersHorizontal size={15} />詳細</span>
      <FilterSelect label="出版社" onChange={(publisherFilter) => onChange({ publisherFilter })} options={options.publishers} value={filters.publisherFilter} />
      <FilterSelect label="著者" onChange={(authorFilter) => onChange({ authorFilter })} options={options.authors} value={filters.authorFilter} />
      <label className="filter-select"><span>評価</span><select onChange={(event) => onChange({ minimumRating: Number(event.target.value) })} value={filters.minimumRating}><option value="0">指定なし</option><option value="3">3以上</option><option value="4">4以上</option><option value="5">5</option></select><ChevronDown size={14} /></label>
      <label className="filter-select"><span>シリーズ</span><select onChange={(event) => onChange({ seriesFilter: event.target.value })} value={filters.seriesFilter}><option value="all">すべて</option><option value="series">シリーズのみ</option><option value="standalone">単巻のみ</option></select><ChevronDown size={14} /></label>
    </div>
  );
}
