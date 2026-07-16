/**
 * JSON APIを呼び、HTTPエラー時もサーバーのメッセージとpayloadを保持して例外化する。
 *
 * @param {string|URL} url 同一オリジンAPI URL。
 * @param {RequestInit} [options] fetch設定。
 * @returns {Promise<any>} JSONレスポンス。204の場合はnull。
 * @throws {Error & {status?: number, payload?: unknown}} 通信失敗または非2xx応答。
 */
export async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "通信に失敗しました。");
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
