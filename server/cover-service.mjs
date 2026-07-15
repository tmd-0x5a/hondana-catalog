import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const BROWSER_IMAGE_HEADERS = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
};

/** 表紙候補の選択、画像検証、WebP変換、ローカルキャッシュだけを担当する。 */
export class CoverService {
  constructor({ coverDir, httpClient }) {
    this.coverDir = coverDir;
    this.httpClient = httpClient;
  }

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
      ...preferredUrls.filter(Boolean).map((url) => ({ url, headers: {} })),
      {
        url: `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg`,
        headers: { referer: "https://ndlsearch.ndl.go.jp/" },
      },
      {
        url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
        headers: {},
      },
    ];
  }

  /** 小さな「画像なし」プレースホルダーを除外し、有効な書影だけを保存する。 */
  async #downloadCandidate({ url, headers }, isbn) {
    try {
      const response = await this.httpClient.request(url, {
        timeoutMs: 10000,
        headers: { ...BROWSER_IMAGE_HEADERS, ...headers },
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) return false;

      const image = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(image).metadata();
      const isUsableCover = metadata.width >= 120 && metadata.height >= 160;
      if (!isUsableCover) return false;

      await sharp(image)
        .rotate()
        .resize({ width: 640, height: 960, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toFile(this.#coverPath(isbn));
      return true;
    } catch {
      return false;
    }
  }
}
