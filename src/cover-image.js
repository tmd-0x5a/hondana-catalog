const FALLBACK_COVER_PATH = "/assets/selected-cover.png";

/**
 * 読み込めない書影をアプリ同梱の既定表紙へ一度だけ差し替える。
 *
 * @param {import("react").SyntheticEvent<HTMLImageElement>} event img要素のエラーイベント。
 */
export function showFallbackCover(event) {
  const image = event.currentTarget;
  if (new URL(image.src, window.location.href).pathname === FALLBACK_COVER_PATH) return;
  image.src = FALLBACK_COVER_PATH;
}
