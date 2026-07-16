import crypto from "node:crypto";

const ACCESS_COOKIE = "hondana_access";
const ACCESS_QUERY = "access_token";

function normalizedAddress(address = "") {
  return String(address).replace(/^::ffff:/, "").split("%")[0];
}

function isLoopbackAddress(address) {
  const normalized = normalizedAddress(address);
  return normalized === "::1" || normalized.startsWith("127.");
}

function safeTokenEquals(candidate, expected) {
  const candidateBuffer = Buffer.from(String(candidate || ""));
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function cookieValue(header, name) {
  const prefix = `${name}=`;
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function hostName(header) {
  try {
    return new URL(`http://${header}`).hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase("en-US");
  } catch {
    return "";
  }
}

function rejectAccess(request, response, status, message) {
  response.set("cache-control", "no-store");
  if (request.path.startsWith("/api/")) return response.status(status).json({ error: message });
  return response.status(status).type("text/plain; charset=utf-8").send(message);
}

/**
 * サーバーが受け入れるクライアントIPかを判定する。
 * QRコードはIPv4を使うため、IPv6はループバック・ULA・リンクローカルだけを許可する。
 *
 * @param {string} address socket.remoteAddress。
 * @returns {boolean} 同一端末またはプライベートLANと判断できる場合はtrue。
 */
export function isTrustedNetworkAddress(address) {
  const normalized = normalizedAddress(address).toLocaleLowerCase("en-US");
  if (isLoopbackAddress(normalized)) return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(normalized)) return true;
  return normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized);
}

/**
 * LAN側の全リクエストへ起動時トークンを要求し、DNS rebinding対策としてHostも固定する。
 * 同一PCのループバック接続はデスクトップUI互換のためトークンを免除する。
 *
 * @param {object} options アクセス制御設定。
 * @param {string} options.accessToken crypto.randomBytesで生成した推測困難なトークン。
 * @param {string[]} options.allowedHosts 127.0.0.1、localhost、現在のLAN IPv4。
 * @param {number} [options.cookieLifetimeSeconds=43200] 認証Cookieの有効秒数。
 * @returns {import("express").RequestHandler} Expressミドルウェア。
 */
export function createLanAccessGuard({ accessToken, allowedHosts, cookieLifetimeSeconds = 12 * 60 * 60 }) {
  if (typeof accessToken !== "string" || accessToken.length < 32) throw new Error("LANアクセストークンが短すぎます。");
  const trustedHosts = new Set(allowedHosts.map((host) => String(host).toLocaleLowerCase("en-US")));

  return function lanAccessGuard(request, response, next) {
    if (!isTrustedNetworkAddress(request.socket.remoteAddress)) {
      return rejectAccess(request, response, 403, "プライベートLAN以外からは接続できません。");
    }
    if (!trustedHosts.has(hostName(request.headers.host))) {
      return rejectAccess(request, response, 403, "このホスト名では接続できません。");
    }
    if (isLoopbackAddress(request.socket.remoteAddress)) return next();

    const requestUrl = new URL(request.originalUrl, "http://hondana.local");
    const queryToken = requestUrl.searchParams.get(ACCESS_QUERY);
    const storedToken = cookieValue(request.headers.cookie, ACCESS_COOKIE);
    if (safeTokenEquals(storedToken, accessToken)) return next();

    if (safeTokenEquals(queryToken, accessToken) && ["GET", "HEAD"].includes(request.method)) {
      response.cookie(ACCESS_COOKIE, accessToken, {
        httpOnly: true,
        sameSite: "strict",
        maxAge: cookieLifetimeSeconds * 1000,
        path: "/",
      });
      requestUrl.searchParams.delete(ACCESS_QUERY);
      const cleanUrl = `${requestUrl.pathname}${requestUrl.search}`;
      response.set("cache-control", "no-store");
      return response.redirect(303, cleanUrl || "/");
    }

    return rejectAccess(request, response, 401, "PC画面のQRコードから接続し直してください。");
  };
}
