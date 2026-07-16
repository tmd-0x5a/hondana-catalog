const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Electronとブラウザ向けの防御ヘッダーをすべての応答へ付与する。
 *
 * @returns {import("express").RequestHandler} Expressミドルウェア。
 */
export function securityHeaders() {
  return function setSecurityHeaders(request, response, next) {
    response.set({
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    if (request.path.startsWith("/api/")) response.set("cache-control", "no-store");
    next();
  };
}
/**
 * 状態変更APIを同一オリジンに限定し、外部WebサイトからのCSRFを拒否する。
 * Originを送らないネイティブクライアントはLANトークン検査に委ねる。
 *
 * @param {string[]} allowedOrigins 許可するscheme・host・portの完全一致一覧。
 * @returns {import("express").RequestHandler} Expressミドルウェア。
 */
export function createOriginGuard(allowedOrigins) {
  const trustedOrigins = new Set(allowedOrigins);
  return function originGuard(request, response, next) {
    if (SAFE_METHODS.has(request.method)) return next();
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return response.status(403).json({ error: "外部サイトからの操作は拒否されました。" });
    }
    const origin = request.headers.origin;
    if (!origin || trustedOrigins.has(origin)) return next();
    return response.status(403).json({ error: "許可されていない送信元です。" });
  };
}
