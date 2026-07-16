/**
 * Promiseを返すルートの例外をExpressの共通エラーハンドラーへ渡す。
 *
 * @param {import("express").RequestHandler} handler 非同期ルート処理。
 * @returns {import("express").RequestHandler} rejectをnextへ渡すラッパー。
 */
export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
