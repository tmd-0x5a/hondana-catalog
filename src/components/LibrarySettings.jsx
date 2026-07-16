import { Eye, Layers3, Scaling, Settings2, X } from "lucide-react";

/**
 * 本棚の見た目だけを変更する設定ポップオーバー。
 *
 * @param {object} props 設定値と更新操作。
 * @param {{bookWidth: number, groupSeries: boolean, showSectionHeaders: boolean}} props.preferences 現在設定。
 * @param {(changes: object) => void} props.onChange 部分更新。
 * @returns {import("react").ReactElement} 表示設定。
 */
export function LibrarySettings({ onChange, onClose, onToggle, open, preferences }) {
  return (
    <div className="settings-anchor">
      <button aria-expanded={open} aria-label="本棚の表示設定" onClick={onToggle} title="表示設定" type="button">
        <Settings2 size={17} />
      </button>
      {open && (
        <section className="library-settings" aria-label="本棚の表示設定">
          <header><strong>表示設定</strong><button aria-label="設定を閉じる" onClick={onClose} type="button"><X size={16} /></button></header>
          <label className="size-setting"><span><Scaling size={16} />本の大きさ</span><output>{preferences.bookWidth}px</output><input max="132" min="72" onChange={(event) => onChange({ bookWidth: Number(event.target.value) })} step="10" type="range" value={preferences.bookWidth} /></label>
          <label className="toggle-setting"><span><Eye size={16} />棚の仕切り</span><input checked={preferences.showSectionHeaders} onChange={(event) => onChange({ showSectionHeaders: event.target.checked })} type="checkbox" /></label>
          <label className="toggle-setting"><span><Layers3 size={16} />シリーズをまとめる</span><input checked={preferences.groupSeries} onChange={(event) => onChange({ groupSeries: event.target.checked })} type="checkbox" /></label>
        </section>
      )}
    </div>
  );
}
