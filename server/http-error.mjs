/**
 * 利用者へ返せるHTTPステータス付きエラーを作る。
 *
 * @param {number} status 400から599のHTTPステータス。
 * @param {string} message 利用者向けメッセージ。
 * @returns {Error & {status: number}} Express共通ハンドラーが解釈するエラー。
 */
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
