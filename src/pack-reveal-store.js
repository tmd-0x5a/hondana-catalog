const STORAGE_KEY = "hondana-pack-revealed-v1";

/**
 * めくったカードを日付ごとに覚えておく。
 * 途中まで開いて画面を離れても、続きからめくれるようにするための端末内メモ。
 *
 * @param {string} date パックの日付（YYYY-MM-DD）。
 * @param {Storage} [storage=window.localStorage] 保存先。
 * @returns {string[]} めくり済みカードのキー。
 */
export function loadRevealedKeys(date, storage = window.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return saved?.date === date && Array.isArray(saved.keys) ? saved.keys.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} date パックの日付（YYYY-MM-DD）。
 * @param {string[]} keys めくり済みカードのキー。
 * @param {Storage} [storage=window.localStorage] 保存先。
 */
export function saveRevealedKeys(date, keys, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ date, keys: [...new Set(keys.map(String))] }));
  } catch {
    // 保存できなくてもその場のめくり操作は続けられるため、失敗は無視する。
  }
}
