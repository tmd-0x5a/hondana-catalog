/** @typedef {{bookWidth: number, groupSeries: boolean, showSectionHeaders: boolean}} LibraryPreferences */

export const DEFAULT_LIBRARY_PREFERENCES = Object.freeze({
  bookWidth: 92,
  groupSeries: true,
  showSectionHeaders: true,
});

const STORAGE_KEY = "hondana-library-preferences-v1";

function normalizePreferences(value) {
  const parsedWidth = Number(value?.bookWidth);
  return {
    bookWidth: Number.isFinite(parsedWidth) ? Math.min(132, Math.max(72, parsedWidth)) : DEFAULT_LIBRARY_PREFERENCES.bookWidth,
    groupSeries: value?.groupSeries !== false,
    showSectionHeaders: value?.showSectionHeaders !== false,
  };
}

/**
 * localStorageの破損値を既定値へ戻し、画面が起動不能になることを防ぐ。
 *
 * @param {Storage} [storage=window.localStorage] 保存先。
 * @returns {LibraryPreferences} 検証済み表示設定。
 */
export function loadLibraryPreferences(storage = window.localStorage) {
  try {
    return normalizePreferences(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_LIBRARY_PREFERENCES };
  }
}

/** @param {LibraryPreferences} preferences 表示設定。 @param {Storage} [storage=window.localStorage] 保存先。 */
export function saveLibraryPreferences(preferences, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(normalizePreferences(preferences)));
}
