/**
 * 単一プロセスのLANアプリ向け固定窓レートリミッター。
 * クライアントIPごとの状態を保持するためクラスとして実装する。
 */
export class FixedWindowRateLimiter {
  /**
   * @param {object} options 制限設定。
   * @param {number} options.maxRequests 一つの窓で許可する回数。
   * @param {number} [options.windowMs=60000] 窓の長さ。
   * @param {(request: import("express").Request) => boolean} [options.shouldLimit] 対象リクエスト判定。
   * @param {() => number} [options.now=Date.now] テスト用時刻関数。
   */
  constructor({ maxRequests, windowMs = 60 * 1000, shouldLimit = () => true, now = Date.now }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.shouldLimit = shouldLimit;
    this.now = now;
    this.windows = new Map();
  }

  /**
   * このインスタンスのカウンターを使うExpressミドルウェアを返す。
   *
   * @returns {import("express").RequestHandler} 上限超過時に429を返すミドルウェア。
   */
  middleware() {
    return (request, response, next) => {
      if (!this.shouldLimit(request)) return next();
      const now = this.now();
      const key = String(request.socket.remoteAddress || "unknown");
      const current = this.windows.get(key);
      const windowState = !current || current.resetAt <= now
        ? { count: 0, resetAt: now + this.windowMs }
        : current;
      windowState.count += 1;
      this.windows.set(key, windowState);

      if (windowState.count <= this.maxRequests) return next();
      response.set("retry-after", String(Math.max(1, Math.ceil((windowState.resetAt - now) / 1000))));
      return response.status(429).json({ error: "短時間にリクエストが集中しました。少し待ってから再試行してください。" });
    };
  }
}
