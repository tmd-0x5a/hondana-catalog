/** タイムアウトとUser-Agentを統一し、外部サービスへのHTTP依存を差し替え可能にする。 */
export class HttpClient {
  constructor({ userAgent = "HondanaCatalog/1.0", fetchImpl = globalThis.fetch } = {}) {
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
  }

  async request(url, { timeoutMs = 8000, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": this.userAgent, ...headers },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getJson(url, { errorLabel = "外部API", ...options } = {}) {
    const response = await this.request(url, options);
    if (!response.ok) throw new Error(`${errorLabel} HTTP ${response.status}`);
    return response.json();
  }
}
