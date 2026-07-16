/**
 * URLがアプリ自身のオリジンかをURLパーサーで判定する。
 *
 * @param {string} candidate 判定対象URL。
 * @param {string} appUrl アプリの基準URL。
 * @returns {boolean} protocol・host・portが完全一致する場合はtrue。
 */
export function isApplicationUrl(candidate, appUrl) {
  try {
    return new URL(candidate).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/**
 * アプリ内の小型ウィンドウで開いてよい補助画面かを判定する。
 *
 * @param {string} candidate 判定対象URL。
 * @param {string} appUrl アプリの基準URL。
 * @returns {boolean} 同一オリジンの/uploadまたは/checkだけtrue。
 */
export function isLocalCompanionPage(candidate, appUrl) {
  try {
    const target = new URL(candidate);
    const privateIpv4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(target.hostname);
    const trustedHost = target.hostname === "localhost" || target.hostname === "::1" || privateIpv4;
    return target.protocol === "http:"
      && target.port === new URL(appUrl).port
      && trustedHost
      && ["/upload", "/check"].includes(target.pathname);
  } catch {
    return false;
  }
}

/**
 * OSの既定ブラウザへ渡してよい外部URLをHTTPSだけに限定する。
 *
 * @param {string} candidate 判定対象URL。
 * @returns {boolean} 認証情報を含まないHTTPS URLの場合はtrue。
 */
export function isAllowedExternalUrl(candidate) {
  try {
    const target = new URL(candidate);
    return target.protocol === "https:" && !target.username && !target.password;
  } catch {
    return false;
  }
}
