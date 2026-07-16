/** タイムアウトとUser-Agentを統一し、外部サービスへのHTTP依存を差し替え可能にする。 */
export class HttpClient {
  /**
   * @param {object} [options] HTTP設定。
   * @param {string} [options.userAgent="HondanaCatalog/1.0"] 外部APIへ送る識別子。
   * @param {typeof fetch} [options.fetchImpl=globalThis.fetch] テスト差し替え用fetch。
   */
  constructor({ userAgent = "HondanaCatalog/1.0", fetchImpl = globalThis.fetch } = {}) {
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
  }

  /**
   * タイムアウト付きでHTTPSリクエストを行う。
   *
   * @param {string|URL} url 接続先。
   * @param {object} [options] fetch設定。
   * @param {number} [options.timeoutMs=8000] タイムアウト。
   * @param {Record<string, string>} [options.headers={}] 追加ヘッダー。
   * @param {RequestRedirect} [options.redirect="error"] リダイレクト方針。既定は自動追跡しない。
   * @returns {Promise<Response>} 未消費のレスポンス。
   */
  async request(url, { timeoutMs = 8000, headers = {}, redirect = "error" } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": this.userAgent, ...headers },
        redirect,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * レスポンス本文を上限付きで読み込み、外部サービスによるメモリ枯渇を防ぐ。
   *
   * @param {Response} response 読み込むレスポンス。
   * @param {number} [maxBytes=5242880] 最大バイト数。
   * @returns {Promise<Buffer>} 本文バイト列。
   */
  async readBuffer(response, maxBytes = 5 * 1024 * 1024) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("外部レスポンスが大きすぎます。");
    if (!response.body) return Buffer.alloc(0);

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new Error("外部レスポンスが大きすぎます。");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, receivedBytes);
  }

  /**
   * @param {string|URL} url JSON API URL。
   * @param {object} [options] requestと本文上限設定。
   * @param {string} [options.errorLabel="外部API"] エラー識別名。
   * @param {number} [options.maxBytes=2097152] JSON本文上限。
   * @returns {Promise<unknown>} JSON.parse結果。
   */
  async getJson(url, { errorLabel = "外部API", maxBytes = 2 * 1024 * 1024, ...options } = {}) {
    const response = await this.request(url, options);
    if (!response.ok) throw new Error(`${errorLabel} HTTP ${response.status}`);
    return JSON.parse((await this.readBuffer(response, maxBytes)).toString("utf8"));
  }

  /**
   * @param {string|URL} url テキストAPI URL。
   * @param {object} [options] requestと本文上限設定。
   * @param {string} [options.errorLabel="外部API"] エラー識別名。
   * @param {number} [options.maxBytes=2097152] テキスト本文上限。
   * @returns {Promise<string>} UTF-8本文。
   */
  async getText(url, { errorLabel = "外部API", maxBytes = 2 * 1024 * 1024, ...options } = {}) {
    const response = await this.request(url, options);
    if (!response.ok) throw new Error(`${errorLabel} HTTP ${response.status}`);
    return (await this.readBuffer(response, maxBytes)).toString("utf8");
  }
}
