/**
 * 店頭へ持ち出せる自己完結HTMLを生成する。
 * JSONをscript要素へ埋め込むため、タグ終端やJavaScriptの行区切りとして解釈される文字を先に逃がす。
 *
 * @param {{syncedAt: string, books: import("../src/types.js").Book[]}} snapshot 持ち出し対象の最小蔵書スナップショット。
 * @returns {string} 外部依存を持たないUTF-8 HTML文書。
 */
export function buildOfflineLibraryHtml(snapshot) {
  const payload = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#151813">
  <title>持ち出し本棚</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #11130f; color: #ece5d6; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #11130f; }
    header { padding: max(18px, env(safe-area-inset-top)) 18px 17px; border-bottom: 1px solid #34372d; background: #181b16; }
    header span, header strong { display: block; }
    header strong { font-size: 17px; }
    header span { margin-top: 4px; color: #9c9587; font-size: 11px; }
    main { width: min(100%, 680px); margin: 0 auto; padding: 20px 16px calc(28px + env(safe-area-inset-bottom)); }
    .summary { display: flex; align-items: end; justify-content: space-between; gap: 14px; margin-bottom: 17px; }
    .summary p { margin: 0; color: #b6ab92; font-size: 11px; }
    .summary strong { display: block; margin-top: 3px; color: #eee3ca; font-size: 28px; }
    .badge { padding: 7px 9px; border: 1px solid #47604a; border-radius: 6px; color: #a9c3a4; font-size: 10px; }
    .search { height: 50px; display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 0 13px; border: 1px solid #5a5548; border-radius: 7px; background: #1c1f19; }
    .search svg { color: #bda76c; }
    input { width: 100%; border: 0; outline: 0; background: transparent; color: #f2ecdf; font: inherit; font-size: 16px; }
    input::placeholder { color: #777266; }
    #clear { min-width: 38px; min-height: 38px; border: 0; background: transparent; color: #aaa294; font-size: 22px; }
    .meta { min-height: 35px; padding: 11px 2px 8px; color: #958d7f; font-size: 11px; }
    .notice { margin-bottom: 10px; padding: 12px; border: 1px solid #925e43; border-radius: 7px; background: #35231a; color: #e6c093; font-weight: 700; font-size: 12px; }
    #results { display: grid; border-top: 1px solid #34372d; }
    article { min-width: 0; padding: 13px 2px; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; border-bottom: 1px solid #34372d; }
    .mark { width: 30px; height: 38px; display: grid; place-items: center; border-radius: 3px 5px 5px 3px; background: #5b6048; color: #f1e6c6; font-size: 14px; font-weight: 700; }
    article strong, article span, article small { display: block; overflow-wrap: anywhere; }
    article strong { color: #eee7da; font-size: 14px; line-height: 1.45; }
    article span { margin-top: 3px; color: #aaa191; font-size: 11px; }
    article small { margin-top: 5px; color: #879c82; font-size: 10px; }
    .empty { padding: 42px 16px; color: #878174; text-align: center; font-size: 12px; line-height: 1.8; }
  </style>
</head>
<body>
  <header><strong>持ち出し本棚</strong><span>このファイルだけで検索できます</span></header>
  <main>
    <div class="summary"><p>保存された蔵書<strong id="count"></strong></p><div class="badge">オフライン</div></div>
    <label class="search" aria-label="蔵書検索">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
      <input id="query" autocomplete="off" inputmode="search" placeholder="タイトル・著者・ISBN">
      <button id="clear" type="button" aria-label="検索を消す">×</button>
    </label>
    <div class="meta" id="meta"></div>
    <div id="notice"></div>
    <section id="results"></section>
  </main>
  <script>
    const snapshot = ${payload};
    const books = Array.isArray(snapshot.books) ? snapshot.books : [];
    const query = document.getElementById("query");
    const results = document.getElementById("results");
    const meta = document.getElementById("meta");
    const notice = document.getElementById("notice");
    document.getElementById("count").textContent = books.length + "冊";
    const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("ja");
    const isbn = (value) => String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
    const synced = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString("ja-JP") : "不明";

    function addBook(book) {
      const item = document.createElement("article");
      const mark = document.createElement("div");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      const author = document.createElement("span");
      const detail = document.createElement("small");
      mark.className = "mark";
      mark.textContent = book.category === "マンガ" ? "漫" : "本";
      title.textContent = book.title || "無題";
      author.textContent = book.author || "著者不明";
      const location = book.format === "electronic" ? (book.electronicPlatform || "電子書籍") : (book.physicalLocation || "実本");
      detail.textContent = [book.isbn, location, book.volumeNumber ? book.volumeNumber + "巻" : ""].filter(Boolean).join(" ・ ");
      body.append(title, author, detail);
      item.append(mark, body);
      results.append(item);
    }

    function render() {
      const raw = query.value.trim();
      const normalized = normalize(raw);
      const isbnQuery = isbn(raw);
      results.replaceChildren();
      notice.replaceChildren();
      if (!raw) {
        meta.textContent = "保存日時 " + synced;
        results.innerHTML = '<div class="empty">店頭でタイトル、著者名、ISBNを入力してください。<br>PCやLANへの接続は不要です。</div>';
        return;
      }
      const matches = books.filter((book) => {
        const text = normalize([book.title, book.author, book.seriesName, book.category].join(" "));
        return text.includes(normalized) || (isbnQuery.length >= 4 && isbn(book.isbn).includes(isbnQuery));
      }).slice(0, 50);
      const exact = isbnQuery.length >= 10 && books.find((book) => isbn(book.isbn) === isbnQuery);
      if (exact) {
        const owned = document.createElement("div");
        owned.className = "notice";
        owned.textContent = "登録済み: " + exact.title;
        notice.append(owned);
      }
      meta.textContent = matches.length ? matches.length + "件見つかりました" : "一致する蔵書はありません";
      matches.forEach(addBook);
      if (!matches.length) results.innerHTML = '<div class="empty">同じ本は見つかりませんでした。<br>表記違いもあるため、著者名でも確認してください。</div>';
    }

    query.addEventListener("input", render);
    document.getElementById("clear").addEventListener("click", () => { query.value = ""; query.focus(); render(); });
    render();
  </script>
</body>
</html>`;
}
