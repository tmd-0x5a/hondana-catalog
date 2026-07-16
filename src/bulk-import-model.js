const ISBN_SHAPE = /^(?:\d{9}[\dX]|\d{13})$/i;

function compactIsbn(value) {
  return String(value || "").normalize("NFKC").replace(/[^0-9X]/gi, "").toUpperCase();
}

function looksLikeIsbn(value) {
  return ISBN_SHAPE.test(compactIsbn(value));
}

/**
 * ISBN一覧またはタブ区切りの書名一覧を、一括登録API用の行へ変換する。
 * ISBN行は `ISBN [TAB] タイトル [TAB] 著者`、書名行は `タイトル [TAB] 著者` と解釈する。
 *
 * @param {unknown} value テキストエリアまたはTSVファイルの内容。
 * @param {number} [maximumEntries=200] 一度に処理できる上限。
 * @returns {{entries: Array<{isbn: string, title: string, author: string}>, errors: string[]}} 解析結果。
 */
export function parseBulkImportText(value, maximumEntries = 200) {
  const entries = [];
  const errors = [];
  const lines = String(value || "").replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (entries.length >= maximumEntries) {
      errors.push(`一度に取り込めるのは${maximumEntries}件までです。`);
      break;
    }

    const columns = line.split("\t").map((column) => column.trim());
    if (looksLikeIsbn(columns[0])) {
      entries.push({ isbn: compactIsbn(columns[0]), title: columns[1] || "", author: columns[2] || "" });
      continue;
    }

    if (!columns[0]) {
      errors.push(`${index + 1}行目にISBNまたはタイトルがありません。`);
      continue;
    }
    entries.push({ isbn: looksLikeIsbn(columns[2]) ? compactIsbn(columns[2]) : "", title: columns[0], author: columns[1] || "" });
  }

  return { entries, errors };
}
