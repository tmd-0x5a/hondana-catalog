/** Promiseを返すルートの例外をExpressの共通エラーハンドラーへ渡す。 */
export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
