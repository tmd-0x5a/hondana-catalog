import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { MAX_UPLOAD_PIXELS } from "./image-validator.mjs";

const BROWSER_IMAGE_HEADERS = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
};

const ALLOWED_COVER_HOSTS = new Set([
  "books.google.com",
  "books.google.co.jp",
  "cover.openbd.jp",
  "covers.openlibrary.org",
]);

/**
 * @param {unknown} value 表紙候補URL。
 * @returns {boolean} 既知のHTTPS書影ホストだけtrue。
 */
export function isAllowedCoverUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLocaleLowerCase("en-US");
    const googleImageHost = host === "googleusercontent.com" || host.endsWith(".googleusercontent.com");
    return url.protocol === "https:" && !url.username && !url.password
      && (ALLOWED_COVER_HOSTS.has(host) || googleImageHost);
  } catch {
    return false;
  }
}

/** 表紙候補の選択、画像検証、WebP変換、ローカルキャッシュだけを担当する。 */
export class CoverService {
  /**
   * @param {object} dependencies サービス依存。
   * @param {string} dependencies.coverDir WebPキャッシュ保存先。
   * @param {import("./http-client.mjs").HttpClient} dependencies.httpClient 外部HTTPクライアント。
   */
  constructor({ coverDir, httpClient }) {
    this.coverDir = coverDir;
    this.httpClient = httpClient;
  }

  /**
   * @param {string} isbn 正規化済みISBN-13。
   * @param {string[]} [preferredUrls=[]] 書誌APIが返した優先候補。
   * @returns {Promise<string>} キャッシュできた場合のアプリ内URL。取得不能なら空文字。
   */
  async ensureCachedCover(isbn, preferredUrls = []) {
    const cachedCoverUrl = this.#cachedCoverUrl(isbn);
    if (fs.existsSync(this.#coverPath(isbn))) return cachedCoverUrl;

    for (const candidate of this.#coverCandidates(isbn, preferredUrls)) {
      const downloaded = await this.#downloadCandidate(candidate, isbn);
      if (downloaded) return cachedCoverUrl;
    }
    return "";
  }

  #coverPath(isbn) {
    return path.join(this.coverDir, `${isbn}.webp`);
  }

  #cachedCoverUrl(isbn) {
    return `/covers/${isbn}.webp`;
  }

  #coverCandidates(isbn, preferredUrls) {
    return [
      ...preferredUrls.filter(isAllowedCoverUrl).map((url) => ({ url, headers: {} })),
      {
        url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
        headers: {},
      },
    ];
  }

  /** 小さな「画像なし」プレースホルダーを除外し、有効な書影だけを保存する。 */
  async #downloadCandidate({ url, headers }, isbn) {
    try {
      if (!isAllowedCoverUrl(url)) return false;
      const response = await this.#requestAllowedRedirects(url, headers);
      if (!response) return false;
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/") || !isAllowedCoverUrl(response.url || url)) return false;

      const image = await this.httpClient.readBuffer(response, 8 * 1024 * 1024);
      const metadata = await sharp(image, { limitInputPixels: MAX_UPLOAD_PIXELS }).metadata();
      const isUsableCover = metadata.width >= 120
        && metadata.height >= 160
        && Number(metadata.pages || 1) === 1;
      if (!isUsableCover) return false;

      await sharp(image, { limitInputPixels: MAX_UPLOAD_PIXELS })
        .rotate()
        .resize({ width: 640, height: 960, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toFile(this.#coverPath(isbn));
      return true;
    } catch {
      return false;
    }
  }

  async #requestAllowedRedirects(initialUrl, headers) {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const response = await this.httpClient.request(currentUrl, {
        timeoutMs: 10000,
        headers: { ...BROWSER_IMAGE_HEADERS, ...headers },
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) return null;
      const nextUrl = new URL(location, currentUrl).href;
      if (!isAllowedCoverUrl(nextUrl)) return null;
      await response.body?.cancel();
      currentUrl = nextUrl;
    }
    return null;
  }
}
