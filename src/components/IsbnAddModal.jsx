import { Barcode, ExternalLink, RefreshCw, X } from "lucide-react";

/**
 * ISBN直接入力から書誌を取得する小型モーダル。
 *
 * @param {object} props モーダル制御。
 * @param {string} props.isbn 入力中のISBN。
 * @param {boolean} props.busy 書誌取得中か。
 * @param {string} props.message 取得状況・エラーメッセージ。
 * @param {(value: string) => void} props.onChange ISBN入力の更新。
 * @param {(event: import("react").FormEvent) => void} props.onSubmit 取得実行。
 * @param {() => void} props.onClose 閉じる操作。
 * @returns {import("react").ReactElement} ISBN入力モーダル。
 */
export function IsbnAddModal({ isbn, busy, message, onChange, onSubmit, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="isbn-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <header>
          <div><Barcode size={22} /><strong>ISBNから本を追加</strong></div>
          <button aria-label="閉じる" onClick={onClose} type="button"><X size={20} /></button>
        </header>
        <p>本の裏表紙にあるISBN-10またはISBN-13を入力します。</p>
        <label>
          <span>ISBN</span>
          <input
            autoFocus
            inputMode="numeric"
            onChange={(event) => onChange(event.target.value)}
            placeholder="9784087451224"
            value={isbn}
          />
        </label>
        {message && <div className="modal-message">{message}</div>}
        <footer>
          <button onClick={onClose} type="button">キャンセル</button>
          <button className="modal-submit" disabled={busy} type="submit">
            {busy ? <RefreshCw className="spin" size={17} /> : <ExternalLink size={17} />}
            書籍情報を取得
          </button>
        </footer>
      </form>
    </div>
  );
}
