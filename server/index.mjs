import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sampleBooks } from "../src/sampleBooks.js";
import { createApp } from "./app.mjs";
import { BarcodeScanner } from "./barcode-scanner.mjs";
import { BookMetadataService } from "./book-metadata-service.mjs";
import { BookBulkImportService } from "./book-bulk-import-service.mjs";
import { BookScreenshotImportService } from "./book-screenshot-import-service.mjs";
import { BookService } from "./book-service.mjs";
import { CoverService } from "./cover-service.mjs";
import { HttpClient } from "./http-client.mjs";
import { LibraryRepository } from "./library-repository.mjs";
import { NdlCatalogService } from "./ndl-catalog-service.mjs";
import { privateLanAddress } from "./network.mjs";
import { RecommendationService } from "./recommendation-service.mjs";
import { createBookRouter } from "./routes/book-router.mjs";
import { createBulkImportRouter } from "./routes/bulk-import-router.mjs";
import { createRecommendationRouter } from "./routes/recommendation-router.mjs";
import { createSeriesRouter } from "./routes/series-router.mjs";
import { createSystemRouter } from "./routes/system-router.mjs";
import { createUploadRouter } from "./routes/upload-router.mjs";
import { createLanAccessGuard } from "./security/access-control.mjs";
import { createOriginGuard, securityHeaders } from "./security/http-security.mjs";
import { FixedWindowRateLimiter } from "./security/rate-limiter.mjs";
import { SeriesService } from "./series-service.mjs";
import { UploadService } from "./upload-service.mjs";
import { WindowsOcrService } from "./windows-ocr-service.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.HONDANA_DIST_DIR || path.join(rootDir, "dist");
const dataDir = process.env.HONDANA_DATA_DIR || path.join(rootDir, "data");
const port = Number(process.env.PORT || 8080);
const lanAddress = privateLanAddress();
const accessToken = crypto.randomBytes(32).toString("hex");

// Composition Rootとして依存の組立だけを行い、各サービスを単独でテスト可能に保つ。
const repository = new LibraryRepository({ dataDir, seedBooks: sampleBooks });
await repository.initialize();

const httpClient = new HttpClient();
const coverService = new CoverService({ coverDir: repository.paths.coverDir, httpClient });
const metadataService = new BookMetadataService({ httpClient, coverService });
const catalogService = new NdlCatalogService({ httpClient });
const barcodeScanner = new BarcodeScanner();
const bookService = new BookService({ repository, metadataService, coverService });
const bulkImportService = new BookBulkImportService({ bookService });
const screenshotImportService = new BookScreenshotImportService({
  ocrService: new WindowsOcrService(),
  catalogService,
});
const seriesService = new SeriesService({ repository, catalogService });
const recommendationService = new RecommendationService({ repository, catalogService });
const uploadService = new UploadService({
  repository,
  bookService,
  barcodeScanner,
  uploadDir: repository.paths.uploadDir,
});
await bookService.migrateStoredBooks();

const apiRateLimiter = new FixedWindowRateLimiter({
  maxRequests: 240,
  shouldLimit: (request) => request.path.startsWith("/api/"),
});
const uploadRateLimiter = new FixedWindowRateLimiter({ maxRequests: 12 });
const screenshotRateLimiter = new FixedWindowRateLimiter({ maxRequests: 4 });

const routers = [
  createSystemRouter({ bookService, port, getLanAddress: () => lanAddress, accessToken }),
  createBulkImportRouter({
    bulkImportService,
    screenshotImportService,
    screenshotRateLimit: screenshotRateLimiter.middleware(),
  }),
  createBookRouter({ bookService, catalogService, metadataService }),
  createRecommendationRouter({ recommendationService }),
  createSeriesRouter({ seriesService }),
  createUploadRouter({ uploadService, uploadRateLimit: uploadRateLimiter.middleware() }),
];
const app = createApp({
  distDir,
  uploadDir: repository.paths.uploadDir,
  coverDir: repository.paths.coverDir,
  routers,
  securityMiddleware: [
    securityHeaders(),
    createLanAccessGuard({
      accessToken,
      allowedHosts: ["127.0.0.1", "localhost", "::1", lanAddress],
    }),
    createOriginGuard([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://${lanAddress}:${port}`,
    ]),
    apiRateLimiter.middleware(),
  ],
});

const server = app.listen(port, "0.0.0.0", () => {
  const lanUrl = `http://${lanAddress}:${port}`;
  console.log(`本棚カタログ: http://127.0.0.1:${port}`);
  console.log(`iPhoneアップロード: ${lanUrl}/upload`);
  void bookService.backfillMetadataGaps().catch((error) => {
    console.error("表紙・読みの自動補完に失敗しました。", error);
  });
});

/** 検証コードとElectron起動側が待受状態を参照するための公開値。 */
export { app, server };
