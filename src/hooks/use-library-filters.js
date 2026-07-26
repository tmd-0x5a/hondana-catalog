import { useCallback, useMemo, useReducer } from "react";

/** @typedef {typeof INITIAL_FILTERS} LibraryFilters */

const INITIAL_FILTERS = Object.freeze({
  status: "すべて",
  ownershipFilter: "all",
  categoryFilter: "all",
  platformFilter: "all",
  publisherFilter: "all",
  authorFilter: "all",
  minimumRating: 0,
  seriesFilter: "all",
});

function filtersReducer(current, action) {
  if (action.type === "reset") return INITIAL_FILTERS;
  const merged = { ...current, ...action.changes };
  // 電子書籍以外を選んだら媒体絞り込みは意味を持たないため同時に解除する。
  if (merged.ownershipFilter !== "electronic") merged.platformFilter = "all";
  return merged;
}

/**
 * 本棚の絞り込み条件8種を一つのreducerへまとめ、部分更新・一括解除・適用有無を提供する。
 *
 * @returns {{filters: LibraryFilters, updateFilters: (changes: Partial<LibraryFilters>) => void, resetFilters: () => void, hasActiveFilters: boolean}} 絞り込み状態。
 */
export function useLibraryFilters() {
  const [filters, dispatch] = useReducer(filtersReducer, INITIAL_FILTERS);

  const updateFilters = useCallback((changes) => dispatch({ type: "merge", changes }), []);
  const resetFilters = useCallback(() => dispatch({ type: "reset" }), []);
  const hasActiveFilters = useMemo(
    () => Object.entries(INITIAL_FILTERS).some(([key, initialValue]) => filters[key] !== initialValue),
    [filters],
  );

  return { filters, updateFilters, resetFilters, hasActiveFilters };
}
